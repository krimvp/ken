import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { type KenServer, openServer } from '../../src/server/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

// A command that runs the core, a core that saves to a store, and a test of the core.
const FILES = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\tsave()\n}\n",
	'src/store/db.ts': 'export function save() {}\n',
	'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const KEY_ENV = 'KEN_TEST_TOUR_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
after(() => rmSync(home, { recursive: true, force: true }))

// The parts as ken's model named them, the test part first, so the order cannot come from the level's own order.
const record = fileRecordStore(root, gitRepository(root))
const quote = (file: keyof typeof FILES, text: string) => ({ path: file, commit: 'HEAD', text })
const named = await record.append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		parts: [
			{ name: 'Tests', job: 'Tests the core', paths: ['test'] },
			{ name: 'Store', job: 'Saves what the core makes', paths: ['src/store'] },
			{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
			{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
		],
		arrows: [
			{
				from: 'Tests',
				to: 'Core',
				text: 'tests',
				quotes: [quote('test/run.test.ts', "import { run } from '../src/core/run.ts'")],
			},
			{
				from: 'Core',
				to: 'Store',
				text: 'saves to',
				quotes: [quote('src/core/run.ts', "import { save } from '../store/db.ts'")],
			},
			{
				from: 'Command',
				to: 'Core',
				text: 'runs',
				quotes: [quote('src/cli/main.ts', "import { run } from '../core/run.ts'")],
			},
		],
	},
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

const stop = (number: number, text: string, file: keyof typeof FILES, line: string): Turn => ({
	tool: 'ken__show',
	args: {
		step: { number, text },
		claims: [{ text: `${file} holds it.`, label: 'inferred', quotes: [quote(file, line)] }],
	},
})

async function open(baseUrl: string | null): Promise<KenServer> {
	const model = baseUrl
		? { KEN_MODEL: 'scripted', KEN_BASE_URL: baseUrl, KEN_API_KEY_ENV: KEY_ENV, [KEY_ENV]: 'scripted-model-key' }
		: {}
	const opened = await openServer({ directory: root, flags: {}, env: { KEN_HOME: home, ...model }, port: 0 })
	if (opened.kind !== 'ok') throw new Error(opened.message)
	after(() => opened.server.close())
	return opened.server
}

async function call(server: KenServer, route: string, body?: object): Promise<{ status: number; text: string }> {
	const url = new URL(route, server.url)
	const req = httpRequest(url, {
		method: body ? 'POST' : 'GET',
		headers: { origin: url.origin, 'content-type': 'application/json' },
	})
	const answered = new Promise<{ status: number; text: string }>((resolve, reject) => {
		req.on('error', reject)
		req.on('response', (res) => {
			let text = ''
			res.on('data', (chunk) => (text += chunk))
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
		})
	})
	req.end(body ? JSON.stringify(body) : undefined)
	return await answered
}

async function json(server: KenServer, route: string, body?: object) {
	const { status, text } = await call(server, route, body)
	assert.equal(status, 200, text)
	return JSON.parse(text)
}

type State = { topic: string; kind: string }
const kinds = (states: State[]) => Object.fromEntries(states.map((state) => [state.topic, state.kind]))

test('a tour asks for its stops from the most used part outward, reaches the reader stop by stop with its cards, follows the map, and reopens with no model', async () => {
	const model = await scriptedModel([
		{ text: 'Let me read the parts.', tool: 'ken__read_file', args: { path: 'src/cli/main.ts' } },
		stop(1, 'The core runs the work.', 'src/core/run.ts', 'export function run() {'),
		stop(2, 'The store saves it.', 'src/store/db.ts', 'export function save() {}'),
		stop(3, 'The command starts everything.', 'src/cli/main.ts', 'run()'),
		stop(4, 'The tests run the core.', 'test/run.test.ts', 'run()'),
		{ text: 'That is the whole project.' },
	])
	const server = await open(model.baseUrl)
	const { status, text } = await call(server, '/api/questions', { lens: { kind: 'tour', within: [] } })
	assert.equal(status, 200, text)
	const lines = text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))

	const question: string = lines.find((line) => line.kind === 'asked').question
	assert.equal(question.split('\n')[0], 'Show me around this project')
	assert.deepEqual(
		question.split('\n').flatMap((line) => line.match(/^- Stop \d+, (.+) \((.+)\): (.+)$/)?.slice(1) ?? []),
		[
			...['Core', 'src/core', 'Runs the work'],
			...['Store', 'src/store', 'Saves what the core makes'],
			...['Command', 'src/cli', 'The command a person types'],
			...['Tests', 'test', 'Tests the core'],
		],
		'the question carries each stop in order with its paths and job',
	)

	const { entry, topics } = lines.at(-1).view
	const items: { kind: string; number?: number; step?: number }[] = entry.reply.items
	assert.deepEqual(
		items.flatMap((item) =>
			item.kind === 'step' ? [`stop ${item.number}`] : item.kind === 'card' ? [`card ${item.step}`] : [],
		),
		['stop 1', 'card 1', 'stop 2', 'card 2', 'stop 3', 'card 3', 'stop 4', 'card 4'],
		'each stop reaches the reader in order, followed by its card',
	)
	assert.deepEqual(
		entry.reply.tour.stops.map((each: { name: string }) => each.name),
		['Core', 'Store', 'Command', 'Tests'],
	)
	assert.deepEqual(
		kinds(topics),
		{ Command: 'never-met', Core: 'never-met', Store: 'never-met', Tests: 'never-met' },
		"each stop's part is a topic, and asking for a tour marks none of them",
	)

	const rows = (await json(server, '/api/questions')).questions
	assert.deepEqual(rows.at(-1).tour, { within: [], stops: ['Core', 'Store', 'Command', 'Tests'] })
	assert.deepEqual([rows.at(-1).steps, rows.at(-1).change], [4, null], 'four steps, about no change')

	const reached = await json(server, '/api/map', { signal: 'toured', topics: ['Command'] })
	assert.deepEqual(kinds(reached.states), { Command: 'met' }, 'reaching a stop marks its part met')
	const known = await json(server, '/api/map', { signal: 'know', topics: ['Core'] })
	assert.deepEqual(kinds(known.states), { Core: 'unchanged' }, '"I know this part" marks it understood')
	await server.close()

	const later = await open(null)
	const reopened = await json(later, `/api/questions/${entry.id}`)
	assert.deepEqual(reopened.entry.reply, entry.reply, 'the saved tour reopens whole with no model')
	assert.deepEqual(kinds(reopened.topics), {
		Command: 'met',
		Core: 'unchanged',
		Store: 'never-met',
		Tests: 'never-met',
	})
})

test('a tour of a level nobody named is refused before it reaches the model', async () => {
	const model = await scriptedModel([])
	const server = await open(model.baseUrl)
	const { status, text } = await call(server, '/api/questions', { lens: { kind: 'tour', within: ['src/core'] } })
	assert.equal(status, 400, text)
	assert.equal(model.requests.length, 0)
})
