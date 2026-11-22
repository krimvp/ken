// Lines with right angles around blocks, for the drawings of where a project runs and what it talks to. Each line is
// the cheapest path on a grid made from the edges of the blocks: length, plus a cost for each bend, for each frame
// edge it crosses, and for running along another line. A line leaves a block straight out from one of its sides, and
// the lines on one side of a block share it out. Then each line gets a label where it covers no block and no other
// label, and a ring where it crosses a frame's edge.

// How far a line keeps from a block, and the costs that shape a route.
const CLEAR = 18
const BEND = 60
const FRAME_EDGE = 40
const ALONG = 2.5
const ACROSS = 14
const SIDES = ['top', 'right', 'bottom', 'left']
const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }
// Directions on the grid: 0 right, 1 down, 2 left, 3 up.
const STEP = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
]
const DIR_OF = { right: 0, bottom: 1, left: 2, top: 3 }

const inside = (r, x, y, pad = 0) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad
const overlap = (a, b) =>
	Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
	Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

function portOn(rect, side, share) {
	if (side === 'top' || side === 'bottom')
		return { x: rect.x + rect.w * share, y: side === 'top' ? rect.y : rect.y + rect.h }
	return { x: side === 'left' ? rect.x : rect.x + rect.w, y: rect.y + rect.h * share }
}

class Heap {
	constructor() {
		this.items = []
	}
	push(cost, value) {
		const items = this.items
		items.push([cost, value])
		let i = items.length - 1
		while (i > 0) {
			const up = (i - 1) >> 1
			if (items[up][0] <= items[i][0]) break
			;[items[up], items[i]] = [items[i], items[up]]
			i = up
		}
	}
	pop() {
		const items = this.items
		const top = items[0]
		const last = items.pop()
		if (items.length > 0) {
			items[0] = last
			let i = 0
			for (;;) {
				const [l, r] = [2 * i + 1, 2 * i + 2]
				let small = i
				if (l < items.length && items[l][0] < items[small][0]) small = l
				if (r < items.length && items[r][0] < items[small][0]) small = r
				if (small === i) break
				;[items[small], items[i]] = [items[i], items[small]]
				i = small
			}
		}
		return top
	}
	get size() {
		return this.items.length
	}
}

const sorted = (values) => [...new Set(values.map((v) => Math.round(v * 2) / 2))].sort((a, b) => a - b)

// The coordinates a line may run on: the edges of the blocks and frames kept clear, the ports, and the middle of each
// wide gap, so a line between two rows runs in the middle of the room between them.
function axisOf(values) {
	const base = sorted(values)
	const mids = []
	for (let i = 1; i < base.length; i++) if (base[i] - base[i - 1] > 3 * CLEAR) mids.push((base[i] + base[i - 1]) / 2)
	return sorted([...base, ...mids])
}

// blocks are the rects lines go around, frames the rects they may cross, and asks the lines:
// [{ from, to, label }], where an end is { rect } (a side is picked) or { rect, side, at } (a fixed point on that
// side), and label is { w, h } or null. The answer has, per ask, { points, label, rings }.
export function routeLines(blocks, frames, asks) {
	const first = asks.map((ask) => ({ ask, sides: null }))
	const trial = routeAll(blocks, frames, first)
	// The lines on one side of a block share it out, in the order of where they go.
	const onSide = new Map()
	trial.forEach((route, i) => {
		for (const end of ['from', 'to']) {
			const spec = asks[i][end]
			if (spec.side) continue
			const side = end === 'from' ? route.fromSide : route.toSide
			const other = end === 'from' ? route.points.at(-1) : route.points[0]
			const key = `${blocks.indexOf(spec.rect)}:${spec.rect.x},${spec.rect.y}:${side}`
			if (!onSide.has(key)) onSide.set(key, [])
			onSide.get(key).push({ i, end, side, other })
		}
	})
	const fixed = asks.map((ask) => ({ ...ask, from: { ...ask.from }, to: { ...ask.to } }))
	for (const list of onSide.values()) {
		const along = list[0].side === 'top' || list[0].side === 'bottom' ? 'x' : 'y'
		list.sort((p, q) => p.other[along] - q.other[along] || p.i - q.i)
		list.forEach((each, k) => {
			const end = fixed[each.i][each.end]
			end.side = each.side
			end.at = 0.5 + ((k + 1) / (list.length + 1) - 0.5) * 0.7
		})
	}
	const routes = routeAll(
		blocks,
		frames,
		fixed.map((ask) => ({ ask })),
	)
	nudge(routes)
	const rings = routes.map((route) => ringsOf(route.points, frames))
	// A label keeps off the rings, so both can be read.
	const placed = rings.flat().map((ring) => ({ x: ring.x - 8, y: ring.y - 8, w: 16, h: 16 }))
	return routes.map((route, i) => {
		const label = asks[i].label ? placeLabel(route.points, asks[i].label, blocks, placed) : null
		if (label) placed.push(label)
		return { points: route.points, label, rings: rings[i] }
	})
}

function routeAll(blocks, frames, items) {
	const xs = []
	const ys = []
	for (const r of blocks) {
		xs.push(r.x - CLEAR, r.x + r.w + CLEAR)
		ys.push(r.y - CLEAR, r.y + r.h + CLEAR)
	}
	for (const f of frames) {
		xs.push(f.x - CLEAR, f.x + CLEAR, f.x + f.w - CLEAR, f.x + f.w + CLEAR)
		ys.push(f.y - CLEAR, f.y + CLEAR, f.y + f.h - CLEAR, f.y + f.h + CLEAR)
	}
	const ends = items.map(({ ask }) => ({ from: endsOf(ask.from), to: endsOf(ask.to) }))
	for (const end of ends.flatMap((each) => [...each.from, ...each.to])) {
		xs.push(end.stub.x)
		ys.push(end.stub.y)
	}
	const grid = { xs: axisOf(xs), ys: axisOf(ys) }
	const nx = grid.xs.length
	const ny = grid.ys.length
	const blocked = new Uint8Array(nx * ny)
	for (let i = 0; i < nx; i++) {
		for (let j = 0; j < ny; j++) {
			if (blocks.some((r) => inside(r, grid.xs[i], grid.ys[j], CLEAR - 0.5))) blocked[j * nx + i] = 1
		}
	}
	// How many lines already run along each step of the grid, across and down.
	const used = { h: new Uint8Array(nx * ny), v: new Uint8Array(nx * ny) }
	return items.map((_, k) => {
		const route = search(grid, blocked, used, frames, ends[k])
		markUsed(grid, used, route.points)
		return route
	})
}

function endsOf(spec) {
	const sides = spec.side ? [spec.side] : SIDES
	return sides.map((side) => {
		const port = portOn(spec.rect, side, spec.at ?? 0.5)
		const [nx, ny] = NORMAL[side]
		return { side, port, stub: { x: port.x + nx * CLEAR, y: port.y + ny * CLEAR } }
	})
}

const indexOf = (axis, value) => axis.indexOf(Math.round(value * 2) / 2)

function crossesFrame(frames, x1, y1, x2, y2) {
	let count = 0
	for (const f of frames) {
		if (y1 === y2) {
			if (y1 <= f.y || y1 >= f.y + f.h) continue
			for (const fx of [f.x, f.x + f.w]) if ((x1 - fx) * (x2 - fx) < 0) count++
		} else {
			if (x1 <= f.x || x1 >= f.x + f.w) continue
			for (const fy of [f.y, f.y + f.h]) if ((y1 - fy) * (y2 - fy) < 0) count++
		}
	}
	return count
}

function search(grid, blocked, used, frames, ends) {
	const { xs, ys } = grid
	const nx = xs.length
	const ny = ys.length
	const goals = new Map()
	for (const end of ends.to) {
		const i = indexOf(xs, end.stub.x)
		const j = indexOf(ys, end.stub.y)
		// The line arrives at the stub moving toward the block: against the side's normal.
		goals.set(j * nx + i, { end, dir: (DIR_OF[end.side] + 2) % 4 })
	}
	const goalPoints = ends.to.map((end) => end.stub)
	const guess = (i, j) => Math.min(...goalPoints.map((g) => Math.abs(xs[i] - g.x) + Math.abs(ys[j] - g.y)))
	const guessOf = (state) => {
		const node = state >> 2
		return guess(node % nx, Math.floor(node / nx))
	}
	const cost = new Float64Array(nx * ny * 4).fill(Number.POSITIVE_INFINITY)
	const back = new Int32Array(nx * ny * 4).fill(-1)
	const heap = new Heap()
	const starts = new Map()
	for (const end of ends.from) {
		const i = indexOf(xs, end.stub.x)
		const j = indexOf(ys, end.stub.y)
		const state = (j * nx + i) * 4 + DIR_OF[end.side]
		if (cost[state] <= CLEAR) continue
		cost[state] = CLEAR
		starts.set(state, end)
		heap.push(CLEAR + guess(i, j), state)
	}
	// A line that reaches a goal is pushed once more as finished, with the bend it needs to meet the block square.
	const FINISHED = nx * ny * 4
	const finish = new Map()
	let found = -1
	while (heap.size > 0) {
		const [total, state] = heap.pop()
		if (state >= FINISHED) {
			found = state - FINISHED
			break
		}
		if (total - guessOf(state) > cost[state] + 1e-6) continue
		const node = state >> 2
		const dir = state & 3
		const i = node % nx
		const j = (node - i) / nx
		const here = cost[state]
		const goal = goals.get(node)
		if (goal && !finish.has(state)) {
			finish.set(state, goal)
			const extra = goal.dir === dir ? 0 : BEND * (goal.dir === (dir + 2) % 4 ? 2 : 1)
			heap.push(here + extra + CLEAR, FINISHED + state)
		}
		for (let d = 0; d < 4; d++) {
			if (d === (dir + 2) % 4) continue
			const ni = i + STEP[d][0]
			const nj = j + STEP[d][1]
			if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
			const next = nj * nx + ni
			if (blocked[next] && !goals.has(next)) continue
			const length = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j])
			const lane = d % 2 === 0 ? used.h[Math.min(node, next)] : used.v[Math.min(node, next)]
			const perpendicular = d % 2 === 0 ? used.v[next] : used.h[next]
			let step = length * (1 + ALONG * lane) + (d === dir ? 0 : BEND) + (perpendicular ? ACROSS : 0)
			step += FRAME_EDGE * crossesFrame(frames, xs[i], ys[j], xs[ni], ys[nj])
			const nextState = next * 4 + d
			if (here + step < cost[nextState]) {
				cost[nextState] = here + step
				back[nextState] = state
				heap.push(here + step + guess(ni, nj), nextState)
			}
		}
	}
	if (found < 0) return straight(ends)
	const path = []
	let at = found
	let start = null
	while (at >= 0) {
		const node = at >> 2
		path.push({ x: xs[node % nx], y: ys[Math.floor(node / nx)] })
		if (back[at] < 0) start = starts.get(at)
		at = back[at]
	}
	path.reverse()
	const goal = finish.get(found)
	const points = simplify([start.port, ...path, goal.end.port])
	return { points, fromSide: start.side, toSide: goal.end.side }
}

// No route on the grid: a straight line between the two nearest ports.
function straight(ends) {
	let best = null
	for (const a of ends.from) {
		for (const b of ends.to) {
			const d = Math.abs(a.port.x - b.port.x) + Math.abs(a.port.y - b.port.y)
			if (!best || d < best.d) best = { d, a, b }
		}
	}
	return { points: [best.a.port, best.b.port], fromSide: best.a.side, toSide: best.b.side }
}

function simplify(points) {
	const out = []
	for (const p of points) {
		const last = out.at(-1)
		if (last && last.x === p.x && last.y === p.y) continue
		const before = out.at(-2)
		if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) {
			out[out.length - 1] = p
		} else out.push(p)
	}
	return out
}

function markUsed(grid, used, points) {
	const { xs, ys } = grid
	const nx = xs.length
	for (let k = 1; k < points.length; k++) {
		const [a, b] = [points[k - 1], points[k]]
		const ia = indexOf(xs, a.x)
		const ja = indexOf(ys, a.y)
		const ib = indexOf(xs, b.x)
		const jb = indexOf(ys, b.y)
		if (ia < 0 || ja < 0 || ib < 0 || jb < 0) continue
		if (ja === jb) for (let i = Math.min(ia, ib); i < Math.max(ia, ib); i++) used.h[ja * nx + i] = 1
		if (ia === ib) for (let j = Math.min(ja, jb); j < Math.max(ja, jb); j++) used.v[j * nx + ia] = 1
	}
}

// Two lines that run along the same stretch are moved apart, so each stays one line to the eye. The first and the
// last piece of a line stay where they are: they meet their block at its port.
const APART = 8
function nudge(routes) {
	const runs = []
	routes.forEach((route, r) => {
		const points = route.points
		for (let k = 2; k < points.length - 1; k++) {
			const [a, b] = [points[k - 1], points[k]]
			const across = a.y === b.y
			runs.push({
				r,
				k,
				across,
				at: across ? a.y : a.x,
				lo: Math.min(across ? a.x : a.y, across ? b.x : b.y),
				hi: Math.max(across ? a.x : a.y, across ? b.x : b.y),
			})
		}
	})
	const groups = new Map()
	for (const run of runs) {
		const key = `${run.across}:${run.at}`
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(run)
	}
	for (const group of groups.values()) {
		const shared = group.filter((run) =>
			group.some((other) => other.r !== run.r && other.lo < run.hi && other.hi > run.lo),
		)
		const lines = [...new Set(shared.map((run) => run.r))]
		if (lines.length < 2) continue
		lines.forEach((r, n) => {
			const shift = (n - (lines.length - 1) / 2) * APART
			for (const run of shared.filter((each) => each.r === r)) {
				const points = routes[r].points
				const key = run.across ? 'y' : 'x'
				points[run.k - 1] = { ...points[run.k - 1], [key]: run.at + shift }
				points[run.k] = { ...points[run.k], [key]: run.at + shift }
			}
		})
	}
}

function lengthOf(points) {
	let sum = 0
	for (let k = 1; k < points.length; k++)
		sum += Math.abs(points[k].x - points[k - 1].x) + Math.abs(points[k].y - points[k - 1].y)
	return sum
}

// The label sits on the line where it covers no block and no other label, as near the middle of the line as it can.
function placeLabel(points, size, blocks, placed) {
	const total = lengthOf(points)
	let best = null
	let walked = 0
	for (let k = 1; k < points.length; k++) {
		const [a, b] = [points[k - 1], points[k]]
		const piece = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
		for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
			const x = a.x + (b.x - a.x) * t
			const y = a.y + (b.y - a.y) * t
			const rect = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h }
			const covers =
				blocks.reduce((sum, r) => sum + overlap(rect, { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }), 0) +
				placed.reduce((sum, r) => sum + overlap(rect, { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }), 0)
			const score = covers * 10 + Math.abs(walked + piece * t - total / 2)
			if (!best || score < best.score) best = { score, rect }
		}
		walked += piece
	}
	return best?.rect ?? null
}

// Where a line crosses the edge of a frame.
export function ringsOf(points, frames) {
	const rings = []
	for (let k = 1; k < points.length; k++) {
		const [a, b] = [points[k - 1], points[k]]
		for (const f of frames) {
			if (a.y === b.y) {
				if (a.y <= f.y || a.y >= f.y + f.h) continue
				for (const fx of [f.x, f.x + f.w]) if ((a.x - fx) * (b.x - fx) < 0) rings.push({ x: fx, y: a.y })
			} else if (a.x === b.x) {
				if (a.x <= f.x || a.x >= f.x + f.w) continue
				for (const fy of [f.y, f.y + f.h]) if ((a.y - fy) * (b.y - fy) < 0) rings.push({ x: a.x, y: fy })
			}
		}
	}
	return rings
}
