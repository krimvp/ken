import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { answered, asked, claudeProjects, writeSession } from '../fixtures/claude-sessions.ts'
import { DRAFT, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

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

function answer(fields: { decisions?: unknown[]; statement?: unknown }): Turn {
	const statement = fields.statement ?? {
		text: 'The loop sleeps after each attempt.',
		label: 'inferred',
		quotes: [SLEEP],
	}
	return {
		tool: 'ken__answer',
		args: {
			scope: { base, head },
			summary: 'Retries now wait 100 ms.',
			statements: [statement],
			risks: [],
			decisions: fields.decisions ?? [],
		},
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

function outcomes(events: ChatEvent[]) {
	return events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind)
}

function accepted(events: ChatEvent[]) {
	const event = events.find((each) => each.kind === 'accepted')
	return event?.kind === 'accepted' ? event : assert.fail(`no answer was accepted: ${JSON.stringify(events)}`)
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
		DRAFT,
		answer({ decisions: [changed] }),
		answer({ decisions: [DECISION] }),
		{ text: 'Done.' },
	])

	assert.deepEqual(outcomes(events), ['rejected', 'accepted'])
	const fix = toolResults(requests[2])[0] ?? ''
	assert.ok(fix.includes(`not in any message of session ${SESSION}`), `the model is told which session: ${fix}`)
	assert.match(fix, /as read_session shows them/, 'the model is told where to copy the lines from')
	const stored = accepted(events).recorded.find((entry) => entry.kind === 'decision')
	assert.deepEqual(stored?.kind === 'decision' && [stored.label, stored.reason?.quotes], [
		'from-the-session',
		[VERIFIED],
	])
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find(
		(each) => each.id === stored?.id,
	)
	assert.deepEqual(onDisk?.kind === 'decision' && onDisk.reason?.quotes, [VERIFIED], 'the record keeps the quote')
	const change = accepted(events).answer.change
	assert.deepEqual(change?.messages, { quoted: [], unquoted: [head] }, 'a session is no commit message')
})

test('a statement may claim "from-the-session" only with a quote of a session, and a quote that names a session and a commit goes back without using an attempt', async () => {
	const said = { session: SESSION, text: 'I will sleep 100 ms after each attempt.' }
	const both = { ...said, commit: head }
	const claim = (quotes: unknown[]) => ({
		text: 'The agent said it would sleep after each attempt.',
		label: 'from-the-session',
		quotes,
	})
	const { events, requests } = await ask([
		DRAFT,
		answer({ statement: claim([both]) }),
		answer({ statement: claim([SLEEP]) }),
		answer({ statement: claim([said, SLEEP]) }),
		{ text: 'Done.' },
	])

	assert.match(toolResults(requests[2])[0] ?? '', /did not use one of your attempts[\s\S]*names a session and a commit/)
	assert.deepEqual(outcomes(events), ['rejected', 'accepted'])
	assert.match(
		toolResults(requests[3]).at(-1) ?? '',
		/Statement 1: the label "from-the-session" .* none of its quotes is from one/,
	)
	const [statement] = accepted(events).answer.statements
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
			DRAFT,
			answer({ decisions: [DECISION] }),
			{ text: 'Done.' },
		],
		{ KEN_SESSIONS: 'off' },
	)

	const results = toolResults(requests.at(-1))
	for (const result of results.slice(0, 3)) assert.match(result, /turned it off with KEN_SESSIONS=off/)
	assert.match(results[3] ?? '', /ken reads no saved sessions here, so it cannot check a quote of session/)
	assert.deepEqual(outcomes(events), ['rejected'])
	const sent = JSON.stringify(requests.map((request) => toolResults(request)))
	assert.ok(!sent.includes('queue drains') && !sent.includes('Make retry wait'), 'no session text reaches the model')
})
