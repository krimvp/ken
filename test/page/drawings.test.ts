import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { AIGENT, bigSystem, DEMO, DEMO_PARTS, SHOP, SHOP_NAMED, SHOP_PARTS } from '../fixtures/drawings.ts'

// The layout is plain JavaScript in the browser, so the test loads it by path.
const PAGE = path.join(import.meta.dirname, '../../src/page')
type Rect = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }
type Placed = Rect & {
	id: string
	thing: { kind: string; part?: string }
	second?: string
	solo?: { id: string; in: string | null } | null
}
type Line = {
	id: string
	kind: string
	points: Point[]
	label: Rect | null
	rings: Point[]
	from?: string
	to?: string
	thing?: string
	bus?: string
	crossing?: { from: string; to: string }
}
type Layout = {
	width: number
	height: number
	frames: (Rect & { id: string; frame: { in: string | null } })[]
	things: Placed[]
	lines: Line[]
	folds: { id: string; members: string[] }[]
}
const {
	runtimeLayout,
	foldedAt,
}: {
	runtimeLayout: (views: object, options?: { folded?: boolean; narrow?: boolean }) => Layout
	foldedAt: (zoom: number, folded: boolean) => boolean
} = await import(path.join(PAGE, 'arch-views/runtime-layout.js'))
const {
	worldLayout,
}: {
	worldLayout: (world: object, parts: string[]) => { project: Rect; outside: Rect[]; lines: Line[] }
} = await import(path.join(PAGE, 'arch-views/world-layout.js'))

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const holds = (outer: Rect, inner: Rect) =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.w <= outer.x + outer.w &&
	inner.y + inner.h <= outer.y + outer.h

// Whether a piece of a line comes within near of a block: through it, or so close along it that the eye joins them.
function cuts(a: Point, b: Point, r: Rect, near = 0) {
	const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
	const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
	return x1 < r.x + r.w + near && x2 > r.x - near && y1 < r.y + r.h + near && y2 > r.y - near
}
const onEdge = (p: Point, r: Rect) =>
	p.x >= r.x - 0.5 &&
	p.x <= r.x + r.w + 0.5 &&
	p.y >= r.y - 0.5 &&
	p.y <= r.y + r.h + 0.5 &&
	(Math.abs(p.x - r.x) < 0.5 ||
		Math.abs(p.x - r.x - r.w) < 0.5 ||
		Math.abs(p.y - r.y) < 0.5 ||
		Math.abs(p.y - r.y - r.h) < 0.5)
// The two things a line joins: a crossing's two ends, a thing and its bus, or the two places of a part.
const endsOf = (line: Line) =>
	line.kind === 'stem'
		? [line.thing, line.bus]
		: line.kind === 'tie'
			? [line.from, line.to]
			: [line.crossing?.from, line.crossing?.to]
// What the eye takes for touching a block, in the drawing's units: 16 pixels at 65%.
const NEAR = 24

const PROJECTS = [
	['the demo project', DEMO],
	['the shop', SHOP],
	['a system of 30 things in 4 frames', bigSystem()],
	['the aigent repository as its drawings were named', AIGENT],
	['the shop as its drawings were named', SHOP_NAMED],
] as const

for (const [name, views] of PROJECTS) {
	for (const folded of [false, true]) {
		test(`on ${name}${folded ? ', folded,' : ''} no two blocks overlap, every frame holds what is in it, and no line or label crosses a block`, () => {
			const drawn = runtimeLayout(views, { folded })
			const blocks: Rect[] = drawn.things
			for (const [i, a] of blocks.entries()) {
				for (const b of blocks.slice(i + 1))
					assert.ok(!meets(a, b), `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`)
			}
			const frameOf = new Map(drawn.frames.map((f) => [f.id, f]))
			for (const placed of drawn.things) {
				let at = (placed.thing as { frame?: string | null }).frame ?? null
				// A frame that holds one thing is drawn as that thing.
				if (placed.solo?.id === at) at = placed.solo.in
				while (at !== null) {
					const frame = frameOf.get(at)
					assert.ok(frame && holds(frame, placed), `${placed.id} sits in ${at}`)
					at = frame.frame.in
				}
			}
			for (const frame of drawn.frames) {
				if (frame.frame.in)
					assert.ok(holds(frameOf.get(frame.frame.in) as Rect, frame), `${frame.id} sits in its frame`)
				for (const other of drawn.frames) {
					if (other === frame || other.frame.in !== frame.frame.in) continue
					assert.ok(!meets(frame, other), `frames ${frame.id} and ${other.id} overlap`)
				}
			}
			for (const line of drawn.lines) {
				const ends = endsOf(line)
				for (const block of drawn.things) {
					if (line.label) assert.ok(!meets(line.label, block), `the label of ${line.id} lies over ${block.id}`)
					if (ends.includes(block.id)) continue
					for (let k = 1; k < line.points.length; k++) {
						const [a, b] = [line.points[k - 1] as Point, line.points[k] as Point]
						assert.ok(!cuts(a, b, block, NEAR), `line ${line.id} runs through or along ${block.id}`)
					}
				}
			}
			assert.ok(drawn.width > 0 && drawn.height > 0)
		})
	}
	test(`on ${name} every line starts on one thing it joins and ends on the other`, () => {
		const drawn = runtimeLayout(views)
		const rectOf = new Map(drawn.things.map((placed) => [placed.id, placed]))
		for (const line of drawn.lines) {
			const [from, to] = endsOf(line).map((id) => rectOf.get(id as string))
			assert.ok(from && to, `both ends of ${line.id} are drawn`)
			const [first, last] = [line.points[0] as Point, line.points.at(-1) as Point]
			const forward = onEdge(first, from) && onEdge(last, to)
			assert.ok(forward || (onEdge(first, to) && onEdge(last, from)), `${line.id} joins its two things`)
		}
	})
}

const {
	fitted,
}: {
	fitted: (world: Rect, room: { w: number; h: number }, clear: { top: number; h: number }) => Point & { z: number }
} = await import(path.join(PAGE, 'architecture/camera.js'))

// The canvas of a 1440 by 900 window, and the band of it between the bars that float on its top and on its foot, as
// the page measures them.
const LAPTOP = { room: { w: 1344, h: 836 }, clear: { top: 116, h: 590 } }

for (const [name, views] of [
	['the aigent repository', AIGENT],
	['the shop', SHOP_NAMED],
] as const) {
	test(`on ${name} "Where it runs" fits whole between the bars of a laptop's screen, at 75% or closer`, () => {
		const drawn = runtimeLayout(views)
		const cam = fitted({ x: 0, y: 0, w: drawn.width, h: drawn.height }, LAPTOP.room, LAPTOP.clear)
		assert.ok(cam.z >= 0.75, `fitted at ${Math.round(cam.z * 100)}%`)
		for (const r of [...drawn.frames, ...drawn.things]) {
			const [x, y] = [cam.x + r.x * cam.z, cam.y + r.y * cam.z]
			assert.ok(x >= 0 && x + r.w * cam.z <= LAPTOP.room.w, `${r.id} is inside the canvas across`)
			assert.ok(
				y >= LAPTOP.clear.top && y + r.h * cam.z <= LAPTOP.clear.top + LAPTOP.clear.h,
				`${r.id} is clear of the bars`,
			)
		}
	})
}

// The canvas of a 390 by 844 phone, and its band between the bars, as the page measures them.
const PHONE = { room: { w: 390, h: 718 }, clear: { top: 186, h: 329 } }

for (const [name, views] of [
	['the aigent repository', AIGENT],
	['the shop', SHOP_NAMED],
] as const) {
	test(`on ${name} "Where it runs" on a phone is one column that fits the width at 55% or closer`, () => {
		const drawn = runtimeLayout(views, { narrow: true })
		const cam = fitted({ x: 0, y: 0, w: drawn.width, h: drawn.height }, PHONE.room, PHONE.clear)
		assert.ok(cam.z >= 0.55, `fitted at ${Math.round(cam.z * 100)}%`)
		for (const r of [...drawn.frames, ...drawn.things]) {
			const x = cam.x + r.x * cam.z
			assert.ok(x >= 0 && x + r.w * cam.z <= PHONE.room.w, `${r.id} is inside the phone across`)
		}
	})
}

test('a frame with nothing in it is not drawn, and a line inside one place carries no label', () => {
	const drawn = runtimeLayout(AIGENT)
	assert.deepEqual(drawn.frames.map((f) => f.id).sort(), ['node-process', 'sandbox-worker'])
	const said = (id: string) => drawn.lines.find((line) => line.id === id)?.label != null
	for (const id of ['c-open', 'c-engine', 'c-plugins']) assert.equal(said(id), false, `${id} is a call in one process`)
	for (const id of ['c-model', 'c-spawn', 'c-read-scenario', 'c-run'])
		assert.equal(said(id), true, `${id} crosses a frame`)
})

test('a line that goes from inside a frame to outside it has a ring where it crosses the frame', () => {
	const drawn = runtimeLayout(DEMO)
	const toModel = drawn.lines.find((line) => line.id === 'c7')
	assert.ok(toModel, 'the call to the model is drawn')
	const host = drawn.frames.find((f) => f.id === 'host') as Rect
	assert.equal(toModel.rings.length, 1)
	const [ring] = toModel.rings as [Point]
	const onEdge = ring.x === host.x || ring.x === host.x + host.w || ring.y === host.y || ring.y === host.y + host.h
	assert.ok(onEdge, 'the ring sits on the frame of the host process')
	const inside = drawn.lines.find((line) => line.id === 'c3') as Line
	assert.equal(inside.rings.length, 0, 'a call inside one frame has no ring')
})

test('a part in two frames is drawn twice, the second place small, and a part each container runs is drawn whole', () => {
	const drawn = runtimeLayout(DEMO)
	const sandboxes = drawn.things.filter((placed) => placed.thing.part === 'Sandbox')
	assert.equal(sandboxes.length, 2)
	const [first, second] = [sandboxes.find((placed) => !placed.second), sandboxes.find((placed) => placed.second)]
	assert.equal(second?.id, 'sandbox-worker')
	assert.ok(first && second && second.w * second.h < first.w * first.h, 'the second place is smaller')
	const workers = runtimeLayout(SHOP_NAMED).things.filter((placed) => placed.thing.part === 'Event workers')
	assert.equal(workers.length, 3)
	assert.ok(
		workers.every((placed) => !placed.second && placed.solo),
		'each is the block of the container it runs in',
	)
})

test('a frame of more than eight things folds them by name prefix, and zooming in unfolds them', () => {
	const views = bigSystem()
	const open = runtimeLayout(views, { folded: false })
	assert.equal(open.things.filter((placed) => placed.thing.kind === 'fold').length, 0)
	const folded = runtimeLayout(views, { folded: true })
	const orders = folded.folds.find((fold) => fold.id.endsWith(':orders'))
	assert.deepEqual(orders?.members, ['orders-1', 'orders-2', 'orders-3'])
	assert.ok(folded.things.length < open.things.length, 'fewer blocks when folded')
	assert.ok(!folded.things.some((placed) => placed.id === 'orders-2'), 'a folded member is not drawn alone')
	assert.ok(
		folded.lines.some((line) => line.id === 'db-c'),
		'a line to a folded member goes to its fold',
	)
	// The edge frame holds two things and does not fold.
	assert.ok(folded.things.some((placed) => placed.id === 'edge-1'))
	assert.equal(foldedAt(1.1, true), false, 'zooming in past 100% unfolds')
	assert.equal(foldedAt(0.9, false), false, 'a small step back keeps it open')
	assert.equal(foldedAt(0.7, false), true, 'zooming well out folds again')
})

test('in its world the project is in the middle, people above, and each crossing has one labelled line', () => {
	const drawn = worldLayout(SHOP.world, SHOP_PARTS)
	assert.equal(drawn.lines.length, SHOP.world.crossings.length)
	const shopper = drawn.outside.find((each) => (each as unknown as { id: string }).id === 'shopper') as Rect
	assert.ok(shopper.y + shopper.h < drawn.project.y, 'the shopper stands above the project')
	const all: Rect[] = [drawn.project, ...drawn.outside]
	for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) assert.ok(!meets(a, b))
	for (const line of drawn.lines) {
		assert.ok(line.label, 'every crossing has a label')
		for (const block of all) assert.ok(!meets(line.label, block), `the label of ${line.id} lies over a block`)
	}
	assert.ok(worldLayout(DEMO.world, DEMO_PARTS).lines.length === DEMO.world.crossings.length)
})

const {
	viewsOffered,
	viewOn,
}: {
	viewsOffered: (home: object, top?: object | null) => string[]
	viewOn: (arch: { view: string | null }, offered: string[]) => string
} = await import(path.join(PAGE, 'arch-views/switch.js'))

test('the switch offers only the drawings the project has, how it works first and how the code is split second', () => {
	const top = (views: object | null) => ({ trail: [{ within: [] }], look: { views } })
	assert.deepEqual(viewsOffered(top(null)), [])
	assert.deepEqual(viewsOffered(top({ world: null, runtime: null })), [])
	const worldOnly = viewsOffered(top({ world: DEMO.world, runtime: null }))
	assert.deepEqual(worldOnly, ['parts', 'world'])
	const both = viewsOffered(top(DEMO))
	assert.deepEqual(both, ['runtime', 'parts', 'world'])
	const inside = { trail: [{ within: [] }, { within: ['src'] }], look: { views: null } }
	assert.deepEqual(viewsOffered(inside, DEMO), both, "inside a part the switch still offers the top's drawings")
	assert.equal(viewOn({ view: null }, both), 'runtime', 'the page opens on "Where it runs"')
	assert.equal(viewOn({ view: 'world' }, both), 'world', "the reader's last choice is kept")
	assert.equal(viewOn({ view: 'runtime' }, worldOnly), 'parts', 'a choice the level lacks falls back to the first')
})

const { briefHtml }: { briefHtml: (ui: object, found: object, ctx: object) => string } = await import(
	path.join(PAGE, 'brief/brief.js')
)

test("a bus's brief lists each topic with who publishes it and who picks it up", () => {
	const brief = {
		id: 'store:bus',
		kind: 'store',
		name: 'Event bus',
		line: 'Carries the events.',
		minutes: 1,
		points: [],
		terms: [],
		quotes: [],
		questions: [],
		decisions: [],
		explained: true,
		trust: '',
		sideways: { uses: [], usedBy: [], processes: [] },
		topics: ['order.placed', 'payments.dead-letter'],
		gaps: ['no reader of payments.dead-letter in the repository'],
	}
	const ui = { id: brief.id, on: null, trail: [{ id: brief.id, name: brief.name }], openQuotes: new Set() }
	const ctx = { home: {}, prefs: { text: 'pictures' }, env: {}, look: null, inner: null, views: SHOP }
	const html = briefHtml(ui, { kind: 'ok', brief }, ctx)
	const topic = (name: string) => html.slice(html.indexOf(`<code>${name}</code>`)).split('</li>')[0] ?? ''
	assert.match(topic('order.placed'), /Publishes: orders<\/span>/)
	assert.match(topic('order.placed'), /Picks up: payments<\/span>/)
	assert.match(topic('payments.dead-letter'), /Publishes: payments<\/span>/)
	assert.match(topic('payments.dead-letter'), /Picks up: <em>none drawn<\/em>/)
	assert.match(html, /no reader of payments\.dead-letter in the repository/)
})

test('two buses with the same topic show only publishers and readers tied to each bus', () => {
	const { runtime } = SHOP
	const bus = runtime.things.find((t) => t.id === 'bus')
	assert.ok(bus)
	const views = { ...SHOP, runtime: { ...runtime, things: [...runtime.things, { ...bus, id: 'second-bus' }] } }
	const drawn = runtimeLayout(views)
	assert.ok(
		drawn.lines.some((line) => line.kind === 'event' && line.id === 'e1'),
		'the direct order.placed event stays between its two parts',
	)
	const brief = {
		id: 'store:second-bus',
		kind: 'store',
		name: 'Second bus',
		line: '',
		minutes: 1,
		points: [],
		terms: [],
		quotes: [],
		questions: [],
		decisions: [],
		explained: true,
		trust: '',
		sideways: { uses: [], usedBy: [], processes: [] },
		topics: ['order.placed', 'payments.dead-letter'],
	}
	const ui = { id: brief.id, on: null, trail: [{ id: brief.id, name: brief.name }], openQuotes: new Set() }
	const html = briefHtml(
		ui,
		{ kind: 'ok', brief },
		{ home: {}, prefs: { text: 'pictures' }, env: {}, look: null, inner: null, views },
	)
	assert.doesNotMatch(html, /Publishes: (orders|payments)|Picks up: payments/)
})

test("a crossing's brief has its two ends beside it, from the drawing, when the server sends none", () => {
	const brief = {
		id: 'crossing:c-model',
		kind: 'crossing',
		name: 'Host entry and pi adapter to OpenAI-compatible model API',
		line: 'Model requests.',
		minutes: 1,
		points: [],
		terms: [],
		quotes: [],
		questions: [],
		decisions: [],
		explained: true,
		trust: '',
		sideways: { uses: [], usedBy: [], processes: [] },
	}
	const ui = { id: brief.id, on: 'sideways', trail: [{ id: brief.id, name: brief.name }], openQuotes: new Set() }
	const ctx = { home: {}, prefs: { text: 'pictures' }, env: {}, look: null, inner: null, views: AIGENT }
	const html = briefHtml(ui, { kind: 'ok', brief }, ctx)
	const after = (title: string) => html.slice(html.indexOf(title)).split('</ul>')[0] ?? ''
	assert.match(after('Comes in from'), /Host entry and pi adapter/)
	assert.match(after('Goes out to'), /OpenAI-compatible model API/)
	assert.match(html, /data-way="sideways"[^>]*>.*?<b class="k-num">2<\/b>/s)
})
