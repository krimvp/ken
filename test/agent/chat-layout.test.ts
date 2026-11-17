import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { type ChatRequest, scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const { root } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/server/serve.ts': "import { answer } from '../agent/answer.ts'\nexport const port = 80\n",
			'src/agent/answer.ts': 'export function answer() {}\n',
		},
	},
])
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const IMPORT = { path: 'src/server/serve.ts', commit: 'HEAD', text: "import { answer } from '../agent/answer.ts'" }
const PORT = { path: 'src/server/serve.ts', commit: 'HEAD', text: 'export const port = 80' }

function layout(quote: { path: string; commit?: string; text: string }) {
	return {
		within: [],
		parts: [
			{ name: 'Server', job: 'serves the page', paths: ['src/server'] },
			{ name: 'Chat engine', job: 'answers questions', paths: ['src/agent'] },
		],
		arrows: [{ from: 'Server', to: 'Chat engine', text: 'asks', quotes: [quote] }],
	}
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
	for await (const event of started.chat.ask('What are the main parts?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

function firstPrompt(request: ChatRequest | undefined): string {
	return JSON.stringify(request?.messages.filter((message) => message.role === 'user') ?? [])
}

test("a layout whose arrow quotes a line that does not name its target is sent back alone while the words and the claim stand; the fixed one, its quote read at the layout's commit, is kept, and the next question starts from its part names", async () => {
	const claim = { text: 'The server listens on port 80.', label: 'inferred', quotes: [PORT] }
	const first = await ask([
		{ tool: 'ken__show', text: 'There are two parts.', args: { claims: [claim], layout: layout(PORT) } },
		{ tool: 'ken__show', args: { layout: layout({ path: IMPORT.path, text: IMPORT.text }) } },
		{ text: '' },
	])

	assert.deepEqual(
		sentBackIn(first.events).map((each) => [
			each.what,
			/names no folder or file of Chat engine/.test(each.problems.join(' ')),
		]),
		[['The layout', true]],
	)
	const reply = replyIn(first.events)
	assert.ok(reply.items.some((item) => item.kind === 'words' && item.text.includes('There are two parts.')))
	assert.deepEqual(
		cardsIn(first.events).map((card) => card.kind),
		['claim', 'layout'],
	)
	assert.deepEqual(
		reply.recorded.map((entry) => entry.kind),
		['layout'],
	)

	const second = await ask([{ text: 'Two parts.' }])
	const prompt = firstPrompt(second.requests[0])
	for (const line of ['Server (src/server): serves the page', 'Chat engine (src/agent): answers questions']) {
		assert.ok(prompt.includes(line), `the next question's first request names the part: ${line}`)
	}
})
