import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { type ChatRequest, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

const { root } = buildRepository([{ message: 'feat: start', files: { 'src/retry.ts': 'export const TIMES = 3\n' } }])
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const READ: Turn = { tool: 'ken__read_file', args: { path: 'src/retry.ts' } }
const ANSWER: Turn = {
	tool: 'ken__answer',
	args: {
		summary: 'Retries run three times.',
		statements: [
			{
				text: 'TIMES is 3.',
				label: 'inferred',
				quotes: [{ path: 'src/retry.ts', commit: 'HEAD', text: 'export const TIMES = 3' }],
			},
		],
	},
}

async function ask(script: Turn[]) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What does retry do?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

// The turns the notice says are left, if the newest tool result in this request carries it.
function turnsLeftIn(request: ChatRequest | undefined): number | undefined {
	const match = /(\d+) turns? left/.exec(toolResults(request).at(-1) ?? '')
	return match ? Number(match[1]) : undefined
}

test('a model that keeps exploring is told near the end how many turns are left, and an answer sent then is accepted', async () => {
	const explorer = await ask(Array.from({ length: 200 }, () => READ))
	assert.deepEqual(explorer.events.at(-1), { kind: 'done', outcome: 'out-of-turns' })
	const first = explorer.requests.findIndex((request) => turnsLeftIn(request) !== undefined)
	assert.ok(first > 0, 'the notice reaches the model before the last turn')
	const left = turnsLeftIn(explorer.requests[first])
	assert.equal(left, explorer.requests.length - first, 'the notice counts the turns that are really left')
	assert.ok(left !== undefined && left > 1 && left < 10, `the notice comes near the end, with room to answer: ${left}`)
	assert.ok(first > 10, 'a short question never sees the notice')

	const answered = await ask([...Array.from({ length: first }, () => READ), ANSWER, { text: 'I read one file.' }])
	assert.equal(turnsLeftIn(answered.requests[first]), left)
	assert.equal(
		answered.events.some((event) => event.kind === 'accepted'),
		true,
	)
	assert.deepEqual(answered.events.at(-1), { kind: 'done', outcome: 'answered' })
})
