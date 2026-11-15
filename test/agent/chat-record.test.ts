import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { type ChatRequest, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
	{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const SLEEP = { path: 'src/retry.ts', commit: head, text: '\t\tsleep(100)' }
const STATEMENT = { text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }
const DECISION = {
	question: 'How long does a retry wait?',
	chosen: 'A fixed 100 ms after each attempt',
	rejected: [],
	undo: 'easy',
	needs_owner: false,
	quotes: [SLEEP],
}
const TOPIC = { name: 'retry logic', quotes: [SLEEP], note: 'retry calls attempt, then sleeps 100 ms.' }

function answer(extra: Record<string, unknown>): Turn {
	return {
		tool: 'ken__answer',
		args: { scope: { base, head }, summary: 'Retries now wait 100 ms.', statements: [STATEMENT], risks: [], ...extra },
	}
}

// A new chat each time, the way a new ken process starts, so what one question wrote must come back from disk.
async function ask(script: Turn[]) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the last commit do?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

function accepted(events: ChatEvent[]) {
	const event = events.find((each) => each.kind === 'accepted')
	return event?.kind === 'accepted' ? event : assert.fail(`no answer was accepted: ${JSON.stringify(events)}`)
}

function firstPrompt(request: ChatRequest | undefined): string {
	return JSON.stringify(request?.messages.filter((message) => message.role === 'user') ?? [])
}

test('an accepted answer stores its work, decision and topic, and the next question starts from them', async () => {
	const first = await ask([
		answer({ work: { title: 'Retries wait' }, decisions: [DECISION], topics: [TOPIC] }),
		{ text: 'Done.' },
	])

	const { recorded } = accepted(first.events)
	assert.deepEqual(
		recorded.map((entry) => entry.kind),
		['work', 'decision', 'topic', 'note'],
	)
	const [work, decision] = recorded
	assert.ok(decision?.kind === 'decision')
	assert.deepEqual([decision.label, decision.work], ['inferred', work?.id])
	const onDisk = await fileRecordStore(root, gitRepository(root)).read()
	assert.deepEqual(onDisk.current, recorded)

	const second = await ask([
		{ tool: 'ken__read_record', args: { id: work?.id } },
		answer({ work: { title: 'Retries wait, again' } }),
		{ text: 'Done.' },
	])

	const prompt = firstPrompt(second.requests[0])
	for (const shown of [work?.id, decision.id, 'Retries wait', 'How long does a retry wait?', 'retry logic']) {
		assert.ok(prompt.includes(String(shown)), `the first request of the next question shows ${shown}: ${prompt}`)
	}
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(read.includes('\t\tsleep(100)') && read.includes(head), `read_record gives the stored quote: ${read}`)
	assert.deepEqual(accepted(second.events).recorded, [], 'the range already has its piece of work')
	assert.equal((await fileRecordStore(root, gitRepository(root)).read()).entries.length, 4)
})

test('a topic named like one in the record, in another case and spacing, is refused and the model is told to reuse it', async () => {
	const store = fileRecordStore(root, gitRepository(root))
	const seeded = await store.append([{ kind: 'topic', name: TOPIC.name, quotes: TOPIC.quotes }])
	const existing = seeded.kind === 'appended' ? seeded.entries[0]?.entry : undefined
	const { events, requests } = await ask([
		answer({ topics: [{ ...TOPIC, name: '  Retry   Logic ' }] }),
		answer({}),
		{ text: 'Done.' },
	])

	assert.deepEqual(
		events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind),
		['rejected', 'accepted'],
	)
	const toModel = toolResults(requests[1])[0] ?? ''
	assert.ok(existing && toModel.includes(existing.id), `the model is told which topic to reuse: ${toModel}`)
	const topics = (await store.read()).entries.filter((e) => e.kind === 'topic')
	assert.equal(topics.length, 1)
})

test('decisions sent as JSON text are stored, raw tabs in its quotes included, and JSON text that lacks a field is rejected with the field named', async () => {
	const { undo, ...withoutUndo } = DECISION
	const waits = { ...DECISION, question: 'Does a retry wait after the last attempt too?' }
	const { events, requests } = await ask([
		answer({ decisions: JSON.stringify([withoutUndo]) }),
		// The quote holds tab-indented code. A model that writes the tabs raw inside the JSON text makes it invalid JSON.
		answer({ decisions: JSON.stringify([waits]).replaceAll('\\t', '\t') }),
		{ text: 'Done.' },
	])

	assert.deepEqual(
		events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind),
		['rejected', 'accepted'],
	)
	const toModel = toolResults(requests[1])[0] ?? ''
	assert.ok(toModel.includes('decisions, item 1 needs "undo"'), `the model is told what is missing: ${toModel}`)
	const stored = accepted(events).recorded.find((entry) => entry.kind === 'decision')
	assert.deepEqual(stored?.kind === 'decision' && [stored.question, stored.undo], [waits.question, undo])
})
