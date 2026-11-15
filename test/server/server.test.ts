import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { type KenServer, openServer } from '../../src/server/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
	{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_SERVER_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

function tempFolder(name: string) {
	const folder = mkdtempSync(path.join(tmpdir(), name))
	after(() => rmSync(folder, { recursive: true, force: true }))
	return folder
}

const SLEEP = { path: 'src/retry.ts', commit: head, text: '\t\tsleep(100)' }
const RETRY_LINE = { path: 'src/retry.ts', commit: head, text: 'export function retry(times: number) {' }
const READ: Turn = { tool: 'ken__read_file', args: { path: 'src/retry.ts', start: 1, end: 3 } }
const ANSWER: Turn = {
	tool: 'ken__answer',
	args: {
		scope: { base, head },
		summary: 'Each retry now waits before the next attempt.',
		statements: [{ text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }],
		diagrams: [
			{
				kind: 'component',
				title: 'What retry does between attempts',
				label: 'inferred',
				boxes: [{ name: 'retry', quotes: [RETRY_LINE] }, { name: 'sleep' }],
				arrows: [{ from: 'retry', to: 'sleep', text: 'calls', quotes: [SLEEP] }],
			},
		],
		decisions: [
			{
				question: 'How long does a retry wait?',
				chosen: 'A fixed 100 ms',
				rejected: [],
				undo: 'easy',
				needs_owner: true,
				quotes: [SLEEP],
			},
		],
	},
}

async function open(home: string, baseUrl: string | null, directory = root): Promise<KenServer> {
	const model = baseUrl
		? { KEN_MODEL: 'scripted', KEN_BASE_URL: baseUrl, KEN_API_KEY_ENV: KEY_ENV, [KEY_ENV]: process.env[KEY_ENV] }
		: {}
	const opened = await openServer({ directory, flags: {}, env: { KEN_HOME: home, ...model }, port: 0 })
	if (opened.kind !== 'ok') throw new Error(opened.message)
	after(() => opened.server.close())
	return opened.server
}

// Sends a request the way the page does, from the server's own origin, unless headers say otherwise.
function send(server: KenServer, route: string, options: { body?: object; headers?: Record<string, string> } = {}) {
	const url = new URL(route, server.url)
	const req = httpRequest(url, {
		method: options.body ? 'POST' : 'GET',
		headers: { origin: url.origin, 'content-type': 'application/json', ...options.headers },
	})
	const response = new Promise<{ status: number; text: string }>((resolve, reject) => {
		req.on('error', reject)
		req.on('response', (res) => {
			let text = ''
			res.on('data', (chunk) => (text += chunk))
			res.on('error', reject)
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
		})
	})
	req.end(options.body ? JSON.stringify(options.body) : undefined)
	return { response, abort: () => req.destroy() }
}

async function json(server: KenServer, route: string) {
	const { status, text } = await send(server, route).response
	assert.equal(status, 200, text)
	return JSON.parse(text)
}

async function ask(server: KenServer, question: string) {
	const { status, text } = await send(server, '/api/questions', { body: { question } }).response
	assert.equal(status, 200, text)
	return text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))
}

test('a question streams its steps and a checked answer with its diagram drawn, and the history shows it again with no model, from a clone too', async () => {
	const home = tempFolder('ken-home-')
	const model = await scriptedModel([READ, ANSWER, { text: 'I left out the tests.' }])
	const server = await open(home, model.baseUrl)

	const lines = await ask(server, 'What did the last commit do?')

	assert.deepEqual(
		lines.map((line) => line.kind).filter((kind) => kind !== 'text'),
		['tool', 'tool', 'accepted', 'usage', 'done', 'saved'],
	)
	assert.match(lines[0].step, /^Read `src\/retry\.ts`, lines 1 to 3$/)
	const accepted = lines.find((line) => line.kind === 'accepted')
	assert.deepEqual(accepted.answer.statements[0].quotes, [{ ...SLEEP, startLine: 4, endLine: 4 }])
	const [diagram] = accepted.answer.diagrams
	assert.match(
		diagram.mermaid,
		/^flowchart LR\n.*"3\. calls"/s,
		'the diagram arrives with the Mermaid text that draws it',
	)
	assert.deepEqual(
		diagram.elements.map((element: { number: number; text: string }) => [element.number, element.text]),
		[
			[1, 'retry'],
			[2, 'sleep'],
			[3, 'retry calls sleep'],
		],
	)
	const saved = lines.at(-1).view
	assert.equal(saved.entry.outcome, 'answered')
	assert.equal(saved.entry.note, 'I left out the tests.')
	assert.deepEqual(
		saved.recorded.map((entry: { kind: string }) => entry.kind),
		['decision'],
	)
	await server.close()
	const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
		cwd: root,
		encoding: 'utf8',
	})
	for (const line of status.trim().split('\n')) {
		assert.match(line, /^\?\? \.ken\/(record\/|\.gitattributes)/, 'the repository gains only the project record')
	}
	execFileSync('git', ['add', '.ken'], { cwd: root })
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'chore: update the ken record'], {
		cwd: root,
	})

	// The next day: a clone of the project, a new server with no model, the same home folder.
	const clone = tempFolder('ken-clone-')
	execFileSync('git', ['clone', '--quiet', root, clone])
	const later = await open(home, null, clone)
	const { questions } = await json(later, '/api/questions')
	assert.deepEqual(questions, [
		{
			id: saved.entry.id,
			question: 'What did the last commit do?',
			askedAt: saved.entry.askedAt,
			outcome: 'answered',
			statements: 1,
			decisions: 1,
			hunks: { uncovered: 0, total: 1 },
		},
	])
	const reopened = await json(later, `/api/questions/${saved.entry.id}`)
	assert.deepEqual(reopened.entry.answer, accepted.answer, 'the reopened answer carries the same drawings')
	assert.deepEqual(reopened.recorded, saved.recorded)
	const recordCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim()
	assert.deepEqual(
		[reopened.entry.head, reopened.head],
		[head, recordCommit],
		'the answer keeps the HEAD it was asked at, and the view says where HEAD is now',
	)
})

test('a question saved before ken kept the HEAD still opens, with no HEAD of its own', async () => {
	const home = tempFolder('ken-home-')
	const old = { id: 'old-1', question: 'What changed?', askedAt: '2026-11-01T10:00:00.000Z', steps: [], usage: null }
	mkdirSync(path.join(home, 'projects', base), { recursive: true })
	writeFileSync(
		path.join(home, 'projects', base, 'history.jsonl'),
		`${JSON.stringify({ ...old, outcome: 'stopped' })}\n`,
	)
	const server = await open(home, null)

	const view = await json(server, '/api/questions/old-1')

	const headNow = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
	assert.deepEqual([view.entry.question, view.entry.head, view.head], ['What changed?', null, headNow])
})

test('a second question about the same commits shows the decision the first one recorded', async () => {
	const work = { work: { title: 'Retries wait' } }
	const first: Turn = { tool: 'ken__answer', args: { ...ANSWER.args, ...work } }
	// The prompt tells the model not to send a decision the record already has.
	const again: Turn = { tool: 'ken__answer', args: { ...ANSWER.args, ...work, decisions: [] } }
	const model = await scriptedModel([first, { text: 'Done.' }, again, { text: 'Done.' }])
	const repo = tempFolder('ken-clone-')
	execFileSync('git', ['clone', '--quiet', root, repo])
	const server = await open(tempFolder('ken-home-'), model.baseUrl, repo)

	await ask(server, 'What did the last commit do?')
	const lines = await ask(server, 'What did the last commit do, in short?')

	const decisions = (recorded: { kind: string; question?: string }[]) =>
		recorded.filter((entry) => entry.kind === 'decision').map((entry) => entry.question)
	const shown = ['How long does a retry wait?']
	assert.deepEqual(decisions(lines.find((line) => line.kind === 'accepted').recorded), shown, 'while the note streams')
	assert.deepEqual(decisions(lines.at(-1).view.recorded), shown, 'once saved')
	const { questions } = await json(server, '/api/questions')
	assert.deepEqual(
		questions.map((row: { decisions: number }) => row.decisions),
		[1, 1],
	)
})

test('closing the request stops the question, and the server then takes the next one', {
	timeout: 10_000,
}, async () => {
	let modelWaits = () => {}
	const waiting = new Promise<void>((resolve) => (modelWaits = resolve))
	const model = await scriptedModel([{ hang: modelWaits }, ANSWER, { text: 'Done.' }])
	const server = await open(tempFolder('ken-home-'), model.baseUrl)

	const first = send(server, '/api/questions', { body: { question: 'What changed?' } })
	await waiting
	first.abort()
	await first.response.catch(() => {})
	const lines = await ask(server, 'What changed, in one statement?')

	assert.equal(lines.at(-1).view.entry.outcome, 'answered')
	const { questions } = await json(server, '/api/questions')
	assert.deepEqual(
		questions.map((row: { question: string; outcome: string }) => [row.question, row.outcome]),
		[
			['What changed?', 'stopped'],
			['What changed, in one statement?', 'answered'],
		],
	)
})

test('a request for another host, or a question from another origin, is refused', async () => {
	const server = await open(tempFolder('ken-home-'), null)
	const ours = new URL(server.url)
	const cases = [
		{ route: '/api/questions', headers: { host: 'attacker.example' } },
		{ route: '/api/questions', headers: { host: `attacker.example:${ours.port}` } },
		{ route: '/api/questions', body: { question: 'What changed?' }, headers: { origin: 'http://attacker.example' } },
		{ route: '/api/questions', body: { question: 'What changed?' }, headers: { origin: '' } },
	]
	for (const { route, body, headers } of cases) {
		const { status } = await send(server, route, body ? { body, headers } : { headers }).response
		assert.equal(status, 403, `refused: ${JSON.stringify(headers)}`)
	}
	assert.equal(
		(await send(server, '/api/questions').response).status,
		200,
		'the same request from ken itself is served',
	)
})

test('with no model set the server still starts, and its state names each setting to give', async () => {
	const server = await open(tempFolder('ken-home-'), null)

	const { model } = await json(server, '/api/state')
	assert.equal(model.kind, 'unset')
	assert.deepEqual(
		model.missing.map((setting: { name: string }) => setting.name),
		['KEN_MODEL', 'KEN_BASE_URL', 'KEN_API_KEY_ENV'],
	)
	const asked = await send(server, '/api/questions', { body: { question: 'What changed?' } }).response
	assert.equal(asked.status, 503)
	assert.equal((await send(server, '/').response).status, 200, 'the page is served all the same')
})
