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
	path.join(HOME, 'state/home-state.js')
)
const { homeLoads }: { homeLoads: (app: object) => Loads } = await import(path.join(HOME, 'state/loads.js'))
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
