import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { bigSystem, DEMO, DEMO_PARTS, SHOP, SHOP_PARTS } from '../fixtures/drawings.ts'

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
}
type Layout = {
	width: number
	height: number
	frames: (Rect & { id: string; frame: { in: string | null } })[]
	things: Placed[]
	notes: (Rect & { on: string })[]
	lines: Line[]
	folds: { id: string; members: string[] }[]
}
const {
	runtimeLayout,
	foldedAt,
}: {
	runtimeLayout: (views: object, options?: { folded: boolean }) => Layout
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

// Whether a piece of a line runs through the inside of a block.
function cuts(a: Point, b: Point, r: Rect) {
	const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
	const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
	return x1 < r.x + r.w - 1 && x2 > r.x + 1 && y1 < r.y + r.h - 1 && y2 > r.y + 1
}

const PROJECTS = [
	['the demo project', DEMO],
	['the shop', SHOP],
	['a system of 30 things in 4 frames', bigSystem()],
] as const

for (const [name, views] of PROJECTS) {
	for (const folded of [false, true]) {
		test(`on ${name}${folded ? ', folded,' : ''} no two blocks overlap, every frame holds what is in it, and no line or label crosses a block`, () => {
			const drawn = runtimeLayout(views, { folded })
			const blocks: Rect[] = [...drawn.things, ...drawn.notes]
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
				const ends = new Set([line.points[0], line.points.at(-1)])
				for (const block of drawn.things) {
					for (let k = 1; k < line.points.length; k++) {
						const [a, b] = [line.points[k - 1] as Point, line.points[k] as Point]
						if (ends.has(a) || ends.has(b)) continue
						assert.ok(!cuts(a, b, block), `line ${line.id} runs through ${block.id}`)
					}
					if (line.label) assert.ok(!meets(line.label, block), `the label of ${line.id} lies over ${block.id}`)
				}
			}
			assert.ok(drawn.width > 0 && drawn.height > 0)
		})
	}
}

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

test('a part in two frames is drawn twice, the second place tied to the first', () => {
	const drawn = runtimeLayout(DEMO)
	const sandboxes = drawn.things.filter((placed) => placed.thing.part === 'Sandbox')
	assert.equal(sandboxes.length, 2)
	const second = sandboxes.find((placed) => placed.second)
	assert.equal(second?.id, 'sandbox-worker')
	assert.ok(drawn.lines.some((line) => line.kind === 'tie' && line.from === 'sandbox' && line.to === 'sandbox-worker'))
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
