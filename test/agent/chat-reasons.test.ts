import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

// A branch of two commits with bodies, merged in. The first commit's message gives the reason for its choice and
// leaves another to the owner; the merge's message is the merging tool's.
const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const REASON = 'A fixed wait keeps the retry simple.'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
	{
		message: 'feat: wait between attempts',
		body: `${REASON}\nWhether to back off instead is the owner's call.`,
		files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` },
	},
	{
		message: 'docs: say how long',
		body: 'The README says how long a retry waits.',
		files: { 'README.md': 'Waits.\n' },
	},
	{ message: "Merge branch 'wait'", parent: 0, merge: 2, files: {} },
])
const [base = '', waits = '', docs = '', merge = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const SLEEP = { path: 'src/retry.ts', commit: merge, text: '\t\tsleep(100)' }
const DECISION = {
	question: 'How long does a retry wait?',
	chosen: 'A fixed 100 ms after each attempt',
	reason: 'A fixed wait keeps the retry simple.',
	reason_quotes: [{ commit: waits, text: REASON }],
	rejected: [],
	undo: 'easy',
	needs_owner: false,
	quotes: [SLEEP],
}

function answer(decisions: unknown): Turn {
	return {
		tool: 'ken__answer',
		args: {
			scope: { base, head: merge },
			summary: 'Retries now wait 100 ms.',
			statements: [{ text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }],
			risks: [],
			decisions,
		},
	}
}

async function ask(script: Turn[]) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the branch do, and why?')) events.push(event)
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

test('a reason quoted from a commit message is checked like a file quote: half a line comes back with words to fix it, a label the model sends is refused, and the whole line makes the decision recorded', async () => {
	const half = { ...DECISION, reason_quotes: [{ commit: waits, text: 'keeps the retry simple.' }] }
	const labelled = { ...DECISION, reason_quotes: [], label: 'recorded' }
	const { events, requests } = await ask([
		answer([half]),
		answer(JSON.stringify([labelled])),
		answer([DECISION]),
		{ text: 'Done.' },
	])

	assert.deepEqual(outcomes(events), ['rejected', 'rejected', 'accepted'])
	const fix = toolResults(requests[1])[0] ?? ''
	assert.ok(fix.includes(`the message of commit ${waits}`), `the model is told which message: ${fix}`)
	assert.ok(fix.includes(JSON.stringify(REASON)), `the model is shown the whole line: ${fix}`)
	assert.match(toolResults(requests[2]).at(-1) ?? '', /"label", which it does not take/)
	const stored = accepted(events).recorded.find((entry) => entry.kind === 'decision')
	assert.deepEqual(stored?.kind === 'decision' && [stored.label, stored.reason], [
		'recorded',
		{ text: DECISION.reason, quotes: [{ path: null, commit: waits, startLine: 3, endLine: 3, text: REASON }] },
	])
})

test('an accepted answer tells the model which commit messages no quote cites, leaving out the merge, and carries the same count', async () => {
	const { events, requests } = await ask([answer([DECISION]), { text: 'I left out the README commit.' }])

	assert.deepEqual(accepted(events).answer.change?.messages, { quoted: [waits], unquoted: [docs] })
	const told = toolResults(requests[1])[0] ?? ''
	assert.match(told, /cite 1 of 2 commit messages/)
	assert.ok(told.includes(`- ${docs.slice(0, 7)} docs: say how long`), `the model is told which one: ${told}`)
	assert.ok(!told.includes(merge.slice(0, 7)), `the merge is not listed: ${told}`)
})
