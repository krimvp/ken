import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, toolResults } from '../fixtures/scripted-model.ts'

// An entry that starts a worker, a compose file and one Kubernetes manifest.
const FILES = {
	'src/main.ts': "import { work } from './engine/run.ts'\nconst worker = new Worker('./engine/worker.ts')\nwork()\n",
	'src/engine/run.ts': 'export function work() {}\n',
	'src/engine/worker.ts': 'self.onmessage = () => {}\n',
	'compose.yml':
		'services:\n  web:\n    image: shop/web:3\n    deploy:\n      replicas: 2\n  db:\n    image: postgres\n',
	'deploy/k8s/api.yaml':
		'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api-v2\nspec:\n  replicas: 3\n  template: {}\n',
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const home = readerHome()

// The parts as ken's model named them before it drew where the project runs.
const record = fileRecordStore(root, gitRepository(root))
const named = await record.append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		parts: [
			{ name: 'Entry', job: 'Starts the work', paths: ['src/main.ts'] },
			{ name: 'Engine', job: 'Does the work', paths: ['src/engine'] },
		],
		arrows: [],
	},
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

const at = (path: keyof typeof FILES, text: string) => [{ path, text }]
const MAIN = "import { work } from './engine/run.ts'"
const WORKER = "const worker = new Worker('./engine/worker.ts')"
const frame = (id: string, rest: object) => ({ id, kind: 'process', name: id, line: `Where ${id} runs.`, ...rest })
const VIEWS = {
	world: {
		outside: [
			{ id: 'user', kind: 'person', name: 'A user', line: 'Starts the work.', quotes: at('src/main.ts', 'work()') },
		],
		crossings: [],
	},
	runtime: {
		frames: [
			frame('proc', { quotes: at('src/main.ts', MAIN) }),
			frame('worker', { kind: 'thread', in: 'proc', quotes: at('src/main.ts', WORKER) }),
			frame('ghost', { quotes: at('src/main.ts', 'spawn(ghost)') }),
			frame('loop-a', { in: 'loop-b', quotes: at('src/main.ts', MAIN) }),
			frame('loop-b', { in: 'loop-a', quotes: at('src/main.ts', MAIN) }),
			frame('web', {
				kind: 'container',
				copies: {
					count: 3,
					quote: { path: 'compose.yml', text: '    image: shop/web:3\n    deploy:\n      replicas: 2' },
				},
				quotes: at('compose.yml', '  web:'),
			}),
			frame('api', {
				kind: 'container',
				copies: { count: 2, quote: { path: 'deploy/k8s/api.yaml', text: '  name: api-v2\nspec:\n  replicas: 3' } },
				quotes: at('deploy/k8s/api.yaml', 'kind: Deployment'),
			}),
			frame('guess', {
				copies: { count: 4, quote: { path: 'src/main.ts', text: WORKER } },
				quotes: at('src/main.ts', MAIN),
			}),
			frame('api-ok', {
				kind: 'container',
				copies: { count: 3, quote: { path: 'deploy/k8s/api.yaml', text: '  replicas: 3' } },
				quotes: at('deploy/k8s/api.yaml', 'kind: Deployment'),
			}),
		],
		things: [
			// Models fill fields they do not use with "", as this one does with store.
			{ id: 'entry', kind: 'part', part: 'Entry', frame: 'proc', store: '', quotes: at('src/main.ts', MAIN) },
			{
				id: 'engine-worker',
				kind: 'part',
				part: 'Engine',
				frame: 'worker',
				quotes: at('src/engine/worker.ts', 'self.onmessage = () => {}'),
			},
			{ id: 'cache', kind: 'part', part: 'Cache', frame: 'proc', quotes: at('src/main.ts', MAIN) },
			// Engine drawn a second time, and a store that takes the name of the part Entry.
			{
				id: 'engine-again',
				kind: 'part',
				part: 'Engine',
				frame: 'proc',
				quotes: at('src/engine/run.ts', 'export function work() {}'),
			},
			{
				id: 'entry-files',
				kind: 'store',
				store: 'files',
				name: 'entry',
				line: 'Keeps what starts the work.',
				quotes: at('src/main.ts', 'work()'),
			},
			{
				id: 'db',
				kind: 'store',
				store: 'database',
				name: 'Database',
				line: 'Keeps the rows.',
				quotes: at('compose.yml', '  db:\n    image: postgres'),
			},
		],
		crossings: [
			{
				id: 'to-worker',
				kind: 'call',
				from: 'entry',
				to: 'engine-worker',
				text: 'worker messages',
				how: 'other',
				from_quotes: at('src/main.ts', WORKER),
			},
		],
		gaps: [{ id: 'db-who', on: 'db', text: 'who runs it: not in the repository' }],
	},
}

// Later the parts are named again, Engine as Core, with the drawings in the same call.
const RENAMED = {
	within: [],
	about: 'A tool that runs work in a worker.',
	parts: [
		{ name: 'Entry', job: 'Starts the work', paths: ['src/main.ts'] },
		{ name: 'Core', job: 'Does the work', paths: ['src/engine'] },
	],
}
const model = await scriptedModel([
	{ tool: 'ken__show', args: { views: VIEWS } },
	{ text: 'It runs in one process with a worker thread.' },
	{
		calls: [
			{ tool: 'ken__memory_known', args: { about: 'crossing:to-worker' } },
			{ tool: 'ken__memory_known', args: { about: 'frame:worker' } },
		],
	},
	{ text: 'Done.' },
	{
		tool: 'ken__show',
		args: {
			layout: RENAMED,
			views: {
				runtime: {
					frames: [frame('proc', { quotes: at('src/main.ts', MAIN) })],
					things: [
						{
							id: 'core',
							kind: 'part',
							part: 'Core',
							frame: 'proc',
							quotes: at('src/engine/run.ts', 'export function work() {}'),
						},
					],
				},
			},
		},
	},
	{ text: '' },
])
const server = await openKen(root, home, model.baseUrl)
const top = async () => (await json(server, '/api/layout')).look
const before = (await top()).views
const lines = await ask(server, { lens: { kind: 'views', within: [] } })
const after = (await top()).views
const sentBack = lines.flatMap((line) => (line.kind === 'step' && line.step.kind === 'sent-back' ? [line.step] : []))
const problemsOf = (what: string) => sentBack.find((step) => step.what === what)?.problems.join(' ') ?? ''
const ids = (list: { id: string }[]) => list.map((each) => each.id)

test('a project named before the drawings has look.views with both null, and the views lens fills them', () => {
	assert.deepEqual(before, { world: null, runtime: null, drawn: null })
	assert.deepEqual(ids(after.world.outside), ['user'])
	assert.equal(after.world.project.line, null)
	assert.deepEqual(ids(after.runtime.frames).sort(), ['api-ok', 'proc', 'worker'])
	assert.equal(after.drawn, new Date().toISOString().slice(0, 10))
})

test('a frame whose quote is not in git never reaches the page, and goes back to the model', () => {
	assert.ok(!ids(after.runtime.frames).includes('ghost'))
	assert.match(problemsOf('Frame "ghost"'), /quote 1/)
})

test('frames that sit inside each other are refused, since frames form a tree', () => {
	assert.ok(!ids(after.runtime.frames).some((id) => id.startsWith('loop')))
	assert.match(problemsOf('Frame "loop-a"'), /loop-b, which sit inside it/)
})

test('a part that is not a part of the level is refused, and the parts that are sit in their frames', () => {
	assert.deepEqual(
		after.runtime.things.map((thing: { id: string; frame: string | null }) => [thing.id, thing.frame]),
		[
			['entry', 'proc'],
			['engine-worker', 'worker'],
			['db', null],
		],
	)
	assert.match(problemsOf('Thing "cache"'), /"Cache", which is not a part of the level/)
})

test('a name drawn twice goes back to the model: a part drawn again, or another thing named as a part', () => {
	assert.match(problemsOf('Thing "engine-again"'), /the part "Engine" is in this drawing already/)
	assert.match(problemsOf('Thing "entry-files"'), /its name "entry" is the name of the part "Entry"/)
})

test('copies that the quoted line does not give, or that disagree with a compose file or a manifest, are refused, and copies that agree are kept', () => {
	assert.match(problemsOf('Frame "guess"'), /does not say 4/)
	assert.match(problemsOf('Frame "web"'), /compose\.yml runs 2 of web/)
	assert.match(problemsOf('Frame "api"'), /deploy\/k8s\/api\.yaml runs 3 of api-v2/)
	const kept = after.runtime.frames.find((each: { id: string }) => each.id === 'api-ok')
	assert.equal(kept.copies.count, 3)
})

test("a gap reaches the page, on the thing it is about, and in that thing's brief", async () => {
	assert.deepEqual(after.runtime.gaps, [{ id: 'db-who', on: 'db', text: 'who runs it: not in the repository' }])
	const store = await json(server, '/api/brief?concept=store:db')
	assert.deepEqual(store.gaps, ['who runs it: not in the repository'])
})

test('a frame opens as a brief with the lines that make it, the parts in it and what crosses into it, and search finds it', async () => {
	const proc = await json(server, '/api/brief?concept=frame:proc')
	assert.equal(proc.name, 'proc')
	assert.deepEqual(
		proc.quotes.map((quote: { path: string; startLine: number }) => [quote.path, quote.startLine]),
		[['src/main.ts', 1]],
	)
	assert.deepEqual(
		proc.parts.map((part: { id: string }) => part.id),
		['part::Entry', 'part::Engine'],
	)
	const worker = await json(server, '/api/brief?concept=frame:worker')
	assert.deepEqual(
		worker.sideways.usedBy.map((each: { id: string; name: string }) => [each.id, each.name]),
		[['crossing:to-worker', 'Entry']],
	)
	const found = (await json(server, '/api/concepts')).map((row: { id: string }) => row.id)
	for (const id of ['frame:proc', 'frame:worker', 'store:db', 'outside:user']) assert.ok(found.includes(id), id)
})

test('a changed worker call marks its drawing and brief until they are redrawn; moving another quoted line leaves it current', async () => {
	writeFileSync(path.join(root, 'src/main.ts'), `// Entry point\n${MAIN}\nqueue.send()\nwork()\n`)
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'Queue the work'], { cwd: root })
	const look = await top()
	assert.deepEqual(ids(look.views.stale).sort(), ['to-worker', 'worker'])
	const crossing = await json(server, '/api/brief?concept=crossing:to-worker')
	assert.deepEqual(crossing.staleFiles, ['src/main.ts'])
	assert.equal(crossing.checkedAt, look.head)
	assert.deepEqual(crossing.explain.lens, { kind: 'views', within: [] })
	assert.equal((await json(server, '/api/brief?concept=frame:proc')).staleFiles, undefined)
	await ask(server, {
		question: 'What is this connection?',
		focus: { view: 'runtime', commit: look.head, concepts: ['crossing:to-worker', 'frame:worker'], earlier: true },
	})
	const [edge = '', frame = ''] = toolResults(model.requests.at(-1))
	assert.match(edge, /src\/main\.ts:2 \(changed since/)
	assert.match(frame, /src\/main\.ts:2 \(changed since/)
	const incoming = frame.split('\n').find((line) => line.includes('(crossing:to-worker)')) ?? ''
	assert.match(incoming, /Entry.*worker/)
	assert.match(incoming, /worker messages/)
})

test('naming the parts of the top level names its drawings in the same run, against the new parts', async () => {
	await ask(server, { lens: { kind: 'parts', within: [] } })
	const rows: { answer: boolean }[] = (await json(server, '/api/questions')).questions
	assert.deepEqual(
		rows.map((row) => row.answer),
		[false, true, false],
		'the runs that drew where it runs and named the parts are not answers, and the question between them is',
	)
	const views = (await top()).views
	assert.deepEqual(
		views.runtime.things.map((thing: { part: string }) => thing.part),
		['Core'],
	)
	assert.equal(views.world, null)
	assert.deepEqual(views.stale, [])
})
