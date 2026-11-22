import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

const STORE = 'export function save(text: string) {\n\twriteFileSync(PATH, text)\n}\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/store.ts': STORE, 'src/app.ts': 'export function run() {}\n' } },
	{
		message: 'feat: run saves its result',
		files: { 'src/app.ts': "import { save } from './store.ts'\n\nexport function run() {\n\tsave('done')\n}\n" },
	},
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const CALL = { path: 'src/app.ts', commit: head, text: "\tsave('done')" }
const RUN = { path: 'src/app.ts', commit: head, text: 'export function run() {' }
const SAVE = { path: 'src/store.ts', commit: head, text: 'export function save(text: string) {' }

function diagram(call: typeof CALL) {
	return {
		kind: 'component',
		title: 'Who saves',
		label: 'inferred',
		boxes: [
			{ name: 'app', quotes: [RUN] },
			{ name: 'store', quotes: [SAVE] },
		],
		arrows: [
			{ from: 'app', to: 'store', text: 'calls', quotes: [call] },
			{ from: 'store', to: 'app', text: 'returns to', quotes: [SAVE] },
		],
	}
}

function show(call: typeof CALL): Turn {
	return {
		tool: 'ken__show',
		text: 'run now saves its result through the store.',
		args: {
			scope: { base, head },
			work: { title: 'run saves' },
			claims: [{ text: 'run calls save with "done".', label: 'inferred', quotes: [CALL] }],
			diagrams: [diagram(call)],
		},
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

test('a diagram with true quotes is numbered, stored with its piece of work and read back after a restart; one arrow with a false quote sends back that diagram alone while the words and the claim stand', async () => {
	const first = await ask([{ tool: 'core__load_skill', args: { name: 'ken__diagrams' } }, show(CALL), { text: '' }])
	const format = JSON.parse(toolResults(first.requests[1])[0] ?? '{}')
	assert.deepEqual(format.items.properties.arrows.items.required, ['from', 'to', 'text', 'quotes'])
	const drawn = cardsIn(first.events).find((card) => card.kind === 'diagram')
	assert.ok(drawn?.kind === 'diagram' && drawn.diagram.kind === 'component')
	const { diagram: checked } = drawn
	assert.ok(checked.kind === 'component')
	assert.deepEqual(
		[...checked.boxes, ...checked.arrows].map((element) => [element.number, element.quotes[0]?.startLine]),
		[
			[1, 3],
			[2, 1],
			[3, 4],
			[4, 1],
		],
	)

	const work = replyIn(first.events).recorded.find((entry) => entry.kind === 'work')
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find(
		(entry) => entry.id === work?.id,
	)
	assert.deepEqual(onDisk?.kind === 'work' && onDisk.diagrams, [checked])

	const second = await ask([{ tool: 'ken__memory_known', args: { about: work?.id } }, { text: 'Done.' }])
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(
		read.includes('3. From app to store: calls') && read.includes("\tsave('done')"),
		`memory_known shows the diagram: ${read}`,
	)

	// The file indents with a tab; the false quote uses four spaces, the miss real models make most.
	const missed = await ask([show({ ...CALL, text: "    save('done')" }), { text: '' }])
	assert.deepEqual(
		cardsIn(missed.events).map((card) => card.kind),
		['claim'],
	)
	assert.equal(replyIn(missed.events).items[0]?.kind, 'words')
	assert.deepEqual(
		sentBackIn(missed.events).map((step) => step.what),
		['Diagram 1'],
	)
	const toModel = toolResults(missed.requests[1])[0] ?? ''
	assert.match(toModel, /Diagram 1, arrow 1 \("calls" from app to store\), quote 1: .*src\/app\.ts/)
})
