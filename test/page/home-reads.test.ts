import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { call, json, openKen, readerHome } from '../fixtures/ken-server.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const HOME = path.join(import.meta.dirname, '../../src/page/home')
type Look = { boxes: { name: string }[]; change: { range: { base: string; head: string } } | null }
type Home = { wayIn: string; change: string; look: Look | null; reading: string | null }
type Loads = {
	refresh: () => Promise<void>
	enter: (wayIn: string) => Promise<void>
	settle: () => Promise<void>
	back: () => Promise<void>
}
const { freshHome }: { freshHome: (stored: () => null, ui: object) => Home } = await import(
	path.join(HOME, '../level/level-state.js')
)
const { homeLoads }: { homeLoads: (app: object) => Loads } = await import(path.join(HOME, '../level/loads.js'))
const { inspectorHtml }: { inspectorHtml: (home: object, env: object) => string } = await import(
	path.join(HOME, 'inspector/inspector.js')
)
const { canvasHtml }: { canvasHtml: (home: object, rows: object[]) => string } = await import(
	path.join(HOME, 'canvas/canvas.js')
)

const ENV = { off: null, running: null, seconds: 0, model: { kind: 'ok', name: 'none' }, rows: [], asked: false }

async function named(root: string, pictures: { parts: string[]; asked?: string }[]) {
	const record = fileRecordStore(root, gitRepository(root))
	for (const { parts, asked } of pictures) {
		const before = (await record.read()).current.findLast((entry) => entry.kind === 'layout')
		const drawn = await record.append([
			{
				kind: 'layout',
				within: [],
				at: 'HEAD',
				arrows: [],
				parts: parts.map((name) => ({ name, job: `Does the work of ${name}`, paths: [`src/${name}`] })),
				...(asked ? { asked } : {}),
				replaces: before?.id,
			},
		])
		if (drawn.kind !== 'appended') assert.fail(drawn.problems.join(' '))
	}
}

// The home's state and its reads against a real server, drawn on every render as the page draws it, so a state the
// page cannot draw fails here as it fails in the browser. While net.down is set, no read reaches the server.
async function pageOn(root: string) {
	const server = await openKen(root, readerHome())
	const state = { home: freshHome(() => null, { unfolded: new Set() }), rows: [] }
	const drawn = { canvas: '' }
	const net = { down: false }
	const app = {
		state,
		render() {
			drawn.canvas = canvasHtml(state.home, state.rows)
			inspectorHtml(state.home, ENV)
		},
		async read(url: string) {
			if (net.down) throw new Error('fetch failed')
			const { status, text } = await call(server, url)
			return { ok: status === 200, body: JSON.parse(text) }
		},
		post: (url: string, body: object) => json(server, url, body),
		fromView: (view: { entry: object }) => view.entry,
		stored: () => null,
	}
	return { home: state.home, loads: homeLoads(app), drawn, net }
}

test('each of the six switches between the three ways in shows a level, with what that way in lays over it', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n', 'src/store/db.ts': 'save()\n' } },
		{
			message: 'feat: the store keeps',
			files: { 'src/store/db.ts': 'keep()\n' },
			author: { name: 'Bo Other', email: 'bo@example.com' },
		},
	])
	const [own = '', head = ''] = hashes
	await named(root, [{ parts: ['core', 'store'] }])
	const { home, loads, drawn } = await pageOn(root)
	await loads.refresh()

	// What landed since the reader's own last commit is the span to catch up on, and the newest commit the change to
	// review: here both are the one commit by someone else.
	const landed = { base: own, head }
	const laidOver = { learn: null, 'catch-up': landed, review: landed }
	const ways = ['learn', 'catch-up', 'review', 'learn', 'review', 'catch-up', 'learn'] as const
	for (const [k, way] of ways.entries()) {
		const move = `${ways[k - 1] ?? 'the start'} to ${way}`
		await loads.enter(way)
		await loads.settle()
		assert.equal(home.reading, null, `${move}: the home is done reading`)
		assert.deepEqual(home.look?.change?.range ?? null, laidOver[way], `${move}: the change laid over the parts`)
		assert.match(drawn.canvas, /core/, `${move}: the canvas shows the parts`)
		assert.doesNotMatch(drawn.canvas, /home-reading/, `${move}: and no longer says it is reading`)
	}
})

test('after a read that failed, the next way in the reader presses shows its level', async () => {
	const { root } = buildRepository([
		{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n', 'src/store/db.ts': 'save()\n' } },
	])
	const { home, loads, drawn, net } = await pageOn(root)
	await loads.refresh()

	net.down = true
	await loads.enter('review')
	await loads.settle()
	assert.equal(home.reading, null, 'the home stops waiting')
	assert.match(drawn.canvas, /role="alert"/, 'and says it could not show the level')

	net.down = false
	await loads.enter('learn')
	await loads.settle()
	assert.match(drawn.canvas, /data-act="home-box"/, 'the next press shows the boxes')
	assert.doesNotMatch(drawn.canvas, /role="alert"|home-reading/, 'with nothing left of the failure')
})

test('going back to the picture before brings it back with no change laid over it that the reader did not pick', async () => {
	const { root } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'a\n', 'src/b/x.ts': 'b\n', 'src/c/x.ts': 'c\n' } },
	])
	await named(root, [{ parts: ['a', 'b', 'c'] }, { parts: ['a', 'b'], asked: 'fewer parts' }])
	writeFileSync(path.join(root, 'src/a/x.ts'), 'a, not committed\n')
	const { home, loads } = await pageOn(root)
	await loads.refresh()
	assert.deepEqual(
		[home.look?.boxes.length, home.look?.change],
		[2, null],
		'the reader looks at the redrawn parts alone',
	)

	await loads.back()
	assert.equal(home.look?.boxes.length, 3, 'the picture before is back')
	assert.equal(home.look?.change, null, 'with no change over it')
	assert.equal(home.change, 'none', 'and none picked')
})
