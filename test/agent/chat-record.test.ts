import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { type Asking, type ChatEvent, startChat } from '../../src/agent/index.ts'
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
async function ask(script: Turn[], directory = root, question = 'What did the last commit do?', as?: Asking) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask(question, undefined, as)) events.push(event)
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
		{ tool: 'ken__memory_known', args: { about: work?.id } },
		show({ work: { title: 'Retries wait, again' } }),
		{ text: '' },
	])

	const prompt = firstPrompt(second.requests[0])
	for (const shown of [work?.id, decision.id, 'Retries wait', 'How long does a retry wait?', 'retry logic']) {
		assert.ok(prompt.includes(String(shown)), `the first request of the next question shows ${shown}: ${prompt}`)
	}
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(read.includes('\t\tsleep(100)') && read.includes(head), `memory_known gives the stored quote: ${read}`)
	assert.deepEqual(replyIn(second.events).recorded, [], 'the range already has its piece of work')
	assert.equal((await fileRecordStore(root, gitRepository(root)).read()).entries.length, 4)
})

test('a question recalls a matching note before browsing other topics, and drops the note when its code changes', async () => {
	const built = buildRepository([
		{ message: 'initial wait', files: { 'retry.ts': 'sleep(100)' } },
		{ message: 'shorter wait', files: { 'retry.ts': 'sleep(10)' } },
	])
	const [before = '', after = ''] = built.hashes
	const at = (commit: string) => execFileSync('git', ['checkout', '--quiet', '--detach', commit], { cwd: built.root })
	at(before)
	const store = fileRecordStore(built.root, gitRepository(built.root))
	const quotes = [{ path: 'retry.ts', commit: before, text: 'sleep(100)' }]
	const target = await store.append([{ kind: 'topic', name: 'Backoff', quotes }])
	assert.ok(target.kind === 'appended' && target.entries[0])
	const id = target.entries[0].entry.id
	const note = 'Each attempt waits a tenth of a second.'
	const others = Array.from({ length: 32 }, (_, i) => ({ kind: 'topic' as const, name: `Workshop ${i}`, quotes }))
	assert.equal((await store.append([{ kind: 'note', topic: id, text: note }, ...others])).kind, 'appended')
	const question = 'Explain backoff.'
	const lens: Asking = { kind: 'answer', concept: 'part::Backoff', text: question, paths: [] }
	const first = await ask(
		[{ tool: 'ken__memory_search', args: { kind: 'topic', words: 'Workshop', page: 2 } }, { text: 'Done.' }],
		built.root,
		`${question}\nWorkshop examples 0 to 31 illustrate the format. Read the code in retry.ts.`,
		lens,
	)
	const prompt = firstPrompt(first.requests[0])
	assert.ok(prompt.includes(id) && prompt.includes(note), prompt)
	assert.ok(!prompt.includes('Workshop 0'), prompt)
	assert.match(toolResults(first.requests[1])[0] ?? '', /"Workshop 0"/)
	at(after)
	const next = await ask([{ text: 'Done.' }], built.root, question)
	const changed = firstPrompt(next.requests[0])
	assert.ok(changed.includes('stale') && changed.includes('retry.ts') && !changed.includes(note), changed)
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

function freshRepository() {
	return buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
		{ message: 'feat: wait between attempts', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
	]).root
}

test('a card too long for the record goes back from show while the model can fix it, and the rest of the reply is stored', async () => {
	const directory = freshRepository()
	const long = { ...STATEMENT, text: `The loop sleeps. ${'It waits. '.repeat(130)}` }
	const { events, requests } = await ask(
		[show({ work: { title: 'Retries wait' }, claims: [STATEMENT, long], decisions: [DECISION] }), { text: '' }],
		directory,
	)

	const toModel = toolResults(requests[1])[0] ?? ''
	assert.match(toModel, /Claim 2 sent back\.[\s\S]*keep it under 1200/, 'the model is told while it can still fix it')
	assert.deepEqual(
		replyIn(events).recorded.map((entry) => entry.kind),
		['work', 'decision'],
	)
})

test('an entry the record refuses when the reply ends leaves out only that entry, and the reader is told why', async () => {
	const directory = freshRepository()
	const other = { ...TOPIC, name: 'Retry-logic', quotes: [{ ...SLEEP, text: RETRY.split('\n')[0] }] }
	const { events } = await ask(
		[show({ work: { title: 'Retries wait' }, decisions: [DECISION], topics: [TOPIC, other] }), { text: '' }],
		directory,
	)

	const stored = (await fileRecordStore(directory, gitRepository(directory)).read()).current
	assert.deepEqual(stored.map((entry) => entry.kind).sort(), ['decision', 'note', 'topic', 'work'])
	const told = sentBackIn(events).find((step) => step.what === 'The project record')
	assert.match(told?.problems.join(' ') ?? '', /Retry-logic/)
})

test('a decision may name a topic the same call sends, and goes back with it when that topic goes back', async () => {
	const directory = freshRepository()
	const backoff = { ...TOPIC, name: 'backoff', quotes: [{ ...SLEEP, text: '    sleep(100)' }] }
	const waits = { ...DECISION, topic: TOPIC.name }
	const grows = { ...DECISION, question: 'Does the wait grow?', topic: backoff.name }
	const { events } = await ask(
		[show({ work: { title: 'Retries wait' }, decisions: [waits, grows], topics: [TOPIC, backoff] }), { text: '' }],
		directory,
	)

	assert.deepEqual(
		sentBackIn(events)
			.map((step) => step.what)
			.sort(),
		['Decision 2', 'Topic 2'],
	)
	const decisions = replyIn(events).recorded.flatMap((entry) => (entry.kind === 'decision' ? [entry] : []))
	assert.deepEqual(
		decisions.map((decision) => [decision.question, decision.topic]),
		[[waits.question, TOPIC.name]],
	)
})

test('work sent with no claim tells the model that the piece of work needs one, and a claim sent after stores it', async () => {
	const directory = freshRepository()
	const { events, requests } = await ask(
		[
			{ tool: 'ken__show', args: { scope: { base, head }, work: { title: 'Retries wait' }, decisions: [DECISION] } },
			{ tool: 'ken__show', args: { claims: [STATEMENT] } },
			{ text: 'Retries wait.' },
		],
		directory,
	)

	assert.match(toolResults(requests[1])[0] ?? '', /at least one claim/)
	const work = replyIn(events).recorded.find((entry) => entry.kind === 'work')
	assert.equal(work?.kind === 'work' && work.title, 'Retries wait')
})
