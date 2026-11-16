import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
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

function answer(call: typeof CALL): Turn {
	return {
		tool: 'ken__answer',
		args: {
			scope: { base, head },
			work: { title: 'run saves' },
			summary: 'run now saves its result through the store.',
			statements: [{ text: 'run calls save with "done".', label: 'inferred', quotes: [CALL] }],
			risks: [],
			diagrams: [
				{
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
				},
			],
		},
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

test('a diagram arrow with a false quote rejects the answer and names the arrow; with a true quote the diagram is numbered, stored with its piece of work, and read back after a restart', async () => {
	// The file indents with a tab; the false quote uses four spaces, the miss real models make most.
	const first = await ask([answer({ ...CALL, text: "    save('done')" }), answer(CALL), { text: 'Done.' }])

	assert.deepEqual(
		first.events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind),
		['rejected', 'accepted'],
	)
	const toModel = toolResults(first.requests[1])[0] ?? ''
	assert.match(toModel, /Diagram 1, arrow 1 \("calls" from app to store\), quote 1 \(src\/app\.ts/)
	const accepted = first.events.find((event) => event.kind === 'accepted')
	assert.ok(accepted?.kind === 'accepted')
	const [diagram] = accepted.answer.diagrams
	assert.ok(diagram?.kind === 'component')
	assert.deepEqual(
		[...diagram.boxes, ...diagram.arrows].map((element) => [element.number, element.quotes[0]?.startLine]),
		[
			[1, 3],
			[2, 1],
			[3, 4],
			[4, 1],
		],
	)

	const work = accepted.recorded.find((entry) => entry.kind === 'work')
	const onDisk = (await fileRecordStore(root, gitRepository(root)).read()).current.find(
		(entry) => entry.id === work?.id,
	)
	assert.deepEqual(onDisk?.kind === 'work' && onDisk.diagrams, accepted.answer.diagrams)

	const second = await ask([{ tool: 'ken__read_record', args: { id: work?.id } }, { text: 'Done.' }])
	const read = toolResults(second.requests[1])[0] ?? ''
	assert.ok(
		read.includes('3. app calls store') && read.includes("\tsave('done')"),
		`read_record shows the diagram: ${read}`,
	)
})
