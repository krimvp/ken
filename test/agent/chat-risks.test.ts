import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { nothingToRevise, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

// The change lowers a limit. Its risk sits in a file the change did not touch: a caller that still waits as long as
// the old limit allowed.
const CALLER = 'export async function load() {\n\treturn await fetchWithin(TIMEOUT_MS * 2)\n}\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 500\n', 'src/load.ts': CALLER } },
	{ message: 'fix: time out sooner', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 100\n' } },
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const LIMIT = { path: 'src/limits.ts', commit: head, text: 'export const TIMEOUT_MS = 100' }
const CALL = { path: 'src/load.ts', commit: head, text: '\treturn await fetchWithin(TIMEOUT_MS * 2)' }
const STATEMENT = { text: 'The timeout drops from 500 ms to 100 ms.', label: 'inferred', quotes: [LIMIT] }
const RISK = {
	text: 'load now gives up after 200 ms instead of 1 s.',
	label: 'inferred',
	quotes: [CALL],
	weight: 'serious',
}

function show(args: Record<string, unknown>): Turn {
	return {
		tool: 'ken__show',
		text: 'The timeout is shorter.',
		args: { scope: { base, head }, claims: [STATEMENT], ...args },
	}
}

// A new chat each time, the way a new ken process starts, so the second question reads the first from disk.
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

function risks(events: ChatEvent[]) {
	return cardsIn(events).flatMap((card) => (card.kind === 'risk' ? [card.risk] : []))
}

test('a risk with a false quote is sent back and named; with a true quote the risk shows with its mark, is stored with its piece of work and read back after a restart', async () => {
	// The file indents with a tab; the false quote uses four spaces, the miss real models make most.
	const falseRisk = { ...RISK, quotes: [{ ...CALL, text: '    return await fetchWithin(TIMEOUT_MS * 2)' }] }
	const work = { work: { title: 'Time out sooner' } }
	const first = await ask([
		show({ ...work, risks: [falseRisk] }),
		show({ ...work, risks: [RISK] }),
		{ text: '' },
		...nothingToRevise(1),
	])

	assert.deepEqual(
		sentBackIn(first.events).map((step) => step.what),
		['Risk 1'],
	)
	assert.match(toolResults(first.requests[1])[0] ?? '', /Risk 1, quote 1: .*src\/load\.ts/)
	const { weight: _, ...risk } = { ...RISK, quotes: [{ ...CALL, startLine: 2, endLine: 2 }] }
	assert.deepEqual(risks(first.events), [{ ...risk, weight: 'serious', checked: true }])
	const stored = replyIn(first.events).recorded.find((entry) => entry.kind === 'work')
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find((e) => e.id === stored?.id)
	assert.deepEqual(
		onDisk?.kind === 'work' && onDisk.risks,
		[risk],
		'the record keeps the risk without the mark and the weight',
	)

	const second = await ask([{ tool: 'ken__read_record', args: { id: stored?.id } }, { text: 'Done.' }])
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(read.includes(`risk 1 [inferred]: ${RISK.text}`) && read.includes(CALL.text), `read_record: ${read}`)
})

test("a risk that says a name is missing is sent back when ken finds the name, with the place, and shown with ken's search when it does not", async () => {
	const missing = (text: string) => ({
		...RISK,
		text: 'Nothing else in src waits on the limit.',
		absent: { text, under: 'src/' },
	})
	const { events } = await ask([
		show({ risks: [missing('fetchWithin')] }),
		show({ risks: [missing('retryLater')] }),
		{ text: '' },
		...nothingToRevise(1),
	])

	assert.match(sentBackIn(events)[0]?.problems[0] ?? '', /^Risk 1: .*src\/load\.ts:2/)
	assert.deepEqual(risks(events)[0]?.absent, { text: 'retryLater', under: 'src/', commit: head })
})
