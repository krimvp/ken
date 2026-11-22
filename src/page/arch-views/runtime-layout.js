// Where the frames, things and lines of "Where it runs" stand, placed by code, compact enough to read whole. Frames
// are a tree laid out inside out: a frame's size comes from what is in it, and a frame with nothing in it is not
// drawn. Inside a frame the things stand in rows: what calls stands above what it calls, a bus has its own row, and
// things that only meet through the bus stand under it. A store that one thing uses alone stands beside it. A thing
// outside a frame that only meets things inside it (a store, an outside system, a bus) stands just outside that
// frame's edge, level with the thing it meets, so its line is short and straight. Lines go around blocks at right
// angles (route.js), and only a line that crosses a frame's edge carries a label. A frame that holds more than eight
// things folds those that share a name prefix or a store into one block with a count, until the reader zooms in.
import { routeLines } from './route.js'

// The sizes of the blocks of "In its world", which shares them.
export const SIZE = {
	part: { w: 252, h: 124 },
	store: { w: 212, h: 124 },
	outside: { w: 252, h: 100 },
	person: { w: 200, h: 148 },
	fold: { w: 252, h: 132 },
}
// The blocks of "Where it runs". A part drawn a second time is small.
const BLOCK = {
	part: { w: 272, h: 112 },
	second: { w: 220, h: 72 },
	store: { w: 212, h: 108 },
	outside: { w: 260, h: 96 },
	person: { w: 180, h: 136 },
	fold: { w: 272, h: 124 },
}
const GAP = { x: 80, y: 64 }
const BESIDE = 112
const PAD = { side: 24, top: 54, bottom: 24 }
// How far a thing outside a frame stands from its edge: room for a label and a ring on the line between. A bus
// stands nearer, as its lines carry no label.
const SAT = { x: 112, y: 84, bus: 36, stack: 56 }
const BUS = { head: 38, lane: 24, foot: 8, least: 560 }
const MARGIN = 8
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
// An event names its bus at an end, or belongs to the only bus with its topic. When two buses carry the same
// topic, a direct event between parts gives no evidence for choosing one.
export function eventBus(things, crossing) {
	if (crossing.kind !== 'event') return null
	const buses = things.filter(hasLanes)
	const end = buses.find((bus) => bus.id === crossing.from || bus.id === crossing.to)
	if (end) return end
	const matches = buses.filter((bus) => bus.topics.includes(crossing.topic))
	return matches.length === 1 ? matches[0] : null
}

const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

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

// Crossings with their ends moved to the things drawn for them. Two crossings that now go the same way are one, and
// one that now starts and ends on the same thing is not drawn.
function movedCrossings(crossings, to) {
	const seen = new Set()
	const out = []
	for (const crossing of crossings) {
		const moved = { ...crossing, from: to(crossing.from), to: to(crossing.to) }
		if (moved.from === moved.to) continue
		const key = `${moved.from}>${moved.to}:${moved.kind}:${moved.kind === 'call' ? moved.how : moved.topic}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(moved)
	}
	return out
}

// What is drawn of the drawing the server sent: each fold stands in for its members; a part that is also drawn in a
// frame is not drawn again outside every frame; a frame with nothing in it, at any depth, is not drawn.
function drawnOf(runtime, folds) {
	const into = new Map(folds.flatMap((fold) => fold.members.map((member) => [member, fold.id])))
	const framed = new Map()
	for (const thing of runtime.things) {
		if (thing.kind === 'part' && thing.frame && !framed.has(thing.part)) framed.set(thing.part, thing.id)
	}
	for (const thing of runtime.things) {
		if (thing.kind === 'part' && !thing.frame && framed.has(thing.part)) into.set(thing.id, framed.get(thing.part))
	}
	const things = [
		...runtime.things.filter((thing) => !into.has(thing.id)),
		...folds.map((fold) => ({ id: fold.id, kind: 'fold', name: fold.name, frame: fold.frame, members: fold.members })),
	]
	const parentOf = new Map(runtime.frames.map((frame) => [frame.id, frame.in]))
	const full = new Set()
	for (const thing of things) {
		for (let at = thing.frame; at && parentOf.has(at) && !full.has(at); at = parentOf.get(at)) full.add(at)
	}
	return {
		...runtime,
		frames: runtime.frames.filter((frame) => full.has(frame.id)),
		things: things.map((thing) => (thing.frame && !full.has(thing.frame) ? { ...thing, frame: null } : thing)),
		crossings: movedCrossings(runtime.crossings, (id) => into.get(id) ?? id),
	}
}

// views is the two drawings as the server sends them: "Where it runs" is laid out, and "In its world" says which
// outside things are people. folded says whether a crowded frame folds. The answer is in the canvas's own units, from
// (0, 0): { width, height, frames, things, lines, lanes, marks, folds }.
export function runtimeLayout(views, { folded = false, narrow = false } = {}) {
	const room = narrow ? PHONE : SCREEN
	const fits = (one) => Math.min(room.w / one.width, room.h / one.height)
	const ways = [false, true].flatMap((framesShareRows) =>
		(narrow ? [0] : WRAPS).map((wrap) => placedOf(views, folded, { framesShareRows, wrap, narrow })),
	)
	const best = Math.max(...ways.map(fits))
	// Of the ways that fit about as well as the best, the shortest: it reads more as a flow from left to right.
	const chosen = ways.filter((one) => fits(one) >= best * 0.97).sort((p, q) => p.height - q.height)[0]
	const { lines, lanes, marks } = linesOf(chosen.drawn, chosen.placed, chosen.busOf)
	const { placed, folds } = chosen
	// A line that goes around the outside runs beyond the blocks: the drawing grows to hold it.
	const spots = lines.flatMap((line) => [...line.points, ...(line.label ? [line.label, corner(line.label)] : [])])
	const [left, top] = ['x', 'y'].map((at) => Math.min(0, ...spots.map((p) => p[at] - MARGIN)))
	const width = Math.max(chosen.width, ...spots.map((p) => p.x + MARGIN)) - left
	const height = Math.max(chosen.height, ...spots.map((p) => p.y + MARGIN)) - top
	const move = (p) => {
		p.x -= left
		p.y -= top
	}
	for (const r of [...placed.frames, ...placed.things, ...lanes, ...marks]) move(r)
	for (const line of lines) {
		for (const p of [...line.points, ...line.rings, ...(line.label ? [line.label] : [])]) move(p)
		if (line.inside) line.inside = { x: line.inside.x - left, y1: line.inside.y1 - top, y2: line.inside.y2 - top }
	}
	return { width, height, frames: placed.frames, things: placed.things, lines, lanes, marks, folds }
}

const corner = (r) => ({ x: r.x + r.w, y: r.y + r.h })

// The room a drawing has on a laptop's screen between the bars that float over the canvas, in its own units at 100%:
// what decides between ways to lay it out.
const SCREEN = { w: 1288, h: 590 }
// A phone's: the reader pans down, so only its width counts.
const PHONE = { w: 362, h: Number.POSITIVE_INFINITY }
// How wide a row may grow before it wraps, against the side of a square that would hold all a frame holds. On a
// phone each thing has a row of its own.
const WRAPS = [1.6, 2.4]

// The places of the frames and things, one way. framesShareRows says whether frames may stand side by side in a
// chain of calls, wrap how wide a row may grow, and narrow whether the drawing stands in one column, for a phone.
function placedOf(views, folded, { framesShareRows, wrap, narrow }) {
	const people = new Set((views.world?.outside ?? []).filter((each) => each.kind === 'person').map((each) => each.id))
	const folds = foldsOf(views.runtime, folded)
	const drawn = drawnOf(views.runtime, folds)
	const thingOf = new Map(drawn.things.map((thing) => [thing.id, thing]))
	// A container, process or function that holds one part and nothing else is drawn as that part, named after the
	// container, with its copies on it: "payments, 2 copies". A browser, a machine, a cluster or a sandbox stays a frame.
	const solos = new Map()
	for (const frame of drawn.frames.filter((each) => SOLO_KINDS.includes(each.kind))) {
		const things = drawn.things.filter((thing) => thing.frame === frame.id)
		const frames = drawn.frames.filter((other) => other.in === frame.id)
		if (things.length === 1 && frames.length === 0 && things[0].kind === 'part') solos.set(frame.id, frame)
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
	// A part drawn again in another frame is small and dashed there. A container that holds it alone is its own box.
	const seconds = new Map()
	const firsts = new Map()
	for (const thing of drawn.things) {
		if (thing.kind !== 'part') continue
		if (!firsts.has(thing.part)) firsts.set(thing.part, thing.id)
		else if (!solos.has(thing.frame)) seconds.set(thing.id, firsts.get(thing.part))
	}

	const busOf = (crossing) => eventBus(drawn.things, crossing)
	// The things a thing meets: the other end of each of its lines, and for a bus every thing on it.
	const metOf = (thing) =>
		drawn.crossings.flatMap((c) => {
			if (hasLanes(thing) && busOf(c) === thing) return [c.from, c.to].filter((id) => id !== thing.id)
			if (busOf(c)) return []
			return c.from === thing.id ? [c.to] : c.to === thing.id ? [c.from] : []
		})

	// A thing or a frame that stands outside a frame's edge, by the key of that frame.
	const satelliteOf = new Map()
	// The child of a frame (or of the top, null) that holds a thing: the thing, or the frame under it that holds it.
	function childOf(place, thingId) {
		const thing = thingOf.get(thingId)
		if (!thing) return undefined
		let at = placeOf(thing)
		if (at === place) return satelliteOf.get(thingId) ?? thingId
		while (at !== null) {
			const up = parentOf(at)
			if (up === place) return satelliteOf.get(`frame:${at}`) ?? `frame:${at}`
			at = up
		}
		return undefined
	}
	const within = (frameId, thingId) => {
		for (let at = placeOf(thingOf.get(thingId)); at !== null; at = parentOf(at)) if (at === frameId) return true
		return false
	}
	// What a frame meets: the far end of each line with one end in it, and the bus of each event it sends or takes.
	const metOfFrame = (frameId) =>
		drawn.crossings.flatMap((c) => {
			const ends = [c.from, c.to].filter((id) => !within(frameId, id))
			if (ends.length === 2) return []
			const bus = busOf(c)
			return bus && !within(frameId, bus.id) ? [bus.id] : ends
		})
	const sizeOfFrame = (frameId) => drawn.things.filter((thing) => within(frameId, thing.id)).length

	function sizeOfThing(thing) {
		if (hasLanes(thing)) return { w: BUS.least, h: BUS.head + thing.topics.length * BUS.lane + BUS.foot }
		if (thing.kind === 'outside') return BLOCK[people.has(thing.id) ? 'person' : 'outside']
		if (seconds.has(thing.id)) return BLOCK.second
		return BLOCK[thing.kind]
	}

	// Lays out what one frame holds, at (0, 0). Answers { w, h, items } with each item at its place. A thing or a
	// smaller frame that only meets things inside one frame here stands at that frame's edge, as one of its pieces.
	function layoutPlace(place) {
		const frames = [...frameOf.values()].filter((frame) => parentOf(frame.id) === place)
		const own = drawn.things.filter((thing) => placeOf(thing) === place)
		const pieces = new Map(frames.map((frame) => [`frame:${frame.id}`, []]))
		const hostOf = (met) => {
			const holders = new Set(met.map((id) => childOf(place, id)))
			const [holder] = holders
			return met.length > 0 && holders.size === 1 && pieces.has(holder) ? holder : null
		}
		for (const thing of own) {
			// A part in a frame stands in that frame's rows. Only one in no frame at all stands at a frame's edge.
			if ((thing.kind === 'part' || thing.kind === 'fold') && place !== null) continue
			const met = metOf(thing)
			const host = hostOf(met)
			if (!host) continue
			satelliteOf.set(thing.id, host)
			const calls = drawn.crossings.some((c) => c.to === thing.id)
			pieces.get(host).push({ key: thing.id, thing, size: sizeOfThing(thing), met, kind: kindOf(thing, calls) })
		}
		const items = new Map(frames.map((frame) => [frame.id, frameItem(frame)]))
		for (const frame of frames) {
			const key = `frame:${frame.id}`
			const met = metOfFrame(frame.id)
			const host = hostOf(met)
			if (!host || host === key || pieces.get(key).length > 0 || satelliteOf.has(host)) continue
			if (sizeOfFrame(frame.id) >= sizeOfFrame(host.slice('frame:'.length))) continue
			satelliteOf.set(key, host)
			const item = items.get(frame.id)
			const calls = drawn.crossings.some((c) => within(frame.id, c.to) && !within(frame.id, c.from))
			pieces.get(host).push({ key, item, size: item, met, kind: calls ? 'callee' : 'caller' })
		}
		const placed = frames
			.filter((frame) => !satelliteOf.has(`frame:${frame.id}`))
			.map((frame) => withSatellites(items.get(frame.id), pieces.get(`frame:${frame.id}`)))
		for (const thing of own) {
			if (satelliteOf.has(thing.id)) continue
			const size = sizeOfThing(thing)
			placed.push({ key: thing.id, kind: 'thing', thing, w: size.w, h: size.h })
		}
		return arrange(place, placed)
	}

	function frameItem(frame) {
		const inner = layoutPlace(frame.id)
		const w = Math.max(inner.w + 2 * PAD.side, frameLabel(frame).w + 2 * 16)
		const h = PAD.top + inner.h + PAD.bottom
		return { key: `frame:${frame.id}`, kind: 'frame', frame, w, h, fw: w, fh: h, fx: 0, fy: 0, inner, sats: [] }
	}

	// The things outside a frame that only meet things inside it stand just outside its edge, on the side nearest the
	// thing they meet, where the line to it passes no other block: a bus along the top or the bottom, the rest level
	// with what they meet.
	function withSatellites(item, list) {
		if (list.length === 0) return item
		const rects = new Map()
		const blocks = []
		walk({ items: [{ ...item, x: 0, y: 0 }] }, 0, 0, 0, null, (r) => {
			if (r.thing) rects.set(r.thing.id, r)
			if (r.frame?.id !== item.frame.id) blocks.push(r)
		})
		const box = { x: 0, y: 0, w: item.w, h: item.h }
		const reach = {
			top: (u) => ({ x: u.x, y: 0, w: u.w, h: u.y }),
			bottom: (u) => ({ x: u.x, y: u.y + u.h, w: u.w, h: box.h - u.y - u.h }),
			left: (u) => ({ x: 0, y: u.y, w: u.x, h: u.h }),
			right: (u) => ({ x: u.x + u.w, y: u.y, w: box.w - u.x - u.w, h: u.h }),
		}
		const sides = { top: [], right: [], bottom: [], left: [] }
		const busSide = new Set()
		// Where a column of things may start beyond the bus on its side, on a phone.
		const busAt = new Map()
		const sats = []
		// A bus first, then frames, then things: a frame takes the place level with what it meets before a store does.
		const first = (piece) => (hasLanes(piece.thing) ? 0 : piece.item ? 1 : 2)
		for (const piece of list.toSorted((a, b) => first(a) - first(b))) {
			const { size } = piece
			const users = piece.met.map((id) => rects.get(id)).filter(Boolean)
			if (hasLanes(piece.thing)) {
				const low = users.filter((u) => u.y + u.h / 2 > box.h / 2).length
				const side = low * 2 >= users.length ? 'bottom' : 'top'
				busSide.add(side)
				// The bus reaches far enough out that its longest topic has room beside the lines that come to it.
				const centres = users.map((u) => u.x + u.w / 2).sort((p, q) => p - q)
				const topic = Math.max(...piece.thing.topics.map((t) => t.length)) * TOPIC_CHAR + 2 * CLEAR_TOPIC
				const left = Math.min(0, (centres[0] ?? 0) - topic)
				const w = Math.max(narrow ? 0 : size.w, box.w - left)
				const y = side === 'bottom' ? box.h + SAT.bus : -SAT.bus - size.h
				sats.push({ thing: piece.thing, x: left, y, w, h: size.h })
				busAt.set(side, side === 'bottom' ? y + size.h + SAT.stack : y - SAT.stack)
				continue
			}
			const u = users[0] ?? { x: box.w / 2, y: box.h / 2, w: 0, h: 0 }
			const cost = (side) => {
				const way = reach[side](u)
				const open = !blocks.some((b) => b !== u && !holdsRect(b, u) && meets(way, b))
				const far = side === 'top' || side === 'bottom' ? way.h : way.w
				const taken = busSide.has(side) ? 6000 : 0
				// On a phone nothing stands beside a frame: what calls it stands above, the rest below.
				if (narrow) {
					const beside = side === 'left' || side === 'right' ? 6000 : 0
					return beside + ((side === 'top') === (piece.kind === 'caller') ? 0 : 500)
				}
				return far + (open ? 0 : 300) + taken + PREFER[piece.kind][side]
			}
			const side = Object.keys(sides).reduce((best, s) => (cost(s) < cost(best) ? s : best))
			const along = side === 'top' || side === 'bottom' ? u.x + u.w / 2 : u.y + u.h / 2
			sides[side].push({ piece, size, along })
		}
		for (const [side, list] of Object.entries(sides)) {
			const across = side === 'top' || side === 'bottom'
			let floor = Number.NEGATIVE_INFINITY
			// On a phone the things above or below a frame stand one under the other, the nearest to the frame first.
			let out = busAt.get(side) ?? (side === 'top' ? -SAT.y : box.h + SAT.y)
			for (const each of list.toSorted((p, q) => p.along - q.along || first(p.piece) - first(q.piece))) {
				const { w, h } = each.size
				let [x, y] = [0, 0]
				if (narrow && across) {
					x = each.along - w / 2
					y = side === 'top' ? out - h : out
					out = side === 'top' ? y - SAT.stack : y + h + SAT.stack
				} else {
					const start = Math.max(each.along - (across ? w : h) / 2, floor)
					floor = start + (across ? w : h) + SAT.stack
					x = across ? start : side === 'left' ? -SAT.x - w : box.w + SAT.x
					y = across ? (side === 'top' ? -SAT.y - h : box.h + SAT.y) : start
				}
				sats.push({ thing: each.piece.thing, item: each.piece.item, x, y, w, h })
			}
		}
		const all = [box, ...sats]
		const minX = Math.min(...all.map((r) => r.x))
		const minY = Math.min(...all.map((r) => r.y))
		for (const s of sats) {
			s.x -= minX
			s.y -= minY
		}
		return {
			...item,
			fx: -minX,
			fy: -minY,
			w: Math.max(...all.map((r) => r.x + r.w)) - minX,
			h: Math.max(...all.map((r) => r.y + r.h)) - minY,
			sats,
		}
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
			// Two things that send each other events are peers: they stand in one row, in the order they are listed.
			if (crossing.kind === 'event' && calls.has(`${b}>${a}`)) continue
			calls.add(`${a}>${b}`)
		}
		// A store that one thing here uses alone, and that nothing else here touches, stands beside it.
		const besideOf = new Map()
		items.forEach((item, i) => {
			if (item.thing?.kind !== 'store' || hasLanes(item.thing)) return
			const [only, more] = [...users.get(i)]
			if (narrow || only === undefined || more !== undefined || items[only].thing?.kind === 'store') return
			besideOf.set(i, only)
		})
		const edges = [...calls]
			.map((pair) => pair.split('>').map(Number))
			.filter(([a, b]) => !besideOf.has(a) && !besideOf.has(b))
		const rest = items.map((_, i) => i).filter((i) => !besideOf.has(i))
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
		const grouped = rowsOfGroups(rest, edges, touches, items, framesShareRows)
		const rows = joinLoose(grouped, edges, touches, callers, toBus)
		const ordered = wrapped(orderRows(rows, edges, touches), items, besideOf, wrap)
		for (const [store, user] of besideOf) {
			const crossing = drawn.crossings.find(
				(c) => (at(c.from) === store && at(c.to) === user) || (at(c.to) === store && at(c.from) === user),
			)
			items[store].besideUser = crossing.from === items[store].thing.id ? crossing.to : crossing.from
		}
		// Two things side by side with a labelled line between them, as a thing and a frame, keep room for the label.
		const words = new Map()
		for (const c of drawn.crossings) {
			const [a, b] = [at(c.from), at(c.to)]
			if (busOf(c) || a === undefined || b === undefined || a === b) continue
			if (items[a].kind !== 'frame' && items[b].kind !== 'frame') continue
			const pair = `${Math.min(a, b)},${Math.max(a, b)}`
			const text = c.kind === 'call' ? howLabel(c) : c.topic
			words.set(pair, [...new Set([...(words.get(pair) ?? []), text])])
		}
		const gapOf = (a, b) => {
			const said = words.get(`${Math.min(a, b)},${Math.max(a, b)}`)
			return said ? Math.max(GAP.x, labelOf(said.join(', ')).w + 2 * CLEAR_LABEL) : GAP.x
		}
		return placeRows(ordered, items, besideOf, edges, touches, gapOf)
	}

	const layout = layoutPlace(null)
	const placed = { frames: [], things: [] }
	walk(layout, 0, 0, 0, null, (r) => {
		if (r.frame) placed.frames.push({ id: r.frame.id, frame: r.frame, x: r.x, y: r.y, w: r.w, h: r.h, depth: r.depth })
		else {
			placed.things.push({
				id: r.thing.id,
				thing: r.thing,
				x: r.x,
				y: r.y,
				w: r.w,
				h: r.h,
				besideUser: r.besideUser,
				solo: solos.get(r.thing.frame) ?? null,
				second: seconds.get(r.thing.id),
				holder: r.holder,
			})
		}
	})
	alignBeside(placed)

	// The drawing starts at (0, 0), with room around it for lines that go around the outside.
	const all = [...placed.frames, ...placed.things]
	const minX = Math.min(...all.map((r) => r.x)) - MARGIN
	const minY = Math.min(...all.map((r) => r.y)) - MARGIN
	for (const r of all) {
		r.x -= minX
		r.y -= minY
	}
	const width = Math.max(...all.map((r) => r.x + r.w)) + MARGIN
	const height = Math.max(...all.map((r) => r.y + r.h)) + MARGIN

	return { width, height, placed, drawn, busOf, folds }
}

// Which way a thing outside a frame would rather stand: a store on the right, an outside system on top or below, and
// what calls into the frame on its left or on top. A store goes around a block before it goes above or below, as
// the screen has more room across than down.
const PREFER = {
	store: { right: 0, left: 60, bottom: 700, top: 700 },
	callee: { top: 0, bottom: 0, right: 80, left: 80 },
	caller: { left: 0, top: 0, right: 100, bottom: 100 },
}
const kindOf = (thing, called) => (thing.kind === 'store' ? 'store' : called ? 'callee' : 'caller')
// The width of a letter of a topic's name on a bus, and the room kept on each side of it.
const TOPIC_CHAR = 11.7
const CLEAR_TOPIC = 24
// The room kept on each side of a label between two things side by side.
const CLEAR_LABEL = 34
const holdsRect = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h

// Calls visit with each frame and thing of a laid out place at its absolute place, outer frames first.
function walk(result, ox, oy, depth, holder, visit) {
	for (const item of result.items) {
		const [x, y] = [ox + item.x, oy + item.y]
		if (item.kind !== 'frame') {
			visit({ thing: item.thing, x, y, w: item.w, h: item.h, holder, besideUser: item.besideUser })
			continue
		}
		for (const s of item.sats) {
			if (s.item) walk({ items: [{ ...s.item, x: s.x, y: s.y }] }, x, y, depth, holder, visit)
			else visit({ thing: s.thing, x: x + s.x, y: y + s.y, w: s.w, h: s.h, holder })
		}
		const [fx, fy] = [x + item.fx, y + item.fy]
		visit({ frame: item.frame, x: fx, y: fy, w: item.fw, h: item.fh, depth, holder })
		walk(item.inner, fx + (item.fw - item.inner.w) / 2, fy + PAD.top, depth + 1, item.frame.id, visit)
	}
}

// Where a frame's label stands: in its top left corner.
export function labelRect(placed) {
	const size = frameLabel(placed.frame)
	return { x: placed.x + 12, y: placed.y + 14, w: Math.min(size.w, placed.w - 24), h: size.h }
}

function frameLabel(frame) {
	const copies = frame.copies ? `  ${frame.copies.count} ${frame.copies.count === 1 ? 'copy' : 'copies'}` : ''
	return { w: 60 + (frame.name.length + copies.length) * 11.2, h: 36 }
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

// The rows of the things that meet each other, group by group: the biggest group stands on top, and each smaller one
// shares the lowest rows that have room for it, so one chain of calls is not split by things it never meets.
function rowsOfGroups(nodes, edges, touches, items, framesShareRows) {
	const linked = new Map(nodes.map((n) => [n, new Set()]))
	const pairs = [...edges, ...[...touches].flatMap(([bus, set]) => [...set].map((n) => [bus, n]))]
	for (const [a, b] of pairs) {
		if (!linked.has(a) || !linked.has(b)) continue
		linked.get(a).add(b)
		linked.get(b).add(a)
	}
	const groups = []
	const seen = new Set()
	for (const n of nodes) {
		if (seen.has(n)) continue
		const group = []
		for (const todo = [n]; todo.length > 0; ) {
			const m = todo.pop()
			if (seen.has(m)) continue
			seen.add(m)
			group.push(m)
			todo.push(...linked.get(m))
		}
		groups.push(group.sort((a, b) => a - b))
	}
	const rows = []
	for (const group of groups.sort((a, b) => b.length - a.length)) {
		const rank = ranksOf(group, edges, touches, items)
		const ranked = []
		for (const n of group) {
			ranked[rank.get(n)] ??= []
			ranked[rank.get(n)].push(n)
		}
		const own = chained(ranked.filter(Boolean), edges, items, framesShareRows)
		const from = Math.max(0, rows.length - own.length)
		const fits = own.every((row, k) => !rows[from + k] || rows[from + k].length + row.length <= MOST_IN_ROW)
		for (const [k, row] of own.entries()) {
			const into = fits ? rows[from + k] : undefined
			if (!into) {
				rows.push(row)
				continue
			}
			// The newcomers stand on the side away from what the row's own things meet in the row above.
			const above = rows[from + k - 1] ?? []
			const at = into.flatMap((n) => [...linked.get(n)].map((m) => above.indexOf(m))).filter((i) => i >= 0)
			const right = at.length > 0 && at.reduce((sum, i) => sum + i, 0) / at.length > (above.length - 1) / 2
			into.splice(right ? 0 : into.length, 0, ...row)
			into.chain ||= row.chain
		}
	}
	return rows
}

// A call that goes on from a row stays in that row while the row is short, so a chain of calls reads left to right
// as a request travels, and the drawing is wider than it is tall. A bus keeps a row of its own, and so may a frame.
const MOST_CHAINED = 3
function chained(rows, edges, items, framesShareRows) {
	const isBus = (n) => (items[n].kind === 'frame' && !framesShareRows) || hasLanes(items[n].thing)
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
	const kept = rows
		.map((row) =>
			Object.assign(
				row.filter((n) => linked.has(n)),
				{ chain: row.chain },
			),
		)
		.filter((row) => row.length > 0)
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
// shortcut: a row wraps where it would grow wider than wrap times the side of a square holding all the frame holds,
// so a frame comes out wider than tall, like the screen. A finer packing would weigh where the lines go.
function wrapped(rows, items, besideOf, wrap) {
	const width = (n) =>
		items[n].w + [...besideOf].filter(([, user]) => user === n).reduce((sum, [s]) => sum + BESIDE + items[s].w, 0)
	const all = rows.flat()
	const area = all.reduce((sum, n) => sum + (width(n) + GAP.x) * (items[n].h + GAP.y), 0)
	const most = Math.max(Math.sqrt(area) * wrap, ...all.map(width))
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
function placeRows(rows, items, besideOf, edges, touches, gapOf) {
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
	const gap = (row, k) => (k + 1 < row.length ? gapOf(row[k].n, row[k + 1].n) : 0)
	const natural = (row) => row.reduce((sum, g, k) => sum + (isBus(g.n) ? BUS.least : g.w) + gap(row, k), 0)
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
		for (const [k, g] of row.entries()) {
			g.x = x
			centre.set(g.n, x + own(g) + items[g.n].w / 2)
			x += (isBus(g.n) ? BUS.least : g.w) + gap(row, k)
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
			floor = g.x + g.w + gap(row, k)
		})
		let ceiling = width
		for (let k = row.length - 1; k >= 0; k--) {
			const g = row[k]
			g.x = Math.min(g.x, ceiling - g.w)
			ceiling = g.x - (k > 0 ? gap(row, k - 1) : 0)
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
					items[g.n].h,
					g.column
						? g.beside.reduce((sum, s) => sum + items[s].h + GAP.y / 2, -GAP.y / 2)
						: Math.max(0, ...g.beside.map((s) => items[s].h)),
				),
			),
		)
		for (const g of row) {
			const item = items[g.n]
			if (isBus(g.n)) {
				item.w = width
				item.x = 0
			} else item.x = g.x + own(g)
			item.y = y + (tall - item.h) / 2
			let along = g.left ? item.x - BESIDE : item.x + item.w + BESIDE
			let down = item.y
			for (const s of g.beside) {
				const store = items[s]
				if (g.column) {
					store.x = g.left ? item.x - BESIDE - store.w : item.x + item.w + BESIDE
					store.y = down
					down += store.h + GAP.y / 2
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
	for (const store of placed.things) {
		if (!store.besideUser) continue
		const user = placed.things.find((thing) => thing.id === store.besideUser)
		if (!user) continue
		const dy = user.y + user.h / 2 - (store.y + store.h / 2)
		if (Math.abs(dy) < 1) continue
		const moved = { ...store, y: store.y + dy }
		const clear = placed.things.every((o) => o === store || !meets(moved, o))
		const sameFrames = placed.frames.every((f) => (holdsRect(f, store) ? holdsRect(f, moved) : !meets(f, moved)))
		if (clear && sameFrames) store.y += dy
	}
}

// The lines: a call is one line, labelled with its protocol where it crosses a frame's edge; an event goes to or from
// its lane on the bus, or straight between its two things when no bus carries it; a tie joins the places of a part
// drawn twice when no line does.
function linesOf(drawn, placed, busOf) {
	const rectOf = new Map(placed.things.map((thing) => [thing.id, thing]))
	const blocks = [...placed.things, ...placed.frames.map(labelRect)]
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
		// A stem from above goes on from the first lane, so the bus's name reads whole.
		const edge = stem.side === 'top' ? busRect.y + BUS.head : busRect.y + busRect.h
		const far = stem.side === 'top' ? Math.max(...ys) : Math.min(...ys)
		stem.inside = { x: stem.x, y1: edge, y2: Number.isFinite(far) ? far : edge }
		meta.at(-1).inside = stem.inside
	}
	// Crossings between the same two things with the same words are one line, with an arrow at each end they reach, and
	// so are the events two things send each other with no bus between them. Only a line between two places carries
	// its words: inside one place it is plain.
	const joined = new Map()
	for (const crossing of drawn.crossings) {
		if (busOf(crossing) || !rectOf.has(crossing.from) || !rectOf.has(crossing.to)) continue
		const text = crossing.kind === 'call' ? howLabel(crossing) : crossing.topic
		const pair = [crossing.from, crossing.to].sort().join('>')
		const key = crossing.kind === 'event' ? `${pair}:event` : `${pair}:${crossing.kind}:${text}`
		const same = joined.get(key)
		if (!same) {
			joined.set(key, { kind: crossing.kind, id: crossing.id, crossing, crossings: [crossing.id], both: false, text })
			continue
		}
		same.crossings.push(crossing.id)
		if (same.crossing.from !== crossing.from) same.both = true
		if (!same.text.split(', ').includes(text)) same.text = `${same.text}, ${text}`
	}
	for (const line of joined.values()) {
		const [from, to] = [rectOf.get(line.crossing.from), rectOf.get(line.crossing.to)]
		const label = from.holder === to.holder ? null : labelOf(line.text)
		asks.push({ from: { rect: from }, to: { rect: to }, label })
		meta.push({ ...line, words: label?.lines ?? [] })
	}
	// A tie joins two places of a part only where one frame holds the other, as a worker thread inside its process,
	// and no line joins them already.
	const parentOf = new Map(placed.frames.map((f) => [f.id, f.frame.in]))
	const chain = (frame) => {
		const out = []
		for (let at = frame; at; at = parentOf.get(at)) out.push(at)
		return out
	}
	const near = (a, b) => {
		if (a.holder === b.holder) return false
		if (a.holder && chain(b.holder).includes(a.holder)) return true
		return Boolean(b.holder && chain(a.holder).includes(b.holder))
	}
	const linked = (a, b) => drawn.crossings.some((c) => [c.from, c.to].includes(a) && [c.from, c.to].includes(b))
	for (const thing of placed.things) {
		const first = rectOf.get(thing.second)
		if (!first || !near(thing, first) || linked(thing.id, first.id)) continue
		asks.push({ from: { rect: first }, to: { rect: thing }, label: null })
		meta.push({ kind: 'tie', id: `tie:${thing.id}`, from: first.id, to: thing.id })
	}
	const routes = routeLines(blocks, frames, asks)
	const lines = routes.map((route, i) => ({ ...meta[i], points: route.points, label: route.label, rings: route.rings }))
	return { lines, lanes, marks }
}
