import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: { 'src/retry.ts': 'export function retry() {\n\tattempt()\n}\n', 'src/clock.ts': 'export const now = 0\n' },
	},
	{
		message: 'feat: wait between attempts',
		files: {
			'src/retry.ts': 'export function retry() {\n\tattempt()\n\tsleep(100)\n}\n',
			'src/clock.ts': 'export const now = 0\nexport const later = 100\n',
		},
	},
])
const [base = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const claim = (text: string, path: string, line: string) => ({
	text,
	label: 'inferred',
	quotes: [{ path, commit: 'HEAD', text: line }],
})
const SLEEPS = claim('Each attempt now sleeps.', 'src/retry.ts', '\tsleep(100)')
const LATER = claim('The clock names the wait.', 'src/clock.ts', 'export const later = 100')
// A line the change did not touch: it proves a step but lies in no hunk.
const UNTOUCHED = claim('The retry still attempts first.', 'src/retry.ts', '\tattempt()')
const WRONG = claim('The clock names the wait.', 'src/clock.ts', 'export const later = 200')

async function walk(script: Turn[]): Promise<ChatEvent[]> {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: path.join(root, 'src'),
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('Walk me through the last commit.')) events.push(event)
	await started.chat.close()
	return events
}

// Each step as the reader gets it: its number, its words, and the texts of the cards that prove it.
function stepsIn(events: ChatEvent[]) {
	const { items } = replyIn(events)
	return items.flatMap((item) =>
		item.kind === 'step'
			? [
					{
						number: item.number,
						text: item.text,
						cards: items.flatMap((each) =>
							each.kind === 'card' && each.step === item.number && each.card.kind === 'claim'
								? [each.card.claim.text]
								: [],
						),
					},
				]
			: [],
	)
}

test('a walkthrough reaches the reader as numbered steps in order, each with its cards, and each step links to the changed lines its quotes overlap', async () => {
	const events = await walk([
		{
			tool: 'ken__show',
			text: 'The change adds a wait between attempts.',
			args: { scope: { base, head: 'HEAD' }, step: { number: 1, text: 'The loop sleeps.' }, claims: [SLEEPS] },
		},
		{ tool: 'ken__show', args: { step: { number: 2, text: 'The clock names the wait.' }, claims: [LATER] } },
		{ tool: 'ken__show', args: { step: { number: 3, text: 'Nothing else moved.' }, claims: [UNTOUCHED] } },
		{ text: '' },
	])

	assert.deepEqual(stepsIn(events), [
		{ number: 1, text: 'The loop sleeps.', cards: ['Each attempt now sleeps.'] },
		{ number: 2, text: 'The clock names the wait.', cards: ['The clock names the wait.'] },
		{ number: 3, text: 'Nothing else moved.', cards: ['The retry still attempts first.'] },
	])
	const linked = replyIn(events).change?.stepHunks.map(({ step, hunks }) => ({
		step,
		files: hunks.map((each) => `${each.path}:${each.hunk.newStart}`),
	}))
	assert.deepEqual(linked, [
		{ step: 1, files: ['src/retry.ts:3'] },
		{ step: 2, files: ['src/clock.ts:2'] },
		{ step: 3, files: [] },
	])
})

test('a step whose card ken sent back still shows, and the fixed card sent again under the same number joins it', async () => {
	const events = await walk([
		{
			tool: 'ken__show',
			args: { scope: { base, head: 'HEAD' }, step: { number: 1, text: 'The loop sleeps.' }, claims: [SLEEPS] },
		},
		{ tool: 'ken__show', args: { step: { number: 2, text: 'The clock names the wait.' }, claims: [WRONG] } },
		{ text: '' },
	])
	assert.deepEqual(
		sentBackIn(events).map((step) => step.what),
		['Claim 1'],
	)
	assert.deepEqual(stepsIn(events)[1], { number: 2, text: 'The clock names the wait.', cards: [] })

	const fixed = await walk([
		{
			tool: 'ken__show',
			args: { scope: { base, head: 'HEAD' }, step: { number: 2, text: 'The clock names the wait.' }, claims: [WRONG] },
		},
		{ tool: 'ken__show', args: { step: { number: 2, text: 'The clock names the wait.' }, claims: [LATER] } },
		{ text: '' },
	])
	assert.deepEqual(stepsIn(fixed), [
		{ number: 2, text: 'The clock names the wait.', cards: ['The clock names the wait.'] },
	])
	assert.deepEqual(
		replyIn(fixed).change?.stepHunks.map(({ hunks }) => hunks.length),
		[1],
	)
})
