import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { call, json, openKen, readerHome } from '../fixtures/ken-server.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const PAGE = path.join(import.meta.dirname, '../../src/page')
type Step = { name: string; within: string[] }
type Place = {
	page: string
	trail: Step[]
	layer: string | null
	process: string | null
	change: string
	brief: string | null
	on: string | null
	older: object | null
	reply: string | null
}
const { readPlace, writePlace }: { readPlace: (hash: string) => Place; writePlace: (place: object) => string } =
	await import(path.join(PAGE, 'shell/place.js'))
const { findConcepts }: { findConcepts: (list: object[], text: string) => { name: string }[] } = await import(
	path.join(PAGE, 'shell/shell.js')
)
type Brief = {
	kind: string
	name: string
	line: string
	explained: boolean
	explain: { lens: object } | null
	deeper: { within: string; files: number } | null
	knows: { level: string } | null
	builtToday?: boolean
}
type Found = { kind: 'reading' } | { kind: 'ok'; brief: Brief } | { kind: 'none'; message: string }
type Answer = { ok: boolean; status: number; body: object }
const { briefStore }: { briefStore: (app: object) => { get: (id: string, then: () => void) => Found } } = await import(
	path.join(PAGE, 'brief/briefs.js')
)
const { processStops }: { processStops: (diagram: object, boxes: object[]) => { count: number; byBlock: number[][] } } =
	await import(path.join(PAGE, 'architecture/layers.js'))
type Home = { trail: Step[]; change: string; look: object | null; changes: object[] }
const { freshHome }: { freshHome: (stored: () => null, ui: object) => Home } = await import(
	path.join(PAGE, 'home/state/home-state.js')
)
const { homeLoads }: { homeLoads: (app: object) => { refresh: () => Promise<void> } } = await import(
	path.join(PAGE, 'home/state/loads.js')
)
const { architectureHtml }: { architectureHtml: (view: object) => string } = await import(
	path.join(PAGE, 'architecture/architecture.js')
)

const WHOLE = { name: 'Whole project', within: [] }
const ENGINE = { name: 'Plugin engine', within: ['src/engine.ts', 'src/hooks.ts'] }

test('an address written for a place reads back as that place, so a reload and Back keep where the reader is', () => {
	const places = [
		{ page: 'home', trail: [WHOLE], layer: null, process: null, change: 'none', brief: null, on: null },
		{
			page: 'architecture',
			trail: [WHOLE, ENGINE],
			layer: 'changes',
			process: null,
			change: 'abc..def',
			brief: 'part:src/engine.ts,src/hooks.ts:Tool-call gate',
			on: 'sideways',
		},
		{
			page: 'architecture',
			trail: [WHOLE],
			layer: 'processes',
			process: 'p-1',
			change: 'none',
			brief: 'step:p-1:3',
			on: null,
		},
		{
			page: 'home',
			trail: [WHOLE],
			layer: null,
			process: null,
			change: 'none',
			brief: 'term:record log',
			on: 'questions',
		},
	]
	for (const place of places) {
		assert.deepEqual(readPlace(writePlace({ ...place, older: null })), { ...place, older: null, reply: null })
	}
})

test('an address from before the pages opens the nearest place there is now', () => {
	const inside = new URLSearchParams({ way: 'learn', detail: 'how', pick: 'part:Tool-call gate' })
	inside.append('in', [ENGINE.name, ...ENGINE.within].join('\n'))
	const learned = readPlace(`#${inside}`)
	assert.equal(learned.page, 'architecture', 'learning the project is the Architecture page')
	assert.deepEqual(learned.trail, [WHOLE, ENGINE], 'at the level the reader was in')
	assert.equal(
		learned.brief,
		'part:src/engine.ts,src/hooks.ts:Tool-call gate',
		'with the part they picked as an open brief',
	)

	const review = readPlace('#way=review&detail=how&change=main..feature')
	assert.equal(review.page, 'changes', 'a change to review is on the Changes page')
	assert.equal(writePlace({ ...review, brief: null, on: null }), '#/changes?way=review&detail=how&change=main..feature')

	assert.equal(readPlace('#way=learn&detail=big&picture=q-7').page, 'processes', 'a drawn picture is on Processes')
	assert.equal(readPlace('#reply=q-9').reply, 'q-9', 'and a saved reply still opens as itself')
	assert.equal(readPlace('#nothing-ken-knows').page, 'home', 'anything else is Home')
})

test('search finds a concept by every word typed, a match in the name before a match in its line', () => {
	const list = [
		{ id: 'part::Sandbox', name: 'Sandbox', line: 'Runs model-written code behind a gate' },
		{ id: 'term:gate', name: 'gate', line: 'A check a plugin runs on a tool call' },
		{ id: 'part::Eval runner', name: 'Eval runner', line: 'Parses scenarios' },
	]
	assert.deepEqual(
		findConcepts(list, 'GATE').map((each) => each.name),
		['gate', 'Sandbox'],
	)
	assert.deepEqual(findConcepts(list, 'gate plugin runs'), [list[1]], 'every word must be there')
	assert.deepEqual(findConcepts(list, '   '), [], 'and nothing typed finds nothing')
})

test('a drawn process numbers the parts it passes through in the order of its steps', () => {
	const boxes = [
		{ name: 'Host', paths: ['src/pi.ts'] },
		{ name: 'Engine', paths: ['src/engine'] },
		{ name: 'Sandbox', paths: ['src/sandbox.ts'] },
	]
	const step = (number: number, file: string | null) => ({
		number,
		numbered: true,
		text: `step ${number}`,
		quotes: file ? [{ path: file, startLine: 1, endLine: 1, text: 'x' }] : [],
	})
	const diagram = {
		elements: [
			step(1, 'src/pi.ts'),
			step(2, 'src/engine/call.ts'),
			step(3, 'src/engine/gate.ts'),
			step(4, 'README.md'),
			step(5, null),
			step(6, 'src/pi.ts'),
			{ number: 7, numbered: false, text: 'Host', quotes: [] },
		],
	}
	const stops = processStops(diagram, boxes)
	assert.deepEqual(stops.byBlock, [[1, 3], [2], []], 'a part the process comes back to has both its numbers')
	assert.equal(stops.count, 3, 'two steps in a row in one part are one stop, and a step in no part is none')
})

// A project with two parts ken's model named, and a later commit that touches one of them.
async function namedProject() {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/core/run.ts': 'run()\n', 'src/core/wait.ts': 'wait()\n', 'src/store/db.ts': 'save()\n' },
		},
		{
			message: 'feat: the store keeps',
			files: { 'src/store/db.ts': 'keep()\n' },
			author: { name: 'Bo Other', email: 'bo@example.com' },
		},
	])
	const record = fileRecordStore(root, gitRepository(root))
	const drawn = await record.append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			arrows: [],
			parts: ['core', 'store'].map((name) => ({ name, job: `Does the work of ${name}`, paths: [`src/${name}`] })),
		},
	])
	if (drawn.kind !== 'appended') assert.fail(drawn.problems.join(' '))
	const server = await openKen(root, readerHome())
	const read = async (url: string): Promise<Answer> => {
		const { status, text } = await call(server, url)
		return { ok: status === 200, status, body: JSON.parse(text) }
	}
	return { server, read }
}

function briefOf(store: { get: (id: string, then: () => void) => Found }, id: string): Promise<Found> {
	return new Promise((resolve) => {
		const now = store.get(id, () => resolve(store.get(id, () => {})))
		if (now.kind !== 'reading') resolve(now)
	})
}

test('a brief the server sends is shown as sent: the page builds its own only on a 404', async () => {
	const sent = { id: 'part::store', kind: 'part', name: 'store', line: 'From the server' }
	const asked: string[] = []
	const read = async (url: string): Promise<Answer> => {
		asked.push(url)
		return { ok: true, status: 200, body: sent }
	}
	const found = await briefOf(briefStore({ read, rows: () => [], levelName: () => null }), 'part::store')
	assert.deepEqual(found, { kind: 'ok', brief: sent })
	assert.deepEqual(asked, ['/api/brief?concept=part%3A%3Astore'], 'and nothing else is read for it')

	const down = async (): Promise<Answer> => ({ ok: false, status: 500, body: { message: 'git is locked' } })
	const failed = await briefOf(briefStore({ read: down, rows: () => [], levelName: () => null }), 'part::store')
	assert.deepEqual(failed, { kind: 'none', message: 'git is locked' }, 'a server that fails says why')
})

test('the canvas draws a level it read from a real server, and the changes layer says what each part changed', async () => {
	const { server, read } = await namedProject()
	const state = { home: freshHome(() => null, { unfolded: new Set() }), rows: [] }
	const app = {
		state,
		render() {},
		read,
		post: (url: string, body: object) => json(server, url, body),
		fromView: (view: { entry: object }) => view.entry,
		stored: () => null,
	}
	const loads = homeLoads(app)
	const arch = { layer: null as string | null, process: null, drawOpen: false }
	const env = { off: null, running: null, seconds: 0 }
	const draw = () => architectureHtml({ home: state.home, arch, env, brief: null, column: false })

	await loads.refresh()
	const parts = draw()
	for (const name of ['core', 'store']) {
		assert.match(parts, new RegExp(`data-concept="part::${name}"`), `${name} is a block that opens its brief`)
	}
	assert.match(parts, /New to you/, 'each says what ken thinks the reader knows of it')

	const landed = state.home.changes.find((choice) => (choice as { kind: string }).kind === 'since') as {
		change: string
	}
	Object.assign(state.home, { change: landed.change })
	arch.layer = 'changes'
	await loads.refresh()
	const changed = draw()
	assert.match(changed, /<b class="k-num">1<\/b>.*?file/s, 'the part the commit touched says how many files')
	assert.match(changed, /No change/, 'and the other says it did not change')

	Object.assign(state.home, { trail: [WHOLE, { name: 'store', within: ['src/store'] }], change: 'none' })
	arch.layer = null
	await loads.refresh()
	assert.match(draw(), /db\.ts/, 'inside a part nobody named, the blocks are what git lists')
})
