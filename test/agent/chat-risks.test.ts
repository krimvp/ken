import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

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
const RISK = { text: 'load now gives up after 200 ms instead of 1 s.', label: 'inferred', quotes: [CALL] }

function answer(args: Record<string, unknown>): Turn {
	return {
		tool: 'ken__answer',
		args: { scope: { base, head }, summary: 'The timeout is shorter.', statements: [STATEMENT], ...args },
	}
}

// A new chat each time, the way a new ken process starts, so the second question reads the first from disk.
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

function outcomes(events: ChatEvent[]) {
	return events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind)
}

function accepted(events: ChatEvent[]) {
	const event = events.find((each) => each.kind === 'accepted')
	return event?.kind === 'accepted' ? event : assert.fail(`no answer was accepted: ${JSON.stringify(events)}`)
}

test('a risk with a false quote rejects the answer and names the risk; with a true quote the risk is stored with its piece of work and read back after a restart', async () => {
	// The file indents with a tab; the false quote uses four spaces, the miss real models make most.
	const falseRisk = { ...RISK, quotes: [{ ...CALL, text: '    return await fetchWithin(TIMEOUT_MS * 2)' }] }
	const work = { work: { title: 'Time out sooner' } }
	const first = await ask([answer({ ...work, risks: [falseRisk] }), answer({ ...work, risks: [RISK] }), { text: '.' }])

	assert.deepEqual(outcomes(first.events), ['rejected', 'accepted'])
	assert.match(toolResults(first.requests[1])[0] ?? '', /Risk 1, quote 1 \(src\/load\.ts/)
	const { answer: checked, recorded } = accepted(first.events)
	assert.deepEqual(checked.risks, [{ ...RISK, quotes: [{ ...CALL, startLine: 2, endLine: 2 }] }])
	const stored = recorded.find((entry) => entry.kind === 'work')
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find((e) => e.id === stored?.id)
	assert.deepEqual(onDisk?.kind === 'work' && onDisk.risks, checked.risks)

	const second = await ask([{ tool: 'ken__read_record', args: { id: stored?.id } }, { text: 'Done.' }])
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(read.includes(`risk 1 [inferred]: ${RISK.text}`) && read.includes(CALL.text), `read_record: ${read}`)
})

test('an answer about a change that says nothing about risks, or has a long summary, comes back without using an attempt; an answer about the code as it is may leave risks out', async () => {
	const silent = answer({})
	const wordy = answer({ risks: [], summary: `The timeout is shorter. ${'It drops by 400 ms. '.repeat(14)}` })
	const { events, requests } = await ask([silent, wordy, silent, answer({ risks: [] }), { text: '.' }])

	assert.deepEqual(outcomes(events), ['accepted'], 'three answers came back and none of them used an attempt')
	const [noRisks = '', tooLong = ''] = [toolResults(requests[1])[0], toolResults(requests[2]).at(-1)]
	assert.match(noRisks, /risks/)
	assert.match(noRisks, /empty list/, 'the model is told how to say it found none')
	assert.match(tooLong, /summary has \d+ characters/)
	assert.deepEqual(accepted(events).answer.risks, [], 'an empty list says the agent found none')

	const now = await ask([
		{ tool: 'ken__answer', args: { summary: 'The timeout is 100 ms.', statements: [STATEMENT] } },
		{ text: '.' },
	])
	assert.equal(accepted(now.events).answer.risks, null)
})
