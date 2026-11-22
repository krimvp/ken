import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { replyIn } from '../fixtures/chat-events.ts'
import { type ChatRequest, scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

const { root } = buildRepository([{ message: 'feat: start', files: { 'src/retry.ts': 'export const TIMES = 3\n' } }])
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const READ: Turn = { tool: 'ken__read_file', args: { path: 'src/retry.ts' } }
const SHOW: Turn = {
	tool: 'ken__show',
	text: 'Retries run three times.',
	args: {
		claims: [
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
		env: {},
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

test('a model that keeps exploring is told near the end how many turns are left, and a reply sent then reaches the reader', async () => {
	const explorer = await ask(Array.from({ length: 200 }, () => READ))
	assert.deepEqual(explorer.events.at(-1), { kind: 'done', outcome: 'out-of-turns' })
	const first = explorer.requests.findIndex((request) => turnsLeftIn(request) !== undefined)
	assert.ok(first > 0, 'the notice reaches the model before the last turn')
	const left = turnsLeftIn(explorer.requests[first])
	assert.equal(left, explorer.requests.length - first, 'the notice counts the turns that are really left')
	assert.ok(left !== undefined && left > 1 && left < 10, `the notice comes near the end, with room to answer: ${left}`)
	assert.ok(first > 10, 'a short question never sees the notice')

	const answered = await ask([...Array.from({ length: first }, () => READ), SHOW, { text: 'I read one file.' }])
	assert.equal(turnsLeftIn(answered.requests[first]), left)
	assert.deepEqual(
		replyIn(answered.events).items.map((item) => item.kind),
		['words', 'card', 'words'],
	)
	assert.deepEqual(answered.events.at(-1), { kind: 'done', outcome: 'answered' })
})

test('a follow-up keeps the answer and its sources, and can recall an older answer without replaying file reads', async () => {
	const sourceOnly = 'THIS_LINE_WAS_READ_BUT_NEVER_SHOWN'
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': sourceOnly } },
		{ message: 'feat: retry', files: { 'src/retry.ts': `export const TIMES = 3\n${sourceOnly}\n` } },
	])
	const model = await scriptedModel([
		READ,
		{ ...SHOW, args: { ...SHOW.args, scope: { base: hashes[0], head: hashes[1] } } },
		{ text: '' },
		{ text: 'The retry limit belongs to the caller.' },
		{ text: 'Configuration is loaded on startup.' },
		{ text: 'A worker applies the configuration.' },
		{ tool: 'ken__memory_search', args: { words: 'Retries run three times' } },
		{ text: 'Earlier we discussed the retry count.' },
	])
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	try {
		for (const question of [
			'What limits retries?',
			'Who sets that?',
			'When is config loaded?',
			'What uses it?',
			'What was the first limit?',
		]) {
			const events: ChatEvent[] = []
			for await (const event of started.chat.ask(question)) events.push(event)
			assert.deepEqual(events.at(-1), { kind: 'done', outcome: 'answered' })
		}
	} finally {
		await started.chat.close()
	}
	const followUp = JSON.stringify(model.requests[3]?.messages)
	assert.doesNotMatch(followUp, new RegExp(sourceOnly))
	assert.match(followUp, /Retries run three times/)
	assert.match(followUp, /src\/retry\.ts/)
	for (const hash of hashes) assert.ok(followUp.includes(hash), 'the exact change can be opened again')
	const later = JSON.stringify(model.requests[6]?.messages)
	assert.doesNotMatch(later, /Retries run three times/)
	assert.match(toolResults(model.requests[7]).at(-1) ?? '', /What limits retries\?/)
	assert.equal(model.requests.length, 8, 'keeping a reply takes no model call')
})

test('asking for a brief loads only its card form and the next free question can show a checked claim', async () => {
	const line = 'Retries run three times.'
	const checked: Turn = {
		tool: 'ken__show',
		args: {
			brief: {
				number: 1,
				line,
				points: [
					{
						line,
						more: line,
						long: line,
						drawing: { kind: 'dot' },
						quotes: [{ path: 'src/retry.ts', text: 'export const TIMES = 3' }],
					},
				],
			},
		},
	}
	const model = await scriptedModel([checked, checked, SHOW, { text: '' }])
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const collect = async (stream: AsyncIterable<ChatEvent>) => {
		const events: ChatEvent[] = []
		for await (const event of stream) events.push(event)
		return events
	}
	const fields = (request: ChatRequest | undefined) =>
		Object.keys(request?.tools.find((tool) => tool.function.name === 'ken__show')?.function.parameters.properties ?? {})
	try {
		await collect(
			started.chat.ask('A brief', undefined, { kind: 'answer', concept: 'Retry', text: 'How many?', paths: [] }),
		)
		await collect(
			started.chat.ask('A tour', undefined, {
				kind: 'explain',
				tour: { within: [], stops: [{ name: 'Retry', job: 'Retries', paths: ['src/retry.ts'] }] },
			}),
		)
		const full = await collect(started.chat.ask('Show me the retry count.'))
		assert.deepEqual(fields(model.requests[0]), ['brief'])
		assert.deepEqual(fields(model.requests[1]), ['brief'], 'a tour offers only the brief')
		assert.ok(fields(model.requests[2]).includes('claims'))
		assert.ok(replyIn(full).items.some((item) => item.kind === 'card' && item.card.kind === 'claim'))
	} finally {
		await started.chat.close()
	}
})
