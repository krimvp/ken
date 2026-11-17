import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { replyIn, sentBackIn } from '../fixtures/chat-events.ts'
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
	reason: 'One fixed wait is the simplest that works.',
	reason_quotes: [],
	rejected: [],
	undo: 'easy',
	needs_owner: false,
	quotes: [SLEEP],
}
const TOPIC = { name: 'retry logic', quotes: [SLEEP], note: 'retry calls attempt, then sleeps 100 ms.' }

function show(extra: Record<string, unknown>): Turn {
	return {
		tool: 'ken__show',
		text: 'Retries now wait 100 ms.',
		args: { scope: { base, head }, claims: [STATEMENT], ...extra },
	}
}

// A new chat each time, the way a new ken process starts, so what one question wrote must come back from disk.
async function ask(script: Turn[]) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the last commit do?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

function firstPrompt(request: ChatRequest | undefined): string {
	return JSON.stringify(request?.messages.filter((message) => message.role === 'user') ?? [])
}

test('a reply stores its work, decision and topic when it ends, and the next question starts from them', async () => {
	const first = await ask([
		show({ work: { title: 'Retries wait' }, decisions: [DECISION], topics: [TOPIC] }),
		{ text: '' },
	])

	const { recorded } = replyIn(first.events)
	assert.deepEqual(
		recorded.map((entry) => entry.kind),
		['work', 'topic', 'note', 'decision'],
		'the topics go first, so a decision can name one',
	)
	const [work, , , decision] = recorded
	assert.ok(decision?.kind === 'decision')
	assert.deepEqual([decision.label, decision.work], ['inferred', work?.id])
	const onDisk = await fileRecordStore(root, gitRepository(root)).read()
	const byId = (entries: { id: string }[]) => [...entries].sort((a, b) => a.id.localeCompare(b.id))
	assert.deepEqual(byId(onDisk.current), byId(recorded))

	const second = await ask([
		{ tool: 'ken__read_record', args: { id: work?.id } },
		show({ work: { title: 'Retries wait, again' } }),
		{ text: '' },
	])

	const prompt = firstPrompt(second.requests[0])
	for (const shown of [work?.id, decision.id, 'Retries wait', 'How long does a retry wait?', 'retry logic']) {
		assert.ok(prompt.includes(String(shown)), `the first request of the next question shows ${shown}: ${prompt}`)
	}
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(read.includes('\t\tsleep(100)') && read.includes(head), `read_record gives the stored quote: ${read}`)
	assert.deepEqual(replyIn(second.events).recorded, [], 'the range already has its piece of work')
	assert.equal((await fileRecordStore(root, gitRepository(root)).read()).entries.length, 4)
})

test('a topic named like one in the record, in another case and spacing, is refused and the model is told to reuse it', async () => {
	const store = fileRecordStore(root, gitRepository(root))
	const seeded = await store.append([{ kind: 'topic', name: TOPIC.name, quotes: TOPIC.quotes }])
	const existing = seeded.kind === 'appended' ? seeded.entries[0]?.entry : undefined
	const { events, requests } = await ask([show({ topics: [{ ...TOPIC, name: '  Retry   Logic ' }] }), { text: '' }])

	assert.deepEqual(
		sentBackIn(events).map((step) => step.what),
		['Topic 1'],
	)
	const toModel = toolResults(requests[1])[0] ?? ''
	assert.ok(existing && toModel.includes(existing.id), `the model is told which topic to reuse: ${toModel}`)
	const topics = (await store.read()).entries.filter((e) => e.kind === 'topic')
	assert.equal(topics.length, 1)
})

test('decisions sent as JSON text are stored, raw tabs in its quotes included, and JSON text that lacks a field comes back with the field named', async () => {
	const { undo, ...withoutUndo } = DECISION
	const waits = { ...DECISION, question: 'Does a retry wait after the last attempt too?' }
	const { events, requests } = await ask([
		show({ decisions: JSON.stringify([withoutUndo]) }),
		// The quote holds tab-indented code. A model that writes the tabs raw inside the JSON text makes it invalid JSON.
		show({ decisions: JSON.stringify([waits]).replaceAll('\\t', '\t') }),
		{ text: '' },
	])

	const toModel = toolResults(requests[1])[0] ?? ''
	assert.ok(toModel.includes('decisions, item 1 needs "undo"'), `the model is told what is missing: ${toModel}`)
	const stored = replyIn(events).recorded.find((entry) => entry.kind === 'decision')
	assert.deepEqual(stored?.kind === 'decision' && [stored.question, stored.undo], [waits.question, undo])
})
