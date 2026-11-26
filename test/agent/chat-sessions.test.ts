import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { answered, asked, claudeProjects, writeSession } from '../fixtures/claude-sessions.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

// A change whose commit message gives no reason, and a made-up session in which the user gave one.
const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
	{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
])
const [base = '', head = ''] = hashes
const SESSION = 'retry-wait-session'
const REASON = 'A fixed 100 ms is enough: the queue drains within a second.'
const projects = claudeProjects()
writeSession(projects, root, SESSION, [
	asked(root, '2026-01-02T09:00:00.000Z', `Make retry wait between attempts.\n${REASON}`),
	answered(root, '2026-01-02T09:00:20.000Z', [{ type: 'text', text: 'I will sleep 100 ms after each attempt.' }]),
])
const KEY_ENV = 'KEN_TEST_SESSIONS_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const SLEEP = { path: 'src/retry.ts', commit: head, text: '\t\tsleep(100)' }
const DECISION = {
	question: 'How long does a retry wait?',
	chosen: 'A fixed 100 ms after each attempt',
	reason: 'The queue drains within a second, so a short fixed wait is enough.',
	reason_quotes: [{ session: SESSION, text: REASON }],
	rejected: [],
	undo: 'easy',
	needs_owner: false,
	quotes: [SLEEP],
}

function show(fields: { decisions?: unknown[]; claim?: unknown }): Turn {
	const claim = fields.claim ?? { text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }
	return {
		tool: 'ken__show',
		text: 'Retries now wait 100 ms.',
		args: { scope: { base, head }, claims: [claim], decisions: fields.decisions ?? [] },
	}
}

async function ask(script: Turn[], env: Record<string, string> = {}) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: { KEN_CLAUDE_PROJECTS: projects, ...env },
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('Why does retry wait?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

function sentBack(events: ChatEvent[]) {
	return sentBackIn(events).map((step) => step.what)
}

const VERIFIED = {
	tool: 'Claude Code',
	session: SESSION,
	message: 1,
	by: 'user',
	at: '2026-01-02T09:00:00.000Z',
	startLine: 2,
	endLine: 2,
	text: REASON,
}

test('a decision whose reason quotes a saved session is stored labelled from the session, with its quote, after a false quote of the session comes back with words to fix it', async () => {
	const changed = { ...DECISION, reason_quotes: [{ session: SESSION, text: REASON.replace('100', '200') }] }
	const { events, requests } = await ask([
		show({ decisions: [changed] }),
		show({ decisions: [DECISION] }),
		{ text: '' },
	])

	assert.deepEqual(sentBack(events), ['Decision 1'])
	const fix = toolResults(requests[1])[0] ?? ''
	assert.ok(fix.includes(`not in any message of session ${SESSION}`), `the model is told which session: ${fix}`)
	assert.match(fix, /as read_session shows them/, 'the model is told where to copy the lines from')
	const stored = replyIn(events).recorded.find((entry) => entry.kind === 'decision')
	assert.deepEqual(stored?.kind === 'decision' && [stored.label, stored.reason?.quotes], [
		'from-the-session',
		[VERIFIED],
	])
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find(
		(each) => each.id === stored?.id,
	)
	assert.deepEqual(onDisk?.kind === 'decision' && onDisk.reason?.quotes, [VERIFIED], 'the record keeps the quote')
	const { change } = replyIn(events)
	assert.deepEqual(change?.messages, { quoted: [], unquoted: [head] }, 'a session is no commit message')
})

test('a claim may be "from-the-session" only with a quote of a session, and a quote that names a session and a commit goes back before ken checks it', async () => {
	const said = { session: SESSION, text: 'I will sleep 100 ms after each attempt.' }
	const both = { ...said, commit: head }
	const claim = (quotes: unknown[]) => ({
		text: 'The agent said it would sleep after each attempt.',
		label: 'from-the-session',
		quotes,
	})
	const { events, requests } = await ask([
		show({ claim: claim([both]) }),
		show({ claim: claim([SLEEP]) }),
		show({ claim: claim([said, SLEEP]) }),
		{ text: '' },
	])

	assert.match(toolResults(requests[1])[0] ?? '', /Claim 1 sent back[\s\S]*names a session and a commit/)
	assert.deepEqual(sentBack(events), ['Claim 1', 'Claim 1'])
	assert.match(
		toolResults(requests[2]).at(-1) ?? '',
		/Claim 1: the label "from-the-session" .* none of its quotes is from one/,
	)
	const [first] = cardsIn(events)
	const statement = first?.kind === 'claim' ? first.claim : undefined
	assert.deepEqual(
		[statement?.label, statement?.quotes[0]],
		[
			'from-the-session',
			{
				...VERIFIED,
				message: 2,
				by: 'agent',
				at: '2026-01-02T09:00:20.000Z',
				startLine: 1,
				endLine: 1,
				text: said.text,
			},
		],
	)
})

test('with KEN_SESSIONS=off the session tools say so, no session text reaches the model, and a quote of a session is refused', async () => {
	const { events, requests } = await ask(
		[
			{ tool: 'ken__list_sessions', args: {} },
			{ tool: 'ken__read_session', args: { session: SESSION } },
			{ tool: 'ken__search_sessions', args: { text: 'queue' } },
			show({ decisions: [DECISION] }),
			{ text: '' },
		],
		{ KEN_SESSIONS: 'off' },
	)

	const results = toolResults(requests.at(-1))
	for (const result of results.slice(0, 3)) assert.match(result, /turned it off with KEN_SESSIONS=off/)
	assert.match(results[3] ?? '', /ken reads no saved sessions here, so it cannot check a quote of session/)
	assert.deepEqual(sentBack(events), ['Decision 1'])
	const sent = JSON.stringify(requests.map((request) => toolResults(request)))
	assert.ok(!sent.includes('queue drains') && !sent.includes('Make retry wait'), 'no session text reaches the model')
})

test("a topic shown after the model read a saved session, which holds the reader's own words, stays out of the record; one shown without it goes in", async () => {
	const topic = (name: string): Turn => ({
		tool: 'ken__show',
		text: 'Retry waits.',
		args: { topics: [{ name, note: 'How retry waits between attempts.', quotes: [SLEEP] }] },
	})
	const read = await ask([{ tool: 'ken__read_session', args: { session: SESSION } }, topic('retry wait'), { text: '' }])
	assert.match(toolResults(read.requests[1])[0] ?? '', /the queue drains within a second/, 'the run read the session')
	assert.deepEqual(replyIn(read.events).recorded, [])
	const plain = await ask([topic('retry pause'), { text: '' }])
	assert.deepEqual(
		replyIn(plain.events).recorded.map((entry) => entry.kind),
		['topic', 'note'],
	)
})
