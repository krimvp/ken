import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { type EntryDraft, fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { type KenServer, openServer } from '../../src/server/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { asked, claudeProjects, writeSession } from '../fixtures/claude-sessions.ts'
import { nothingToRevise, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const HISTORY = [
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
	{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
]
const { root, hashes } = buildRepository(HISTORY)
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_SERVER_KEY'
const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
process.env[KEY_ENV] = 'scripted-model-key'

function tempFolder(name: string) {
	const folder = mkdtempSync(path.join(tmpdir(), name))
	after(() => rmSync(folder, { recursive: true, force: true }))
	return folder
}

const SLEEP = { path: 'src/retry.ts', commit: head, text: '\t\tsleep(100)' }
const RETRY_LINE = { path: 'src/retry.ts', commit: head, text: 'export function retry(times: number) {' }
const READ: Turn = {
	text: 'Let me read the file.',
	tool: 'ken__read_file',
	args: { path: 'src/retry.ts', start: 1, end: 3 },
}
const SHOW: Turn = {
	tool: 'ken__show',
	text: 'Each retry now waits before the next attempt.',
	args: {
		scope: { base, head },
		claims: [{ text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }],
		risks: [
			{
				text: 'A caller that needs an answer at once now waits 100 ms.',
				label: 'inferred',
				quotes: [SLEEP],
				weight: 'serious',
			},
		],
		diagrams: [
			{
				kind: 'component',
				title: 'What retry does between attempts',
				label: 'inferred',
				boxes: [{ name: 'retry', quotes: [RETRY_LINE] }, { name: 'sleep' }],
				arrows: [
					{ from: 'retry', to: 'sleep', text: 'calls', quotes: [SLEEP] },
					{ from: 'sleep', to: 'retry', text: 'returns to', quotes: [SLEEP] },
				],
			},
		],
		decisions: [
			{
				question: 'How long does a retry wait?',
				chosen: 'A fixed 100 ms',
				reason: 'One fixed wait is the simplest that works.',
				reason_quotes: [],
				rejected: [],
				undo: 'easy',
				needs_owner: true,
				quotes: [SLEEP],
			},
		],
	},
}

async function open(
	home: string,
	baseUrl: string | null,
	directory = root,
	env: Record<string, string> = {},
): Promise<KenServer> {
	const model = baseUrl
		? { KEN_MODEL: 'scripted', KEN_BASE_URL: baseUrl, KEN_API_KEY_ENV: KEY_ENV, [KEY_ENV]: process.env[KEY_ENV] }
		: {}
	const opened = await openServer({ directory, flags: {}, env: { KEN_HOME: home, ...model, ...env }, port: 0 })
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

test('a question streams its steps, the words and the cards in order, a diagram with its drawing, and the history shows it again with no model, from a clone too', async () => {
	const home = tempFolder('ken-home-')
	const model = await scriptedModel([READ, SHOW, { text: '' }, ...nothingToRevise(1)])
	const server = await open(home, model.baseUrl)

	const lines = await ask(server, 'What did the last commit do?')

	assert.deepEqual(
		lines.map((line) => line.kind).filter((kind) => kind !== 'text'),
		[
			'asked',
			'tool',
			'step',
			'tool',
			'item',
			'item',
			'item',
			'item',
			'tool',
			'item',
			'replied',
			'usage',
			'done',
			'saved',
		],
	)
	assert.match(lines.find((line) => line.kind === 'tool').step, /^Read `src\/retry\.ts`, lines 1 to 3$/)
	assert.deepEqual(lines.find((line) => line.kind === 'step').step, { kind: 'text', text: 'Let me read the file.' })
	const items = lines.filter((line) => line.kind === 'item').map((line) => line.item)
	assert.deepEqual(items[0], { kind: 'words', text: 'Each retry now waits before the next attempt.' })
	assert.deepEqual(
		items.slice(1).map((item: { card: { kind: string } }) => item.card.kind),
		['diagram', 'claim', 'decision', 'risk'],
		'the risk comes after the second look',
	)
	assert.deepEqual(items[2].card.claim.quotes, [{ ...SLEEP, startLine: 4, endLine: 4 }])
	const { diagram } = items[1].card
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
			[3, 'From retry to sleep: calls'],
			[4, 'From sleep to retry: returns'],
		],
	)
	const replied = lines.find((line) => line.kind === 'replied')
	assert.deepEqual(replied.reply.items, items, 'the reply as saved is what streamed')
	const saved = lines.at(-1).view
	assert.equal(saved.entry.outcome, 'answered')
	assert.deepEqual(saved.entry.reply, replied.reply)
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
			thread: saved.entry.thread,
			outcome: 'answered',
			cards: 4,
			calls: 1,
			risks: 1,
			hunks: { uncovered: 0, total: 1 },
		},
	])
	const reopened = await json(later, `/api/questions/${saved.entry.id}`)
	assert.deepEqual(reopened.entry.reply, replied.reply, 'the reopened reply carries the same drawings')
	const recordCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim()
	assert.deepEqual(
		[reopened.entry.head, reopened.head],
		[head, recordCommit],
		'the reply keeps the HEAD it was asked at, and the view says where HEAD is now',
	)
})

test('a question saved before ken kept the HEAD still opens with no HEAD of its own, and answers saved before ken replied in words, before risks, before the diagram rules, before the commit message count, before the names used elsewhere and before ken marked a risk checked open as replies, as they were', async () => {
	const home = tempFolder('ken-home-')
	const old = { id: 'old-1', question: 'What changed?', askedAt: '2026-11-01T10:00:00.000Z', steps: [], usage: null }
	// An answered question as ken wrote it at f3e1e61, before answers carried risks. Its diagram has one arrow and a box
	// no arrow joins, which the diagram check refuses in a new reply.
	const quotes = [{ ...SLEEP, startLine: 4, endLine: 4 }]
	const statement = { text: 'The loop sleeps.', label: 'inferred', quotes }
	const boxes = ['retry', 'sleep', 'clock'].map((name, at) => ({ number: at + 1, name, group: null, quotes: [] }))
	const arrow = { number: 4, from: 'retry', to: 'sleep', text: 'calls', label: 'inferred', quotes }
	const diagram = { kind: 'component', title: 'Retry', label: 'inferred', boxes, arrows: [arrow] }
	const answer = { summary: 'Retries wait.', statements: [statement], diagrams: [diagram], change: null }
	const answered = {
		...old,
		id: 'old-2',
		head,
		outcome: 'answered',
		answer,
		recorded: [],
		note: 'I left out the clock.',
	}
	// An answer about a change as ken wrote it at 0d81f71, before it counted the quoted commit messages.
	const change = { base, head, commits: [], covered: [], uncovered: [], binary: [] }
	const risk = { text: 'A caller that needs an answer at once now waits.', label: 'inferred', quotes }
	const counted = { ...answered, id: 'old-3', answer: { ...answer, diagrams: [], risks: [risk], change }, note: '' }
	// One whose every answer ken rejected, before a card could be sent back alone.
	const rejected = {
		...old,
		id: 'old-4',
		outcome: 'rejected',
		steps: [{ kind: 'rejected', attempt: 1, problems: ['A quote is not there.'] }],
	}
	mkdirSync(path.join(home, 'projects', base), { recursive: true })
	writeFileSync(
		path.join(home, 'projects', base, 'history.jsonl'),
		[{ ...old, outcome: 'stopped' }, answered, counted, rejected].map((entry) => `${JSON.stringify(entry)}\n`).join(''),
	)
	const server = await open(home, null)

	const view = await json(server, '/api/questions/old-1')

	const headNow = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
	assert.deepEqual([view.entry.question, view.entry.head, view.head], ['What changed?', null, headNow])
	const reopened = await json(server, '/api/questions/old-2')
	const { items } = reopened.entry.reply
	assert.deepEqual(
		items.map((item: { kind: string; text?: string; card?: { kind: string } }) => item.text ?? item.card?.kind),
		['Retries wait.', 'diagram', 'claim', 'I left out the clock.'],
		'the summary and the note become words, the rest cards',
	)
	assert.deepEqual(items[2].card.claim, statement)
	const drawn = items[1].card.diagram
	assert.match(drawn.mermaid, /^flowchart LR\n.*n3\["3\. clock"\].*"4\. calls"/s, 'the old diagram still draws')
	assert.equal(drawn.elements.length, 4)
	const before = await json(server, '/api/questions/old-3')
	assert.deepEqual(
		before.entry.reply.change,
		{ ...change, messages: null, usedElsewhere: null },
		'no count and no names, rather than a count of none and an empty list',
	)
	assert.deepEqual(
		before.entry.reply.items[1].card.risk,
		risk,
		'its risk reads with no mark of a check, rather than "not checked"',
	)
	const failed = await json(server, '/api/questions/old-4')
	assert.deepEqual(
		[failed.entry.outcome, failed.entry.steps],
		['no-answer', [{ kind: 'sent-back', what: 'Answer 1', problems: ['A quote is not there.'] }]],
	)
})

test('closing the request stops the question, and the server then takes the next one', {
	timeout: 10_000,
}, async () => {
	let modelWaits = () => {}
	const waiting = new Promise<void>((resolve) => (modelWaits = resolve))
	const model = await scriptedModel([{ hang: modelWaits }, { text: 'One thing changed: retries wait.' }])
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

test('"I know this" folds a topic in the next answer, a commit to its quoted line unfolds it as changed, and each question starts with the topic states', async () => {
	const repo = tempFolder('ken-clone-')
	execFileSync('git', ['clone', '--quiet', root, repo])
	const home = tempFolder('ken-home-')
	const retryLine = { ...RETRY_LINE, commit: 'HEAD' }
	const explain = (topics: object[] = []): Turn => ({
		tool: 'ken__show',
		text: 'retry calls attempt in a loop and sleeps after each one.',
		args: {
			claims: [{ text: 'retry loops over attempts.', label: 'inferred', quotes: [retryLine], topic: 'Retry logic' }],
			topics,
		},
	})
	const topic = { name: 'retry logic', quotes: [{ ...SLEEP, commit: 'HEAD' }], note: 'retry sleeps 100 ms.' }
	const model = await scriptedModel([explain([topic]), { text: '' }, explain(), { text: '' }, explain(), { text: '' }])
	const server = await open(home, model.baseUrl, repo)
	const states = (list: { topic: string; kind: string }[]) => list.map((state) => [state.topic, state.kind])

	const first = (await ask(server, 'How does retry work?')).find((line) => line.kind === 'replied')
	assert.deepEqual(first.reply.items[1].card.claim.topic, 'retry logic', 'the card names the topic as the record does')
	assert.deepEqual(states(first.topics), [['retry logic', 'met']], 'a question is interest, not understanding')

	const know = await send(server, '/api/map', { body: { signal: 'know', topics: first.reply.topics } }).response
	assert.equal(know.status, 200, know.text)
	const map = await json(server, '/api/map')
	assert.ok(map.file.startsWith(home), `the map lives in the reader's home: ${map.file}`)
	assert.deepEqual(states(map.states), [['retry logic', 'unchanged']])

	const second = (await ask(server, 'How does retry work, again?')).find((line) => line.kind === 'replied')
	assert.deepEqual(states(second.topics), [['retry logic', 'unchanged']], 'the page folds the card of this topic')
	const toModel = questionPrompt(model.requests[2])
	assert.match(
		toModel,
		/retry logic: can follow it, said "I know this" on [\d-]+; understood, and the code is unchanged/,
	)

	writeFileSync(path.join(repo, 'src/retry.ts'), `${RETRY}\t\tsleep(250)\n\t}\n}\n`)
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', 'wait longer'], {
		cwd: repo,
	})
	const third = (await ask(server, 'How does retry work now?')).find((line) => line.kind === 'replied')
	assert.deepEqual(states(third.topics), [['retry logic', 'changed']], 'nothing folds')
	assert.deepEqual(third.topics[0].changed, [{ path: 'src/retry.ts', startLine: 4, endLine: 4 }])
	assert.match(questionPrompt(model.requests[4]), /retry logic: .*the code changed since: src\/retry\.ts line 4/)
})

function questionPrompt(request: { messages: { role: string; content: unknown }[] } | undefined): string {
	const message = request?.messages.findLast((each) => each.role === 'user')
	return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content)
}

test('a decision logged with ken decide shows in the decisions view as recorded, with who logged it, joins the piece of work whose commits came after it, and is marked replaced by a later decision on the same question', async () => {
	const built = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
		{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
	])
	const [first = '', last = ''] = built.hashes
	const git = (...args: string[]) => execFileSync('git', args, { cwd: built.root, stdio: 'ignore' })
	git('checkout', '--quiet', '--detach', first)
	const decide = ['decide', '--question', 'How long does a retry wait?', '--chosen', 'A fixed 100 ms']
	const why = ['--reason', 'The queue drains within a second.', '--undo', 'easy', '--by', 'claude-code']
	execFileSync('node', [KEN, ...decide, ...why, '--repo', built.root], { stdio: 'ignore' })
	git('checkout', '--quiet', 'main')
	const server = await open(tempFolder('ken-home-'), null, built.root)

	const [logged, ...others] = (await json(server, '/api/decisions')).decisions
	assert.deepEqual(others, [])
	assert.deepEqual(
		[logged.decision.question, logged.decision.label, logged.decision.logged, logged.work],
		['How long does a retry wait?', 'recorded', { by: 'claude-code', head: first }, null],
	)
	const store = fileRecordStore(built.root, gitRepository(built.root))
	const statement = { text: 'Retry sleeps.', label: 'inferred' as const, quotes: [{ ...SLEEP, commit: last }] }
	const work = { kind: 'work' as const, title: 'Retry waits', summary: 'Retry waits.', statements: [statement] }
	const added = await store.append([{ ...work, range: { base: first, head: last } }])
	assert.equal(added.kind, 'appended', JSON.stringify(added))
	const [joined] = (await json(server, '/api/decisions')).decisions
	const id = added.kind === 'appended' ? added.entries[0]?.entry.id : null
	assert.deepEqual(joined.work, { id, title: 'Retry waits' })
	assert.equal(joined.replacedBy, null)

	const later = ['decide', '--question', 'how long does a retry wait?', '--chosen', 'A wait that doubles']
	execFileSync('node', [KEN, ...later, ...why, '--repo', built.root], { stdio: 'ignore' })
	const [newer, older] = (await json(server, '/api/decisions')).decisions
	assert.deepEqual(
		[newer.decision.chosen, newer.replacedBy, older.decision.chosen, older.replacedBy],
		['A wait that doubles', null, 'A fixed 100 ms', newer.decision.id],
	)
})

test('what looks like a secret in a saved session reaches the model, the history and the record hidden, in each form ken hides, and the lines around it stay as they were', async () => {
	const built = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
		{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
	])
	const [first = '', last = ''] = built.hashes
	const secrets = {
		prefix: 'sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4AsDf',
		bearer: '9f8e7d6c5b4a3210fedcba98',
		assigned: 'Zx9Qw8Er7Ty6Ui5Op4As',
		environment: 'correct-horse-battery',
	}
	const plain = ['Keep the retry wait fixed at 100 ms.', 'const key = process.env.API_KEY', 'WAIT_MS=100']
	const projects = claudeProjects()
	writeSession(projects, built.root, 'staging-session', [
		asked(
			built.root,
			'2026-01-02T09:00:00.000Z',
			[
				plain[0],
				`Test it on staging with the key ${secrets.prefix}.`,
				`curl -H "Authorization: Bearer ${secrets.bearer}" https://staging.example.com/health`,
				`Deploy with DEPLOY_TOKEN=${secrets.assigned}.`,
				`The staging gateway answers to ${secrets.environment} today.`,
				plain[1],
				plain[2],
			].join('\n'),
		),
	])
	const hidden = [
		'Test it on staging with the key [hidden by ken].',
		'curl -H "Authorization: Bearer [hidden by ken]" https://staging.example.com/health',
		'Deploy with DEPLOY_TOKEN=[hidden by ken].',
		'The staging gateway answers to [hidden by ken] today.',
	].join('\n')
	const session = (text: string) => ({ session: 'staging-session', text })
	const model = await scriptedModel([
		{ tool: 'ken__read_session', args: { session: 'staging-session' } },
		{
			tool: 'ken__show',
			text: 'Retries wait 100 ms.',
			args: {
				work: { title: 'Retry waits' },
				scope: { base: first, head: last },
				claims: [{ text: 'The owner gave a staging setup.', label: 'from-the-session', quotes: [session(hidden)] }],
				decisions: [
					{
						question: 'How long does a retry wait?',
						chosen: 'A fixed 100 ms',
						reason: 'The owner asked for a fixed wait.',
						reason_quotes: [session(plain[0] ?? '')],
						rejected: [],
						undo: 'easy',
						needs_owner: false,
						quotes: [{ ...SLEEP, commit: last }],
					},
				],
			},
		},
		{ text: '' },
	])
	const home = tempFolder('ken-home-')
	const env = { KEN_CLAUDE_PROJECTS: projects, KEN_TEST_GATEWAY_SECRET: secrets.environment }
	const server = await open(home, model.baseUrl, built.root, env)
	const lines = await ask(server, 'Why does retry wait?')
	assert.ok(
		lines.some((line) => line.kind === 'replied'),
		JSON.stringify(lines),
	)

	const read = toolResults(model.requests[1])[0] ?? ''
	for (const line of [...plain, ...hidden.split('\n')]) assert.ok(read.includes(line), `the model reads: ${line}`)
	const history = readFileSync(path.join(home, 'projects', first, 'history.jsonl'), 'utf8')
	const folder = path.join(built.root, '.ken', 'record')
	const record = readdirSync(folder)
		.map((name) => readFileSync(path.join(folder, name), 'utf8'))
		.join('')
	for (const [where, text] of Object.entries({ model: JSON.stringify(model.requests), history, record })) {
		for (const [form, secret] of Object.entries(secrets)) {
			assert.ok(!text.includes(secret), `the ${form} secret does not reach the ${where}`)
		}
		assert.ok(text.includes(JSON.stringify(hidden).slice(1, -1)), `the ${where} holds the hidden lines`)
	}
})

// A repository of its own with the same history, whose record holds these entries, run by the owner.
async function projectWith(drafts: EntryDraft[]) {
	const { root: repo } = buildRepository(HISTORY)
	const appended = await fileRecordStore(repo, gitRepository(repo)).append(drafts)
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
	return { repo, entries: appended.entries.map(({ entry }) => entry) }
}

test("the person lens lists a collaborator's commits and the topics the owner knew that they touched before any model text, and the model's question names them", async () => {
	const at = { path: 'src/retry.ts', commit: 'HEAD' }
	const { repo } = await projectWith([
		{ kind: 'topic', name: 'retry wait', quotes: [{ ...at, text: '\t\tsleep(100)' }] },
		{ kind: 'topic', name: 'retry loop', quotes: [{ ...at, text: '\t\tattempt()' }] },
	])
	const model = await scriptedModel([{ text: 'Bo made the wait four times longer.' }])
	const server = await open(tempFolder('ken-home-'), model.baseUrl, repo)
	const know = await send(server, '/api/map', { body: { signal: 'know', topics: ['retry wait'] } }).response
	assert.equal(know.status, 200, know.text)
	const bo = { GIT_AUTHOR_NAME: 'Bo Helper', GIT_AUTHOR_EMAIL: 'bo@example.com' }
	const commit = (file: string, text: string) => {
		writeFileSync(path.join(repo, file), text)
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'add', file], { cwd: repo })
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', `edit ${file}`], {
			cwd: repo,
			env: { ...process.env, ...bo, GIT_COMMITTER_NAME: 'Bo Helper', GIT_COMMITTER_EMAIL: 'bo@example.com' },
		})
		return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
	}
	const wait = commit('src/retry.ts', `${RETRY}\t\tsleep(400)\n\t}\n}\n`)
	const readme = commit('README.md', '# retry\n')

	const lens = { kind: 'person', author: 'bo@example.com', since: '1d' }
	const { status, text } = await send(server, '/api/questions', { body: { lens } }).response
	assert.equal(status, 200, text)
	const lines = text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))

	assert.equal(lines[0]?.kind, 'asked')
	assert.ok(lines.findIndex((line) => line.kind === 'text') > 0, 'the list comes before anything the model wrote')
	const list = lines[0].question
	for (const named of [wait, readme, 'retry wait']) assert.ok(list.includes(named), `the list names ${named}: ${list}`)
	assert.doesNotMatch(list, /retry loop/, 'a topic the owner never met is not listed, though Bo changed its file')
	const toModel = questionPrompt(model.requests[0])
	for (const named of [wait, readme, 'retry wait']) assert.ok(toModel.includes(named), `the model is told ${named}`)
})

test('"I have decided" through the server reads only the decision and a note, so a caller cannot change what was decided', async () => {
	const sleep = { path: 'src/retry.ts', commit: 'HEAD', text: '\t\tsleep(100)' }
	const { repo, entries } = await projectWith([
		{
			kind: 'decision',
			question: 'How long does a retry wait?',
			chosen: 'A fixed 100 ms',
			reason: { text: 'One fixed wait is the simplest that works.', quotes: [] },
			rejected: [],
			undo: 'easy',
			needsOwner: true,
			quotes: [sleep],
			work: null,
		},
	])
	const server = await open(tempFolder('ken-home-'), null, repo)
	const id = entries[0]?.id
	const openIds = async () => (await json(server, '/api/open')).decisions.map((d: { id: string }) => d.id)
	assert.deepEqual(await openIds(), [id])

	const forged = {
		chosen: 'A wait that doubles',
		needsOwner: true,
		answer: { at: '2000-01-01T00:00:00.000Z', note: 'x' },
	}
	const body = { decision: id, note: 'Make it double.', outcome: 'change', ...forged }
	const { status, text } = await send(server, '/api/decided', { body }).response
	assert.equal(status, 200, text)

	assert.deepEqual(await openIds(), [])
	const current = (await fileRecordStore(repo, gitRepository(repo)).read()).current
	const decision = current.find((entry) => entry.kind === 'decision')
	assert.ok(decision?.kind === 'decision')
	assert.deepEqual(
		{
			chosen: decision.chosen,
			needsOwner: decision.needsOwner,
			answer: decision.answer && { note: decision.answer.note, outcome: decision.answer.outcome },
			replaces: decision.replaces,
		},
		{
			chosen: 'A fixed 100 ms',
			needsOwner: false,
			answer: { note: 'Make it double.', outcome: 'change' },
			replaces: id,
		},
	)
	assert.notEqual(decision.answer?.at, forged.answer.at, 'ken sets when the owner answered')
})

test('the layout comes from git with no model: the query picks the commit, and a commit the project does not have is refused', async () => {
	const server = await open(tempFolder('ken-home-'), null)

	const { look, changes } = await json(server, `/api/layout?at=${base}&within=src`)
	assert.deepEqual(
		look.boxes.map((box: { name: string; state: string }) => [box.name, box.state]),
		[['retry.ts', 'changed']],
	)
	assert.equal(changes[0].name, 'Uncommitted work')
	assert.equal((await send(server, '/api/layout?at=nope').response).status, 400)
})

test('"Ask ken to name these parts" sends the folder split to the model, and the parts it names then show in the layout with no model', async () => {
	const { root: repo } = buildRepository([
		{
			message: 'feat: start',
			files: {
				'src/server/serve.ts': "import { answer } from '../agent/answer.ts'\n",
				'src/agent/answer.ts': 'export function answer() {}\n',
			},
		},
	])
	const layout = {
		within: ['src'],
		parts: [
			{ name: 'Server', job: 'serves the page', paths: ['src/server'] },
			{ name: 'Chat engine', job: 'answers questions', paths: ['src/agent'] },
		],
		arrows: [
			{
				from: 'Server',
				to: 'Chat engine',
				text: 'asks',
				quotes: [{ path: 'src/server/serve.ts', commit: 'HEAD', text: "import { answer } from '../agent/answer.ts'" }],
			},
		],
	}
	const model = await scriptedModel([{ tool: 'ken__show', text: 'Two parts.', args: { layout } }, { text: '' }])
	const server = await open(tempFolder('ken-home-'), model.baseUrl, repo)
	const before = (await json(server, '/api/layout?within=src')).look
	assert.equal(before.named, null)

	const { status, text } = await send(server, '/api/questions', { body: { lens: { kind: 'parts', within: ['src'] } } })
		.response
	assert.equal(status, 200, text)
	const toModel = questionPrompt(model.requests[0])
	for (const shown of ['agent (src/agent, 1 file)', 'server (src/server, 1 file)', '["src"]']) {
		assert.ok(toModel.includes(shown), `the model starts from ${shown}: ${toModel}`)
	}

	const { look } = await json(server, '/api/layout?within=src')
	assert.deepEqual(
		look.boxes.map((box: { name: string; job: string }) => [box.name, box.job]),
		[
			['Server', 'serves the page'],
			['Chat engine', 'answers questions'],
		],
	)
	assert.deepEqual(
		look.arrows.map((arrow: { from: string; text: string; to: string }) => [arrow.from, arrow.text, arrow.to]),
		[['Server', 'asks', 'Chat engine']],
	)
})
