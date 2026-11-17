import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { openSnapshots, takeSnapshot } from '../../src/live/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { type KenServer, openServer } from '../../src/server/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { answered, asked, call, claudeProjects, result, writeSession } from '../fixtures/claude-sessions.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) attempt()\n}\n'
const WAITING = RETRY.replace('attempt()', 'attempt(), sleep(100)')
const WAIT_LINE = '\tfor (let i = 0; i < times; i++) attempt(), sleep(100)'
const KEY_ENV = 'KEN_TEST_LIVE_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

function tempFolder(name: string) {
	const folder = mkdtempSync(path.join(tmpdir(), name))
	after(() => rmSync(folder, { recursive: true, force: true }))
	return folder
}

async function open(home: string, baseUrl: string, root: string, env: Record<string, string> = {}) {
	const model = {
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: baseUrl,
		KEN_API_KEY_ENV: KEY_ENV,
		[KEY_ENV]: 'scripted-model-key',
	}
	const opened = await openServer({ directory: root, flags: {}, env: { KEN_HOME: home, ...model, ...env }, port: 0 })
	if (opened.kind !== 'ok') throw new Error(opened.message)
	after(() => opened.server.close())
	return opened.server
}

// The response as it streams: first is the first line, all the whole body.
function send(server: KenServer, route: string, body?: object) {
	const url = new URL(route, server.url)
	const req = httpRequest(url, {
		method: body ? 'POST' : 'GET',
		headers: { origin: url.origin, 'content-type': 'application/json' },
	})
	let first = (_line: string) => {}
	const firstLine = new Promise<string>((resolve) => (first = resolve))
	const all = new Promise<{ status: number; text: string }>((resolve, reject) => {
		req.on('error', reject)
		req.on('response', (res) => {
			let text = ''
			res.on('data', (chunk) => {
				text += chunk
				if (text.includes('\n')) first(text.split('\n')[0] ?? '')
			})
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
		})
	})
	req.end(body ? JSON.stringify(body) : undefined)
	return { firstLine, all }
}

async function live(server: KenServer, action?: string) {
	const { status, text } = await send(server, '/api/live', action ? { action } : undefined).all
	assert.equal(status, 200, text)
	return JSON.parse(text)
}

// Live mode reads the project every two seconds, so a test waits for what it caused, up to a deadline.
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	const deadline = Date.now() + 15_000
	for (;;) {
		const value = await read()
		if (done(value) || Date.now() > deadline) return value
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

function commit(root: string, files: Record<string, string>, message: string) {
	for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text)
	const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root })
	git('commit', '--quiet', '--all', '--message', message)
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

function noteAbout(base: string, head: string, text: string): Turn & { args: Record<string, unknown> } {
	const quote = { path: 'src/retry.ts', commit: head, text: WAIT_LINE }
	return {
		tool: 'ken__show',
		text,
		args: {
			scope: { base, head },
			claims: [{ text: 'Each attempt now waits 100 ms.', label: 'inferred', quotes: [quote] }],
			decisions: [
				{
					question: 'How long does a retry wait?',
					chosen: 'A fixed 100 ms',
					reason: 'One fixed wait is the simplest that works.',
					reason_quotes: [],
					rejected: [],
					undo: 'easy',
					needs_owner: false,
					quotes: [quote],
				},
			],
		},
	}
}

test('with live on, a commit leads to a note about its range in the live feed without the owner asking, and it is recorded like any reply', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	const note = noteAbout(first, '', 'Retries now wait between attempts.')
	const model = await scriptedModel([note, { text: '' }])
	const server = await open(tempFolder('ken-home-'), model.baseUrl, root)
	assert.equal((await live(server)).status, 'off', 'live mode is off until the owner turns it on')

	await live(server, 'on')
	const head = commit(root, { 'src/retry.ts': WAITING }, 'feat: wait between attempts')
	note.args = noteAbout(first, head, 'Retries now wait between attempts.').args
	const view = await until(
		() => live(server),
		(each) => each.notes.length > 0,
	)

	const [written] = view.notes
	assert.deepEqual(
		{ about: written?.entry.about, outcome: written?.entry.outcome },
		{ about: { kind: 'commits', base: first, head }, outcome: 'answered' },
	)
	assert.equal(written.entry.recorded.length, 1, 'the decision of a note on commits goes into the project record')
	assert.ok(existsSync(path.join(root, '.ken', 'record', 'decisions.jsonl')))
})

test('an uncommitted edit leads to a draft note that quotes the uncommitted line, stays in the history, and adds nothing to the project record; Now shows the edit and the last ask with secrets hidden', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	const home = tempFolder('ken-home-')
	const projects = claudeProjects()
	const secret = 'sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4AsDf'
	writeSession(projects, root, 'live-session', [
		asked(root, '2026-11-16T12:00:00.000Z', 'Add a wait to retry.'),
		answered(root, '2026-11-16T12:00:05.000Z', [call('t1', 'Bash', { command: 'npm test' })]),
		result(root, '2026-11-16T12:00:09.000Z', 't1', 'TOOL OUTPUT THAT NEVER SHOWS'),
		asked(root, '2026-11-16T12:01:00.000Z', `Make it wait 100 ms, and use the key ${secret} on staging.`),
	])
	writeFileSync(path.join(root, 'src/retry.ts'), WAITING)
	// The same work on the same HEAD is the same snapshot, so the scripted model can quote the one ken will take.
	const snapshot = await takeSnapshot(await openSnapshots(home, gitRepository(root), root), gitRepository(root), root)
	if (snapshot.kind !== 'taken') return assert.fail('there is uncommitted work to take')
	const model = await scriptedModel([
		noteAbout(first, snapshot.commit, 'Retries now wait, not yet committed.'),
		{ text: 'Done.' },
	])
	const server = await open(home, model.baseUrl, root, { KEN_CLAUDE_PROJECTS: projects })

	const on = await live(server, 'on')
	assert.deepEqual(
		on.now.files.map((file: { path: string; change: string; added: number; removed: number }) => [
			file.path,
			file.change,
			file.added,
			file.removed,
		]),
		[['src/retry.ts', 'changed', 1, 1]],
	)
	assert.equal(on.now.ask.kind, 'asked')
	assert.match(on.now.ask.text, /Make it wait 100 ms, and use the key \[hidden by ken\]/)
	assert.ok(!JSON.stringify(on).includes(secret), 'the secret is hidden')
	assert.ok(!JSON.stringify(on).includes('TOOL OUTPUT'), 'tool output from the session never shows')

	await live(server, 'note-now')
	const view = await until(
		() => live(server),
		(each) => each.notes.length > 0,
	)
	const [draft] = view.notes
	assert.deepEqual(draft.entry.about, {
		kind: 'uncommitted',
		base: first,
		snapshot: snapshot.commit,
		head: first,
		at: draft.entry.about.at,
	})
	assert.equal(draft.entry.outcome, 'answered')
	const cards = draft.entry.reply.items.flatMap((item: { kind: string; card?: object }) => item.card ?? [])
	assert.deepEqual(
		cards[0].claim.quotes.map((quote: { commit: string; text: string }) => [quote.commit, quote.text]),
		[[snapshot.commit, WAIT_LINE]],
	)
	assert.deepEqual([cards[1].decision.question, cards[1].decision.label], ['How long does a retry wait?', 'inferred'])
	assert.ok(!existsSync(path.join(root, '.ken')), 'nothing went into the project record')
	const history = readFileSync(path.join(home, 'projects', first, 'history.jsonl'), 'utf8')
	assert.ok(history.includes(draft.entry.id), 'the note is in the reader history')
})

test("a question asked while a note is being written waits for it, then runs in the reader's own chat, which never saw the note", async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	const note = { ...noteAbout(first, '', 'Retries now wait.'), held }
	const question = { tool: 'ken__show', text: 'Retry tries again.', args: { claims: [] as object[] } }
	const model = await scriptedModel([note, { text: '' }, question, { text: '' }])
	const server = await open(tempFolder('ken-home-'), model.baseUrl, root)
	await live(server, 'on')
	const head = commit(root, { 'src/retry.ts': WAITING }, 'feat: wait between attempts')
	note.args = noteAbout(first, head, 'Retries now wait.').args
	question.args.claims = [
		{ text: 'Retry waits.', label: 'inferred', quotes: [{ path: 'src/retry.ts', commit: head, text: WAIT_LINE }] },
	]
	await until(
		async () => model.requests.length,
		(n) => n > 0,
	)

	const asking = send(server, '/api/questions', { question: 'What does retry do?' })
	assert.deepEqual(JSON.parse(await asking.firstLine), { kind: 'waiting' })
	assert.equal(model.requests.length, 1, 'the question has not reached the model while the note runs')
	release()
	const { status, text } = await asking.all
	assert.equal(status, 200, text)

	const prompts = model.requests.map((request) => JSON.stringify(request.messages.at(-1)))
	assert.ok(prompts[2]?.includes('What does retry do?'), 'the question starts after the note ends')
	assert.ok(
		!JSON.stringify(model.requests[2]?.messages).includes('ken is watching this project'),
		"the reader's chat holds no turn of the note",
	)
	const lines = text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))
	assert.equal(lines.at(-1).view.entry.outcome, 'answered')
	const view = await live(server)
	assert.equal(view.notes[0].entry.outcome, 'answered')
})

test('turning live mode off and on again does not explain the same uncommitted work twice, and the spend counts only the notes since it was turned on', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	const home = tempFolder('ken-home-')
	writeFileSync(path.join(root, 'src/retry.ts'), WAITING)
	const snapshot = await takeSnapshot(await openSnapshots(home, gitRepository(root), root), gitRepository(root), root)
	if (snapshot.kind !== 'taken') return assert.fail('there is uncommitted work to take')
	const model = await scriptedModel([noteAbout(first, snapshot.commit, 'Retries now wait.'), { text: 'Done.' }])
	const server = await open(home, model.baseUrl, root)

	await live(server, 'on')
	await live(server, 'note-now')
	const noted = await until(
		() => live(server),
		(each) => each.notes.length > 0 && each.status === 'watching',
	)
	const usage = noted.notes[0].entry.usage
	assert.deepEqual(noted.spent, { notes: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })

	await live(server, 'off')
	const again = await live(server, 'on')
	assert.deepEqual(again.spent, { notes: 0, inputTokens: 0, outputTokens: 0 }, 'the note came before live was on again')
	assert.ok(again.since > noted.notes[0].entry.askedAt)
	await live(server, 'note-now')
	const after = await until(
		() => live(server),
		(each) => each.said !== null || each.notes.length > 1,
	)
	assert.equal(after.said, 'Nothing new since the last note.')
	assert.equal(after.notes.length, 1)
	assert.equal(model.requests.length, 2, 'no model call for work a note already explained')
})

test('a note opened as a question shows a short title, and the lines that tell the agent where the snapshot is stay out of what the page lists', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	const home = tempFolder('ken-home-')
	writeFileSync(path.join(root, 'src/retry.ts'), WAITING)
	const snapshot = await takeSnapshot(await openSnapshots(home, gitRepository(root), root), gitRepository(root), root)
	if (snapshot.kind !== 'taken') return assert.fail('there is uncommitted work to take')
	const model = await scriptedModel([
		noteAbout(first, snapshot.commit, 'Retries now wait.'),
		{ text: 'Done.' },
		{ text: 'Done.' },
	])
	const server = await open(home, model.baseUrl, root)
	await live(server, 'on')
	await live(server, 'note-now')
	const view = await until(
		() => live(server),
		(each) => each.notes.length > 0 && each.status === 'watching',
	)
	const note = view.notes[0].entry

	const asking = send(server, '/api/questions', { lens: { kind: 'note', id: note.id } })
	const [title, ...rest] = JSON.parse(await asking.firstLine).question.split('\n')
	const time = new Date(note.askedAt).toTimeString().slice(0, 5)
	assert.equal(title, `Go deeper on the ${time} note about uncommitted work`)
	assert.ok(
		rest.every((line: string) => !line.startsWith('- ')),
		'the page lists only the lines that start with "- "',
	)
	assert.ok(rest.join('\n').includes(snapshot.commit.slice(0, 7)), 'the agent learns where the snapshot is')
	await asking.all
})
