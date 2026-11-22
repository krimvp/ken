// Where the things of "In its world" stand: the project as one big block in the middle with its parts as tiles, the
// people above it, the outside systems that only send to it on its left, those it only sends to on its right, and
// those that go both ways below it. One line per crossing, with what crosses and how, and an arrow for its direction.
import { routeLines } from './route.js'
import { labelOf, SIZE } from './runtime-layout.js'

const TILE = { w: 232, h: 76, gap: 16 }
// Room for the project's name and two lines of what it is.
const HEAD = 128
const GAP = { side: 340, row: 200, between: 64 }
// More than this many on one side and the rest go below.
const MOST_ON_SIDE = 3

const HOW_WORDS = {
	http: 'over HTTP',
	https: 'over HTTPS',
	grpc: 'over gRPC',
	sql: 'in SQL',
	event: 'as events',
	file: 'as files',
	process: 'as a process',
	library: 'as a library call',
	other: '',
}

// What a crossing's label says: what crosses, and how.
export function crossingWords(crossing) {
	const how = HOW_WORDS[crossing.how] ?? ''
	return how === '' ? crossing.text : `${crossing.text}, ${how}`
}

// world is "In its world" as the server sends it, and parts the names of the top level's parts. The answer is in the
// canvas's own units, from (0, 0): { width, height, project: { x, y, w, h, tiles }, outside, lines }.
export function worldLayout(world, parts) {
	const cols = parts.length <= 4 ? 2 : 3
	const rows = Math.ceil(parts.length / cols)
	const w = cols * TILE.w + (cols - 1) * TILE.gap + 48
	const h = HEAD + Math.max(rows, 1) * (TILE.h + TILE.gap) - TILE.gap + 24
	const project = { x: 0, y: 0, w, h }
	project.tiles = parts.map((name, i) => ({
		name,
		x: 24 + (i % cols) * (TILE.w + TILE.gap),
		y: HEAD + Math.floor(i / cols) * (TILE.h + TILE.gap),
		w: TILE.w,
		h: TILE.h,
	}))

	const sides = { top: [], left: [], right: [], bottom: [] }
	for (const outside of world.outside) {
		const ways = new Set(world.crossings.filter((c) => c.outside === outside.id).map((c) => c.direction))
		const side =
			outside.kind === 'person'
				? 'top'
				: ways.size === 1 && ways.has('in')
					? 'left'
					: ways.size === 1 && ways.has('out')
						? 'right'
						: 'bottom'
		sides[side].push(outside)
	}
	for (const side of ['left', 'right']) {
		while (sides[side].length > MOST_ON_SIDE) sides.bottom.push(sides[side].pop())
	}

	const placed = []
	for (const [side, list] of Object.entries(sides)) {
		const sizes = list.map((each) => SIZE[each.kind === 'person' ? 'person' : 'outside'])
		const across = side === 'top' || side === 'bottom'
		const total = sizes.reduce((sum, s) => sum + (across ? s.w : s.h), 0) + GAP.between * (list.length - 1)
		let at = (across ? w : h) / 2 - total / 2
		list.forEach((outside, k) => {
			const s = sizes[k]
			const x = across ? at : side === 'left' ? -GAP.side - s.w : w + GAP.side
			const y = across ? (side === 'top' ? -GAP.row - s.h : h + GAP.row) : at
			placed.push({ id: outside.id, outside, x, y, w: s.w, h: s.h })
			at += (across ? s.w : s.h) + GAP.between
		})
	}

	const rectOf = new Map(placed.map((each) => [each.id, each]))
	const crossings = world.crossings.filter((c) => rectOf.has(c.outside))
	const asks = crossings.map((c) => {
		return { from: { rect: rectOf.get(c.outside) }, to: { rect: project }, label: labelOf(crossingWords(c), 18) }
	})
	const routes = routeLines([project, ...placed], [], asks)
	const lines = routes.map((route, i) => ({
		id: crossings[i].id,
		crossing: crossings[i],
		words: labelOf(crossingWords(crossings[i]), 18).lines,
		points: route.points,
		label: route.label,
	}))

	const MARGIN = 40
	const all = [project, ...placed, ...lines.flatMap((line) => (line.label ? [line.label] : []))]
	const minX = Math.min(...all.map((r) => r.x)) - MARGIN
	const minY = Math.min(...all.map((r) => r.y)) - MARGIN
	for (const r of [project, ...placed, ...lines.map((line) => line.label).filter(Boolean)]) {
		r.x -= minX
		r.y -= minY
	}
	for (const line of lines) line.points = line.points.map((p) => ({ x: p.x - minX, y: p.y - minY }))
	const width = Math.max(...all.map((r) => r.x + r.w)) + MARGIN
	const height = Math.max(...all.map((r) => r.y + r.h)) + MARGIN
	return { width, height, project, outside: placed, lines }
}
