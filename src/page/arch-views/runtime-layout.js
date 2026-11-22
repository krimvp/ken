// Where the frames, things and lines of "Where it runs" stand, placed by code. Frames are a tree laid out inside out:
// a frame's size comes from what is in it. Inside a frame the things stand in rows. What calls stands above what it
// calls; a bus has its own row under what reaches it by calls, and things that only meet through the bus stand under
// it. A store that one thing uses alone stands beside that thing. Outside things stand at the edge of the drawing
// nearest the thing they cross with. Lines go around blocks at right angles (route.js). A frame that holds more than
// eight things folds those that share a name prefix or a store into one block with a count, until the reader zooms in.
import { routeLines } from './route.js'

export const SIZE = {
	part: { w: 252, h: 124 },
	store: { w: 212, h: 124 },
	outside: { w: 252, h: 100 },
	person: { w: 200, h: 148 },
	fold: { w: 252, h: 132 },
}
const GAP = { x: 150, y: 128 }
const BESIDE = 136
const PAD = { side: 32, top: 76, bottom: 32 }
const EDGE = 200
const BUS = { head: 58, lane: 32, foot: 14, least: 700 }
const NOTE = { gap: 12, line: 25, pad: 16, width: 252, chars: 22 }
const SOLO_KINDS = ['container', 'process', 'function']
// A frame folds what it holds when it holds more than this.
export const MOST_THINGS = 8
// The zoom at which a folded drawing opens, and the one under which it folds again.
export const UNFOLD_AT = 1
const FOLD_AT = 0.8

// Whether the drawing is folded after the reader zoomed to zoom, from whether it was before.
export function foldedAt(zoom, folded) {
	return folded ? zoom < UNFOLD_AT : zoom < FOLD_AT
}

// A label's words, in lines of at most twelve letters (or most) where the words allow, and the size it takes.
const LABEL = { line: 25, pad: 10, char: 11.5, side: 26, least: 60, most: 12 }
export function labelOf(text, most = LABEL.most) {
	const lines = ['']
	for (const word of text.split(/\s+/)) {
		const line = lines.at(-1)
		if (line !== '' && line.length + 1 + word.length > most) lines.push(word)
		else lines[lines.length - 1] = line === '' ? word : `${line} ${word}`
	}
	const w = Math.max(LABEL.least, Math.max(...lines.map((line) => line.length)) * LABEL.char + LABEL.side)
	return { lines, w, h: lines.length * LABEL.line + LABEL.pad }
}

// The words on a call's label: its protocol, or what crosses when the way is "other".
const HOW_LABELS = {
	http: 'HTTP',
	https: 'HTTPS',
	grpc: 'gRPC',
	sql: 'SQL',
	event: 'event',
	file: 'files',
	process: 'process',
	library: 'library',
}
export const howLabel = (crossing) => HOW_LABELS[crossing.how] ?? crossing.text

const hasLanes = (thing) => thing?.kind === 'store' && thing.topics.length > 0

function noteSize(text, width) {
	const chars = Math.max(12, Math.floor(((width - NOTE.pad) / NOTE.width) * NOTE.chars))
	const lines = Math.ceil(text.length / chars)
	return { w: width, h: NOTE.pad + lines * NOTE.line }
}

// Things that share a name prefix, or a store none of the others use, fold into one block per frame.
function foldsOf(runtime, folded) {
	if (!folded) return []
	const folds = []
	const places = [...new Set(runtime.things.map((thing) => thing.frame ?? ''))]
	for (const place of places) {
		const here = runtime.things.filter((thing) => (thing.frame ?? '') === place)
		if (here.length <= MOST_THINGS) continue
		const parts = here.filter((thing) => thing.kind === 'part')
		const taken = new Set()
		const groups = new Map()
		for (const thing of parts) {
			const prefix = thing.part.toLowerCase().split(/[\s._:/-]+/)[0]
			if (!groups.has(prefix)) groups.set(prefix, [])
			groups.get(prefix).push(thing)
		}
		for (const [prefix, members] of groups) {
			if (members.length < 2) continue
			for (const member of members) taken.add(member.id)
			folds.push({
				id: `fold:${place}:${prefix}`,
				name: prefix,
				frame: place || null,
				members: members.map((m) => m.id),
			})
		}
		for (const store of here.filter((thing) => thing.kind === 'store' && !hasLanes(thing))) {
			const users = parts.filter(
				(thing) =>
					!taken.has(thing.id) &&
					runtime.crossings.some(
						(c) => (c.from === thing.id && c.to === store.id) || (c.to === thing.id && c.from === store.id),
					),
			)
			if (users.length < 2) continue
			for (const member of users) taken.add(member.id)
			folds.push({
				id: `fold:${place}:${store.id}`,
				name: `${store.name} users`,
				frame: place || null,
				members: users.map((m) => m.id),
			})
		}
	}
	return folds
}

// The drawing with each fold standing in for its members: one thing, and one line where several went the same way.
function foldedRuntime(runtime, folds) {
	const into = new Map(folds.flatMap((fold) => fold.members.map((member) => [member, fold.id])))
	const to = (id) => into.get(id) ?? id
	const seen = new Set()
	const crossings = []
	for (const crossing of runtime.crossings) {
		const moved = { ...crossing, from: to(crossing.from), to: to(crossing.to) }
		if (moved.from === moved.to) continue
		const key = `${moved.from}>${moved.to}:${moved.kind}:${moved.kind === 'call' ? moved.how : moved.topic}`
		if (seen.has(key)) continue
		seen.add(key)
		crossings.push(moved)
	}
	const things = [
		...runtime.things.filter((thing) => !into.has(thing.id)),
		...folds.map((fold) => ({ id: fold.id, kind: 'fold', name: fold.name, frame: fold.frame, members: fold.members })),
	]
	return { ...runtime, things, crossings }
}

// views is the two drawings as the server sends them: "Where it runs" is laid out, and "In its world" says which
// outside things are people. folded says whether a crowded frame folds. The answer is in the canvas's own units, from
// (0, 0): { width, height, frames, things, lines, lanes, marks, notes, folds }.
export function runtimeLayout(views, { folded = false } = {}) {
	const people = new Set((views.world?.outside ?? []).filter((each) => each.kind === 'person').map((each) => each.id))
	const runtime = views.runtime
	const folds = foldsOf(runtime, folded)
	const drawn = folds.length > 0 ? foldedRuntime(runtime, folds) : runtime
	const thingOf = new Map(drawn.things.map((thing) => [thing.id, thing]))
	// A container, process or function that holds one thing and nothing else is drawn as that thing, with the frame's
	// copies on it: "orders, 2 copies". A browser, a machine, a cluster or a sandbox stays a frame.
	const solos = new Map()
	for (const frame of drawn.frames.filter((each) => SOLO_KINDS.includes(each.kind))) {
		const things = drawn.things.filter((thing) => thing.frame === frame.id)
		const frames = drawn.frames.filter((other) => other.in === frame.id)
		const gaps = drawn.gaps.filter((gap) => gap.on === frame.id)
		if (things.length === 1 && frames.length === 0 && gaps.length === 0 && things[0].kind !== 'outside') {
			solos.set(frame.id, frame)
		}
	}
	const frameOf = new Map(drawn.frames.filter((frame) => !solos.has(frame.id)).map((frame) => [frame.id, frame]))
	const parentOf = (frameId) => {
		const frame = frameOf.get(frameId)
		return frame?.in && frameOf.has(frame.in) ? frame.in : null
	}
	const placeOf = (thing) => {
		const at = solos.has(thing.frame) ? solos.get(thing.frame).in : thing.frame
		return at && frameOf.has(at) ? at : null
	}
	const gapsOn = (id) => drawn.gaps.filter((gap) => gap.on === id)
	// A thing outside every frame that is an outside system or a person stands at the edge of the drawing.
	const atEdge = (thing) => thing.kind === 'outside' && placeOf(thing) === null

	// The bus an event travels on: the store with lanes at one of its ends, or the one that lists its topic.
	const buses = drawn.things.filter(hasLanes)
	const busOf = (crossing) => {
		if (crossing.kind !== 'event') return null
		const end = [crossing.from, crossing.to].map((id) => thingOf.get(id)).find(hasLanes)
		return end ?? buses.find((bus) => bus.topics.includes(crossing.topic)) ?? null
	}

	// The child of a frame (or of the top, null) that holds a thing: the thing, or the frame under it that holds it.
	function childOf(place, thingId) {
		const thing = thingOf.get(thingId)
		if (!thing) return undefined
		let at = placeOf(thing)
		if (at === place) return thingId
		while (at !== null) {
			const up = parentOf(at)
			if (up === place) return `frame:${at}`
			at = up
		}
		return undefined
	}

	function sizeOfThing(thing) {
		if (hasLanes(thing)) return { w: BUS.least, h: BUS.head + thing.topics.length * BUS.lane + BUS.foot }
		if (thing.kind === 'outside') return SIZE[people.has(thing.id) ? 'person' : 'outside']
		return SIZE[thing.kind]
	}

	// Lays out what one frame holds, at (0, 0). Answers { w, h, items } with each item at its place.
	function layoutPlace(place) {
		const items = []
		for (const frame of frameOf.values()) {
			if ((frame.in && frameOf.has(frame.in) ? frame.in : null) === place) items.push(frameItem(frame))
		}
		for (const thing of drawn.things) {
			if (placeOf(thing) !== place || (place === null && atEdge(thing))) continue
			const size = sizeOfThing(thing)
			const notes = gapsOn(thing.id).map((gap) => ({ gap, ...noteSize(gap.text, Math.max(size.w, NOTE.width)) }))
			const below = notes.reduce((sum, note) => sum + NOTE.gap + note.h, 0)
			items.push({ key: thing.id, kind: 'thing', thing, w: size.w, h: size.h, foot: size.h + below, notes })
		}
		return arrange(place, items)
	}

	function frameItem(frame) {
		const inner = layoutPlace(frame.id)
		const label = frameLabel(frame)
		const notes = gapsOn(frame.id).map((gap) => ({ gap, ...noteSize(gap.text, NOTE.width) }))
		const notesH = notes.reduce((sum, note) => sum + note.h + NOTE.gap, 0)
		const w = Math.max(inner.w + 2 * PAD.side, label.w + 2 * 16, ...notes.map((note) => note.w + 2 * PAD.side))
		// An empty frame is its label.
		const h = inner.h + notesH === 0 ? 70 : PAD.top + inner.h + (notesH > 0 ? NOTE.gap + notesH : 0) + PAD.bottom
		return { key: `frame:${frame.id}`, kind: 'frame', frame, w, h, foot: h, inner, notes }
	}

	function arrange(place, items) {
		if (items.length === 0) return { w: 0, h: 0, items }
		const index = new Map(items.map((item, i) => [item.key, i]))
		const at = (thingId) => index.get(childOf(place, thingId))
		const calls = new Set()
		const touches = new Map(items.map((_, i) => [i, new Set()]))
		const users = new Map(items.map((_, i) => [i, new Set()]))
		for (const crossing of drawn.crossings) {
			const [a, b] = [at(crossing.from), at(crossing.to)]
			const bus = busOf(crossing)
			if (bus) {
				const l = at(bus.id)
				for (const end of [a, b]) if (l !== undefined && end !== undefined && end !== l) touches.get(l).add(end)
				continue
			}
			if (a === undefined || b === undefined || a === b) continue
			for (const [store, other] of [
				[a, b],
				[b, a],
			]) {
				if (items[store].thing?.kind === 'store') users.get(store).add(other)
			}
			calls.add(`${a}>${b}`)
		}
		// A store that one thing here uses alone, and that nothing else here touches, stands beside it.
		const besideOf = new Map()
		items.forEach((item, i) => {
			if (item.thing?.kind !== 'store' || hasLanes(item.thing)) return
			const [only, more] = [...users.get(i)]
			if (only === undefined || more !== undefined || items[only].thing?.kind === 'store') return
			besideOf.set(i, only)
		})
		const edges = [...calls]
			.map((pair) => pair.split('>').map(Number))
			.filter(([a, b]) => !besideOf.has(a) && !besideOf.has(b))
		const rest = items.map((_, i) => i).filter((i) => !besideOf.has(i))
		const rank = ranksOf(rest, edges, touches, items)
		const ranked = []
		for (const i of rest) {
			ranked[rank.get(i)] ??= []
			ranked[rank.get(i)].push(i)
		}
		// What calls each child from outside this frame, so children called by one outside thing stand together.
		const callers = new Map(items.map((_, i) => [i, new Set()]))
		// The children that meet a bus outside this frame: they stand last, nearest the bus.
		const toBus = new Set()
		for (const c of drawn.crossings) {
			const [a, b] = [at(c.from), at(c.to)]
			if (a === undefined && b !== undefined) callers.get(b).add(c.from)
			const bus = busOf(c)
			if (bus && at(bus.id) === undefined) for (const end of [a, b]) if (end !== undefined) toBus.add(end)
		}
		const rows = joinLoose(chained(ranked.filter(Boolean), edges, items), edges, touches, callers, toBus)
		const ordered = wrapped(orderRows(rows, edges, touches), items, besideOf)
		for (const [store, user] of besideOf) {
			const crossing = drawn.crossings.find(
				(c) => (at(c.from) === store && at(c.to) === user) || (at(c.to) === store && at(c.from) === user),
			)
			items[store].besideUser = crossing.from === items[store].thing.id ? crossing.to : crossing.from
		}
		return placeRows(ordered, items, besideOf, edges, touches)
	}

	const layout = layoutPlace(null)
	const placed = { frames: [], things: [], notes: [] }
	// Absolute places, from the tree of relative ones.
	function settle(result, ox, oy, depth, holder) {
		for (const item of result.items) {
			const x = ox + item.x
			const y = oy + item.y
			if (item.kind === 'frame') {
				placed.frames.push({ id: item.frame.id, frame: item.frame, x, y, w: item.w, h: item.h, depth })
				settle(item.inner, x + (item.w - item.inner.w) / 2, y + PAD.top, depth + 1, item.frame.id)
				let ny = y + PAD.top + item.inner.h + NOTE.gap
				for (const note of item.notes) {
					placed.notes.push({ on: item.frame.id, text: note.gap.text, x: x + PAD.side, y: ny, w: note.w, h: note.h })
					ny += note.h + NOTE.gap
				}
			} else {
				const solo = solos.get(item.thing.frame) ?? null
				placed.things.push({
					id: item.thing.id,
					thing: item.thing,
					x,
					y,
					w: item.w,
					h: item.h,
					besideUser: item.besideUser,
					solo,
					holder,
				})
				let ny = y + item.h + NOTE.gap
				for (const note of item.notes) {
					placed.notes.push({
						on: item.thing.id,
						text: note.gap.text,
						x: x + (item.w - note.w) / 2,
						y: ny,
						w: note.w,
						h: note.h,
					})
					ny += note.h + NOTE.gap
				}
			}
		}
	}
	settle(layout, 0, 0, 0, null)
	alignBeside(placed)
	placeEdges(drawn, placed, layout, atEdge, gapsOn, sizeOfThing)

	// The drawing starts at (0, 0), with room around it for lines that go around the outside.
	const MARGIN = 40
	const all = [...placed.frames, ...placed.things, ...placed.notes]
	const minX = Math.min(...all.map((r) => r.x)) - MARGIN
	const minY = Math.min(...all.map((r) => r.y)) - MARGIN
	for (const r of all) {
		r.x -= minX
		r.y -= minY
	}
	const width = Math.max(...all.map((r) => r.x + r.w)) + MARGIN
	const height = Math.max(...all.map((r) => r.y + r.h)) + MARGIN

	markSeconds(placed.things, drawn.things)
	const { lines, lanes, marks } = linesOf(drawn, placed, busOf)
	return {
		width,
		height,
		frames: placed.frames,
		things: placed.things,
		notes: placed.notes,
		lines,
		lanes,
		marks,
		folds,
	}
}

// Where a frame's label stands: in its top left corner.
export function labelRect(placed) {
	const size = frameLabel(placed.frame)
	return { x: placed.x + 12, y: placed.y + 14, w: Math.min(size.w, placed.w - 24), h: size.h }
}

function frameLabel(frame) {
	const copies = frame.copies ? `  ${frame.copies.count} ${frame.copies.count === 1 ? 'copy' : 'copies'}` : ''
	return { w: 60 + (frame.name.length + copies.length) * 11.2, h: 42 }
}

// Ranks of rows: what calls stands above what it calls. A bus stands under what reaches it by calls, and what only
// meets through a bus stands under the bus. What has no line at all stands last.
function ranksOf(nodes, edges, touches, items) {
	const into = new Map(nodes.map((n) => [n, []]))
	const out = new Map(nodes.map((n) => [n, []]))
	for (const [a, b] of edges) {
		into.get(b)?.push(a)
		out.get(a)?.push(b)
	}
	const rank = new Map()
	const visiting = new Set()
	const depth = (n) => {
		if (rank.has(n)) return rank.get(n)
		visiting.add(n)
		let r = 0
		for (const p of into.get(n)) if (!visiting.has(p)) r = Math.max(r, depth(p) + 1)
		visiting.delete(n)
		rank.set(n, r)
		return r
	}
	const called = (n) => into.get(n).length + out.get(n).length > 0
	const buses = nodes.filter((n) => items[n].thing && hasLanes(items[n].thing))
	const onBus = new Set(buses.flatMap((bus) => [...touches.get(bus)]))
	for (const n of nodes) if (called(n) || !onBus.has(n)) depth(n)
	let last = Math.max(-1, ...[...rank.entries()].filter(([n]) => called(n)).map(([, r]) => r))
	for (const bus of buses) {
		const above = [...touches.get(bus)].filter((n) => rank.has(n) && called(n))
		const r = Math.max(rank.get(bus) && called(bus) ? rank.get(bus) : 0, ...above.map((n) => rank.get(n) + 1))
		rank.set(bus, r)
		for (const n of touches.get(bus))
			if (!called(n) && !buses.includes(n)) rank.set(n, Math.max(rank.get(n) ?? 0, r + 1))
		last = Math.max(last, r + 1)
	}
	for (const n of nodes) if (!called(n) && !onBus.has(n) && !buses.includes(n)) rank.set(n, last + 1)
	return rank
}

// A call that goes on from a row stays in that row while the row is short, so a chain of calls reads left to right
// as a request travels, and the drawing is wider than it is tall.
const MOST_CHAINED = 3
function chained(rows, edges, items) {
	const isBus = (n) => items[n].thing && hasLanes(items[n].thing)
	const out = []
	for (const row of rows) {
		const last = out.at(-1)
		const fed = (n) => {
			const callers = edges.filter(([, b]) => b === n).map(([a]) => a)
			return callers.length > 0 && callers.every((a) => last.includes(a))
		}
		if (last && last.length + row.length <= MOST_CHAINED && ![...last, ...row].some(isBus) && row.every(fed)) {
			// Each thing stands right after what calls it, and the row keeps that order.
			for (const n of row) {
				const caller = Math.max(...edges.filter(([, b]) => b === n).map(([a]) => last.indexOf(a)))
				last.splice(caller + 1, 0, n)
			}
			last.chain = true
		} else out.push([...row])
	}
	return out
}

// A thing with no line to anything here stands in the row of something the same outside thing calls, or else in the
// shortest row, rather than in a row of its own. Those that meet only through a bus outside stand together, last.
function joinLoose(rows, edges, touches, callers, toBus) {
	const linked = new Set(edges.flat())
	for (const [bus, set] of touches) {
		if (set.size > 0) linked.add(bus)
		for (const n of set) linked.add(n)
	}
	const loose = rows.flat().filter((n) => !linked.has(n))
	const kept = rows.map((row) => row.filter((n) => linked.has(n))).filter((row) => row.length > 0)
	const busRow = loose.filter((n) => toBus.has(n))
	if (busRow.length > 0) kept.push(busRow)
	for (const n of loose.filter((each) => !toBus.has(each))) {
		const shares = (m) => [...callers.get(n)].some((caller) => callers.get(m).has(caller))
		const room = kept.filter((row) => row.length < MOST_IN_ROW)
		const sibling = room.find((each) => each.some(shares))
		if (sibling) sibling.splice(sibling.findIndex(shares), 0, n)
		else {
			const row = room.sort((a, b) => a.length - b.length)[0]
			if (!row) kept.push([n])
			else if (row.chain) row.unshift(n)
			else row.push(n)
		}
	}
	return kept
}

// A row of more than four things goes on in a second row under it.
const MOST_IN_ROW = 4
// shortcut: a row wraps where it would grow wider than 1.6 times the side of a square holding all the frame holds,
// so a frame comes out wider than tall, like the screen. A finer packing would weigh where the lines go.
function wrapped(rows, items, besideOf) {
	const width = (n) =>
		items[n].w + [...besideOf].filter(([, user]) => user === n).reduce((sum, [s]) => sum + BESIDE + items[s].w, 0)
	const all = rows.flat()
	const area = all.reduce((sum, n) => sum + (width(n) + GAP.x) * (items[n].foot + GAP.y), 0)
	const most = Math.max(Math.sqrt(area) * 1.6, ...all.map(width))
	return rows.flatMap((row) => {
		const out = [[]]
		out[0].chain = row.chain
		let used = 0
		for (const n of row) {
			const w = width(n)
			if (out.at(-1).length > 0 && (used + GAP.x + w > most || out.at(-1).length >= MOST_IN_ROW)) {
				out.push([])
				out.at(-1).chain = row.chain
				used = 0
			}
			used += (out.at(-1).length > 0 ? GAP.x : 0) + w
			out.at(-1).push(n)
		}
		return out
	})
}

// The order of each row, so lines cross as little as they can: each thing moves toward the things it meets in the row
// above, then in the row below.
function orderRows(rows, edges, touches) {
	const near = new Map()
	const link = (a, b) => {
		if (!near.has(a)) near.set(a, new Set())
		if (!near.has(b)) near.set(b, new Set())
		near.get(a).add(b)
		near.get(b).add(a)
	}
	for (const [a, b] of edges) link(a, b)
	for (const [bus, set] of touches) for (const n of set) link(bus, n)
	const order = rows.map((row) => [...row])
	const placeIn = () => new Map(order.flatMap((row) => row.map((n, k) => [n, k / Math.max(row.length - 1, 1)])))
	const sweep = (r, from) => {
		// A row of a chain keeps its order: what calls stays left of what it calls.
		if (rows[r].chain) return
		const pos = placeIn()
		const weight = (n) => {
			const others = [...(near.get(n) ?? [])].filter((m) => order[from]?.includes(m))
			return others.length === 0 ? pos.get(n) : others.reduce((sum, m) => sum + pos.get(m), 0) / others.length
		}
		order[r] = order[r]
			.map((n) => ({ n, w: weight(n) }))
			.sort((a, b) => a.w - b.w)
			.map((each) => each.n)
	}
	for (let pass = 0; pass < 3; pass++) {
		for (let r = 1; r < order.length; r++) sweep(r, r - 1)
		for (let r = order.length - 2; r >= 0; r--) sweep(r, r + 1)
	}
	return order
}

// Each row stands under the one before, and each thing as near the middle of what it meets in the next row as there
// is room for. A bus takes the whole width.
function placeRows(rows, items, besideOf, edges, touches) {
	// Stores beside a frame stand in one column, each to be moved level with the thing in the frame that uses it.
	const group = (n) => {
		const beside = [...besideOf.entries()].filter(([, user]) => user === n).map(([store]) => store)
		const column = items[n].kind === 'frame'
		const more = column
			? beside.length > 0
				? BESIDE + Math.max(...beside.map((s) => items[s].w))
				: 0
			: beside.reduce((sum, s) => sum + BESIDE + items[s].w, 0)
		return { n, beside, w: items[n].w + more, column, more }
	}
	const isBus = (n) => items[n].thing && hasLanes(items[n].thing)
	const rowsOf = rows.map((row) => row.map(group))
	const natural = (row) => row.reduce((sum, g) => sum + (isBus(g.n) ? BUS.least : g.w), 0) + GAP.x * (row.length - 1)
	const width = Math.max(...rowsOf.map(natural))
	const near = new Map()
	for (const [a, b] of edges) {
		;(near.get(a) ?? near.set(a, []).get(a)).push(b)
		;(near.get(b) ?? near.set(b, []).get(b)).push(a)
	}
	for (const [bus, set] of touches) for (const n of set) (near.get(n) ?? near.set(n, []).get(n)).push(bus)
	const centre = new Map()
	// Centred first, then each row is pulled toward its neighbours in the row above, then in the row below.
	// A store stands on the outer side of its row: on the left of the first thing in a row of several.
	const own = (g) => (g.left ? g.more : 0)
	for (const row of rowsOf) for (const [k, g] of row.entries()) g.left = k === 0 && row.length > 1
	for (const row of rowsOf) {
		let x = (width - natural(row)) / 2
		for (const g of row) {
			g.x = x
			centre.set(g.n, x + own(g) + items[g.n].w / 2)
			x += (isBus(g.n) ? BUS.least : g.w) + GAP.x
		}
	}
	const pull = (row, other) => {
		if (row.some((g) => isBus(g.n))) return
		const want = row.map((g) => {
			const ns = (near.get(g.n) ?? []).filter((m) => other.some((o) => o.n === m) && !isBus(m))
			return ns.length === 0
				? g.x
				: ns.reduce((sum, m) => sum + centre.get(m), 0) / ns.length - items[g.n].w / 2 - own(g)
		})
		let floor = 0
		row.forEach((g, k) => {
			g.x = Math.max(want[k], floor)
			floor = g.x + g.w + GAP.x
		})
		let ceiling = width
		for (let k = row.length - 1; k >= 0; k--) {
			const g = row[k]
			g.x = Math.min(g.x, ceiling - g.w)
			ceiling = g.x - GAP.x
		}
		for (const g of row) centre.set(g.n, g.x + own(g) + items[g.n].w / 2)
	}
	for (let r = 1; r < rowsOf.length; r++) pull(rowsOf[r], rowsOf[r - 1])
	for (let r = rowsOf.length - 2; r >= 0; r--) pull(rowsOf[r], rowsOf[r + 1])

	let y = 0
	for (const row of rowsOf) {
		const tall = Math.max(
			...row.map((g) =>
				Math.max(
					items[g.n].foot,
					g.column
						? g.beside.reduce((sum, s) => sum + items[s].foot + GAP.y / 2, -GAP.y / 2)
						: Math.max(0, ...g.beside.map((s) => items[s].foot)),
				),
			),
		)
		for (const g of row) {
			const item = items[g.n]
			if (isBus(g.n)) {
				item.w = width
				item.x = 0
			} else item.x = g.x + own(g)
			item.y = y + (tall - item.foot) / 2
			let along = g.left ? item.x - BESIDE : item.x + item.w + BESIDE
			let down = item.y
			for (const s of g.beside) {
				const store = items[s]
				if (g.column) {
					store.x = g.left ? item.x - BESIDE - store.w : item.x + item.w + BESIDE
					store.y = down
					down += store.foot + GAP.y / 2
				} else {
					store.x = g.left ? along - store.w : along
					store.y = item.y + (item.h - store.h) / 2
					along = g.left ? store.x - BESIDE : along + store.w + BESIDE
				}
			}
		}
		y += tall + GAP.y
	}
	return { w: width, h: y - GAP.y, items }
}

// A store beside the thing that uses it stands level with that thing when it has room there: the thing may sit
// deeper, in a frame of its own.
function alignBeside(placed) {
	const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
	const holds = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h
	for (const store of placed.things) {
		if (!store.besideUser) continue
		const user = placed.things.find((thing) => thing.id === store.besideUser)
		if (!user) continue
		const dy = user.y + user.h / 2 - (store.y + store.h / 2)
		if (Math.abs(dy) < 1) continue
		const notes = placed.notes.filter((note) => note.on === store.id)
		const moved = [store, ...notes].map((r) => ({ ...r, y: r.y + dy }))
		const others = [...placed.things, ...placed.notes].filter((r) => r !== store && !notes.includes(r))
		const clear = moved.every((r) => others.every((o) => !meets(r, o)))
		const sameFrames = moved.every((r, k) =>
			placed.frames.every((f) => {
				const before = [store, ...notes][k]
				return holds(f, before) ? holds(f, r) : !meets(f, r)
			}),
		)
		if (!clear || !sameFrames) continue
		store.y += dy
		for (const note of notes) note.y += dy
	}
}

// Outside things stand at the side of the drawing nearest the thing they cross with, in the order of those things.
function placeEdges(drawn, placed, layout, atEdge, gapsOn, sizeOfThing) {
	const core = { x: 0, y: 0, w: layout.w, h: layout.h }
	const rectOf = (id) => placed.things.find((thing) => thing.id === id)
	const sides = { top: [], bottom: [], left: [], right: [] }
	for (const thing of drawn.things.filter(atEdge)) {
		const anchors = drawn.crossings
			.flatMap((c) => (c.from === thing.id ? [c.to] : c.to === thing.id ? [c.from] : []))
			.map(rectOf)
			.filter(Boolean)
		const size = sizeOfThing(thing)
		if (anchors.length === 0) {
			sides.bottom.push({ thing, size, along: core.w / 2 })
			continue
		}
		const a = anchors[0]
		const room = {
			top: a.y - core.y,
			bottom: core.y + core.h - (a.y + a.h),
			left: a.x - core.x,
			right: core.x + core.w - (a.x + a.w),
		}
		const side = Object.keys(room).reduce((best, s) => (room[s] < room[best] - 1 ? s : best), 'top')
		const along = side === 'top' || side === 'bottom' ? a.x + a.w / 2 : a.y + a.h / 2
		sides[side].push({ thing, size, along })
	}
	for (const [side, list] of Object.entries(sides)) {
		const across = side === 'top' || side === 'bottom'
		list.sort((p, q) => p.along - q.along)
		let floor = Number.NEGATIVE_INFINITY
		for (const each of list) {
			const notes = gapsOn(each.thing.id).map((gap) => ({
				gap,
				...noteSize(gap.text, Math.max(each.size.w, NOTE.width)),
			}))
			const extent = across
				? Math.max(each.size.w, ...notes.map((n) => n.w))
				: each.size.h + notes.reduce((s, n) => s + n.h + NOTE.gap, 0)
			const start = Math.max(each.along - extent / 2, floor)
			floor = start + extent + (across ? GAP.x / 2 : GAP.y / 2)
			const notesH = notes.reduce((s, n) => s + n.h + NOTE.gap, 0)
			const x = across
				? start + (extent - each.size.w) / 2
				: side === 'left'
					? core.x - EDGE - each.size.w
					: core.x + core.w + EDGE
			const y = across ? (side === 'top' ? core.y - EDGE - each.size.h - notesH : core.y + core.h + EDGE) : start
			placed.things.push({ id: each.thing.id, thing: each.thing, x, y, w: each.size.w, h: each.size.h })
			let ny = y + each.size.h + NOTE.gap
			for (const note of notes) {
				placed.notes.push({
					on: each.thing.id,
					text: note.gap.text,
					x: x + (each.size.w - note.w) / 2,
					y: ny,
					w: note.w,
					h: note.h,
				})
				ny += note.h + NOTE.gap
			}
		}
	}
}

// A part in two frames is drawn twice: the first place is its own, each other one is dashed and tied to the first.
function markSeconds(things, order) {
	const first = new Map()
	const at = (placed) => order.findIndex((thing) => thing.id === placed.id)
	for (const placed of things.toSorted((a, b) => at(a) - at(b))) {
		if (placed.thing.kind !== 'part') continue
		if (first.has(placed.thing.part)) placed.second = first.get(placed.thing.part)
		else first.set(placed.thing.part, placed.id)
	}
}

// The lines: a call is one line with its protocol; an event goes to or from its lane on the bus, or straight between
// its two things when no bus carries it; a tie joins the places of a part drawn twice.
function linesOf(drawn, placed, busOf) {
	const rectOf = new Map(placed.things.map((thing) => [thing.id, thing]))
	const blocks = [...placed.things, ...placed.notes, ...placed.frames.map(labelRect)]
	const frames = placed.frames.map(({ x, y, w, h }) => ({ x, y, w, h }))
	const asks = []
	const meta = []
	const lanes = []
	const marks = []
	// Lanes of each bus, top to bottom in the order of its topics.
	for (const bus of placed.things.filter((thing) => hasLanes(thing.thing))) {
		for (const [k, topic] of bus.thing.topics.entries()) {
			lanes.push({ bus: bus.id, topic, y: bus.y + BUS.head + k * BUS.lane + BUS.lane / 2 })
		}
	}
	// Each thing that meets a bus has one stem into it, with a dot on each lane it publishes to and a ring on each lane
	// it picks up from.
	const stems = new Map()
	for (const crossing of drawn.crossings) {
		const bus = busOf(crossing)
		if (!bus) continue
		const busRect = rectOf.get(bus.id)
		for (const [end, kind] of [
			[crossing.from, 'pub'],
			[crossing.to, 'sub'],
		]) {
			if (end === bus.id || !rectOf.has(end) || !busRect) continue
			const key = `${end}>${bus.id}`
			if (!stems.has(key)) stems.set(key, { thing: end, bus: bus.id, topics: new Map() })
			const topic = crossing.topic
			const have = stems.get(key).topics.get(topic)
			stems.get(key).topics.set(topic, {
				kind: have && have.kind !== kind ? 'both' : kind,
				crossing: have?.crossing ?? crossing.id,
			})
		}
	}
	const byBus = new Map()
	for (const stem of stems.values()) {
		const busRect = rectOf.get(stem.bus)
		const thing = rectOf.get(stem.thing)
		stem.side = thing.y + thing.h / 2 < busRect.y + busRect.h / 2 ? 'top' : 'bottom'
		stem.x = Math.min(Math.max(thing.x + thing.w / 2, busRect.x + 24), busRect.x + busRect.w - 24)
		;(byBus.get(stem.bus) ?? byBus.set(stem.bus, []).get(stem.bus)).push(stem)
	}
	// Two stems never share a place on the bus.
	for (const [busId, list] of byBus) {
		const busRect = rectOf.get(busId)
		list.sort((p, q) => p.x - q.x)
		for (let k = 1; k < list.length; k++) list[k].x = Math.max(list[k].x, list[k - 1].x + 30)
		const over = list.at(-1).x - (busRect.x + busRect.w - 24)
		if (over > 0) for (const stem of list) stem.x -= over
	}
	// The names of the topics stand in the widest room between stems.
	for (const [busId, list] of byBus) {
		const busRect = rectOf.get(busId)
		const xs = [busRect.x + 12, ...list.map((stem) => stem.x), busRect.x + busRect.w - 12]
		let best = 0
		for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > xs[best + 1] - xs[best]) best = k - 1
		for (const lane of lanes) if (lane.bus === busId) lane.x = (xs[best] + xs[best + 1]) / 2
	}
	for (const lane of lanes) {
		const bus = rectOf.get(lane.bus)
		lane.x ??= bus.x + bus.w / 2
	}
	for (const stem of stems.values()) {
		const busRect = rectOf.get(stem.bus)
		const kinds = [...stem.topics.values()].map((t) => t.kind)
		asks.push({
			from: { rect: rectOf.get(stem.thing) },
			to: { rect: busRect, side: stem.side, at: (stem.x - busRect.x) / busRect.w },
			label: null,
		})
		meta.push({
			kind: 'stem',
			id: `stem:${stem.thing}:${stem.bus}`,
			thing: stem.thing,
			bus: stem.bus,
			into: kinds.some((k) => k !== 'sub'),
			outOf: kinds.some((k) => k !== 'pub'),
			crossings: [...stem.topics.values()].map((t) => t.crossing),
		})
		const ys = []
		for (const [topic, mark] of stem.topics) {
			const lane = lanes.find((each) => each.bus === stem.bus && each.topic === topic)
			if (!lane) continue
			ys.push(lane.y)
			marks.push({
				bus: stem.bus,
				thing: stem.thing,
				topic,
				kind: mark.kind,
				crossing: mark.crossing,
				x: stem.x,
				y: lane.y,
			})
		}
		const edge = stem.side === 'top' ? busRect.y : busRect.y + busRect.h
		const far = stem.side === 'top' ? Math.max(...ys) : Math.min(...ys)
		stem.inside = { x: stem.x, y1: edge, y2: Number.isFinite(far) ? far : edge }
		meta.at(-1).inside = stem.inside
	}
	// Crossings between the same two things with the same words are one line, with an arrow at each end they reach.
	const joined = new Map()
	for (const crossing of drawn.crossings) {
		if (busOf(crossing)) continue
		if (!rectOf.has(crossing.from) || !rectOf.has(crossing.to)) continue
		const text = crossing.kind === 'call' ? howLabel(crossing) : crossing.topic
		const key = `${[crossing.from, crossing.to].sort().join('>')}:${crossing.kind}:${text}`
		const same = joined.get(key)
		if (same) {
			same.crossings.push(crossing.id)
			if (same.crossing.from !== crossing.from) same.both = true
			continue
		}
		const label = labelOf(text)
		asks.push({ from: { rect: rectOf.get(crossing.from) }, to: { rect: rectOf.get(crossing.to) }, label })
		const line = {
			kind: crossing.kind,
			id: crossing.id,
			crossing,
			crossings: [crossing.id],
			both: false,
			text,
			words: label.lines,
		}
		joined.set(key, line)
		meta.push(line)
	}
	// A tie joins two places of a part only where one frame holds the other, as a worker thread inside its process.
	// Other places are each marked "also runs here" instead, so ties never wind across the drawing.
	const parentOf = new Map(placed.frames.map((f) => [f.id, f.frame.in]))
	const chain = (frame) => {
		const out = []
		for (let at = frame; at; at = parentOf.get(at)) out.push(at)
		return out
	}
	const near = (a, b) => {
		if (a.holder === b.holder) return false
		const [ca, cb] = [chain(a.holder), chain(b.holder)]
		if (a.holder && cb.includes(a.holder)) return true
		return Boolean(b.holder && ca.includes(b.holder))
	}
	for (const thing of placed.things) {
		if (!thing.second || !near(thing, rectOf.get(thing.second))) continue
		asks.push({ from: { rect: rectOf.get(thing.second) }, to: { rect: thing }, label: null })
		meta.push({ kind: 'tie', id: `tie:${thing.id}`, from: thing.second, to: thing.id })
	}
	const routes = routeLines(blocks, frames, asks)
	const lines = routes.map((route, i) => ({ ...meta[i], points: route.points, label: route.label, rings: route.rings }))
	return { lines, lanes, marks }
}
