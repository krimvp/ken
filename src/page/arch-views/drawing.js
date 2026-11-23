// The two drawings on the canvas, as HTML in the canvas's own units: "Where it runs" (frames, the parts as bold blocks
// in their colours, stores as cylinders, a bus with a lane per topic, outside things in grey, people as people, calls
// as solid lines and events as dashed ones, a ring where a line crosses a frame, and a dashed note where the
// repository says nothing) and "In its world" (the project as one block, with the people and systems around it). A
// part keeps its colour and its icon in every view. Every block, frame label, line label and lane mark opens a brief.
import { partId, readConcept } from '../brief/concept-id.js'
import { KNOWN, levelLabel } from '../level/level-state.js'
import { icon, levelMark, partIcon } from '../shell/icons.js'
import { esc } from '../views/format.js'
import { howLabel, labelRect } from './runtime-layout.js'

// The drawn icons of these drawings, in the same form as the page's own.
const PATHS = {
	browser: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M6.5 6.500h.01M9.500 6.500h.01"/>',
	machine: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
	cluster:
		'<rect x="3" y="3" width="7.500" height="7.500" rx="1.500"/><rect x="13.500" y="3" width="7.500" height="7.500" rx="1.500"/><rect x="3" y="13.500" width="7.500" height="7.500" rx="1.500"/><rect x="13.500" y="13.500" width="7.500" height="7.500" rx="1.500"/>',
	process: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM9 2v2M15 2v2M9 20v2M15 20v2"/>',
	container: '<path d="M12 3l8 4.500v9L12 21l-8-4.500v-9zM4 7.500l8 4.500 8-4.500M12 12v9"/>',
	thread: '<path d="M8 3c3 4-3 14 0 18M16 3c3 4-3 14 0 18"/>',
	vm: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 10l-2.500 2 2.500 2M15 10l2.500 2-2.500 2"/>',
	sandbox: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/>',
	function: '<path d="M6 20l6.500-10M8 4c2.500 0 3.500 1.500 4.500 4.500L18 20"/>',
	other: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 3"/>',
	store:
		'<ellipse cx="12" cy="6" rx="7" ry="2.500"/><path d="M5 6v12c0 1.400 3.100 2.500 7 2.500s7-1.100 7-2.500V6M5 12c0 1.400 3.100 2.500 7 2.500s7-1.100 7-2.500"/>',
	bus: '<path d="M3 7h18M3 12h18M3 17h18"/><circle cx="8" cy="7" r="1.800" fill="currentColor"/><circle cx="16" cy="12" r="1.800"/>',
	outside: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
	person: '<circle cx="12" cy="8" r="3.500"/><path d="M5 20c.800-3.600 3.500-5.500 7-5.500s6.200 1.900 7 5.500"/>',
	world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
	runs: '<rect x="3" y="3" width="18" height="18" rx="2.500"/><path d="M3 8h18"/><rect x="7" y="11.500" width="10" height="6" rx="1.500"/>',
	key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.500-8.500M16 7l3 3M14 9l2 2"/>',
	project: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
}
export const mark = (name, extra = '') =>
	`<svg class="k-i${extra ? ` ${extra}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ''}</svg>`

export const FRAME_NAMES = {
	browser: 'Browser',
	machine: 'Machine',
	cluster: 'Cluster',
	process: 'Process',
	container: 'Container',
	thread: 'Thread',
	vm: 'Virtual machine',
	sandbox: 'Sandbox',
	function: 'Function',
	other: 'Frame',
}
// A frame that only parts of the code share with others is drawn dashed.
const DASHED = ['thread', 'vm', 'sandbox']

const copiesOf = (frame) =>
	frame.copies ? `${frame.copies.count} ${frame.copies.count === 1 ? 'copy' : 'copies'}` : ''

const px = (r) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`
const pathOf = (points) =>
	`M${points.map((p) => `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join('L')}`

const ARROWS = `<defs>
	<marker id="rt-head" viewBox="0 0 12 12" refX="10.500" refY="6" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0.500L12 6L0 11.500z"/></marker>
</defs>`

// The words under a part's name: the layer on show, or what ken thinks the reader knows of it.
function footOf(box, view) {
	const { home, layer } = view
	if (!box) return ''
	if (layer === 'changes') {
		if (!box.touched) return '<span class="k-rt-words">No change</span>'
		return `${icon('changed')}<b class="k-num">${box.touched.files}</b><span class="k-rt-words">${box.touched.files === 1 ? 'file' : 'files'}</span>`
	}
	const mark = levelMark(box.knows.level, layer === 'know' ? 24 : 16)
	return `${mark}<span class="k-rt-words">${esc(levelLabel(home, box.knows.level))}</span>`
}

// The container a part runs in alone, as a chip in the part's corner that opens its brief: its mark and its copies.
function tagHtml(frame, view) {
	const words = copiesOf(frame) ? `<span>${esc(copiesOf(frame))}</span>` : ''
	const id = `frame:${frame.id}`
	return `<button class="k-rt-tag" data-act="brief-open" data-concept="${esc(id)}" data-key="frame-${esc(frame.id)}" aria-pressed="${view.brief === id}" aria-label="${esc(`${FRAME_NAMES[frame.kind] ?? 'Frame'}: ${frame.name}${frame.copies ? `, ${copiesOf(frame)}` : ''}`)}">${mark(frame.kind)}${words}</button>`
}

// A part as a bold block, in its colour. A container that runs it alone names the block, and the part's name goes
// under it: "payments", then "Event workers". The second place of a part drawn twice is small and dashed.
function partHtml(placed, view) {
	const name = placed.thing.part
	const box = view.boxes.get(name)
	const id = partId([], name)
	const stops = view.stops.get(name) ?? []
	const quiet =
		(view.layer === 'processes' && view.process && stops.length === 0) || (view.layer === 'changes' && !box?.touched)
	const classes = [
		'k-rt-part',
		view.colour(name),
		placed.second ? 'is-second' : '',
		placed.solo ? 'is-solo' : '',
		view.brief === id ? 'is-picked' : '',
		quiet ? 'is-quiet' : '',
		box ? `knows-${box.knows.level}` : '',
	]
	const beads =
		stops.length > 0
			? `<span class="k-beads">${stops.map((n) => `<span class="k-bead k-num"><span class="visually-hidden">step </span>${n}</span>`).join('')}</span>`
			: ''
	const title = placed.solo && placed.solo.name.toLowerCase() !== name.toLowerCase() ? placed.solo.name : name
	const under = title === name ? '' : `<span class="k-rt-runs" data-fit="${esc(name)}">${esc(name)}</span>`
	const foot = placed.second ? `<span>Also runs here</span>` : footOf(box, view)
	const index = box ? view.home.look.boxes.indexOf(box) : -1
	const inside =
		box?.opens && !placed.second
			? `<button class="k-blk-in" data-act="arch-inside" data-index="${index}" data-key="rt-in-${esc(placed.id)}" aria-label="Go inside ${esc(name)}" title="Go inside">${icon('inside')}</button>`
			: ''
	const known = box ? KNOWN.indexOf(box.knows.level) / (KNOWN.length - 1) : 0
	return `<div class="${classes.filter(Boolean).join(' ')}" style="${px(placed)};--known:${known}" data-glide="part:${esc(name)}${placed.second ? ':2' : ''}">
		<button class="k-rt-face" data-act="arch-view-pick" data-name="${esc(name)}" data-concept="${esc(id)}" data-key="rt-${esc(placed.id)}" aria-pressed="${view.brief === id}">
			<span class="k-rt-head"><span class="k-blk-icon">${icon(partIcon(name))}</span><span class="k-rt-name" data-fit="${esc(title)}">${esc(title)}</span></span>
			${under}
			${beads}
			<span class="k-rt-foot">${foot}</span>
		</button>
		${placed.solo ? tagHtml(placed.solo, view) : ''}
		${inside}
	</div>`
}

function storeHtml(placed, view) {
	const store = placed.thing
	const id = `store:${store.id}`
	const user = view.storeColour.get(store.id) ?? ''
	return `<button class="k-rt-store ${user}${view.brief === id ? ' is-picked' : ''}" style="${px(placed)}" data-act="brief-open" data-concept="${esc(id)}" data-key="rt-${esc(placed.id)}" aria-pressed="${view.brief === id}">
		<svg class="k-rt-can" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M2 14v72c0 7 21.500 12 48 12s48-5 48-12V14"/><ellipse cx="50" cy="14" rx="48" ry="12"/></svg>
		<span class="k-rt-store-name">${esc(store.name)}</span><span class="k-rt-store-kind">${esc(store.store === 'other' ? 'store' : store.store)}</span>
	</button>`
}

function busHtml(placed, view, layout) {
	const bus = placed.thing
	const id = `store:${bus.id}`
	const lanes = layout.lanes
		.filter((lane) => lane.bus === bus.id)
		.map(
			(lane) =>
				`<span class="k-rt-lane" style="top:${lane.y - placed.y - 10}px"></span><span class="k-rt-topic k-mono" style="left:${lane.x - placed.x}px;top:${lane.y - placed.y}px">${esc(lane.topic)}</span>`,
		)
	return `<div class="k-rt-bus${view.brief === id ? ' is-picked' : ''}" style="${px(placed)}">
		<button class="k-rt-bus-head" data-act="brief-open" data-concept="${esc(id)}" data-key="rt-${esc(placed.id)}" aria-pressed="${view.brief === id}">${mark('bus')}<b>${esc(bus.name)}</b><span class="k-rt-bus-kind">${bus.topics.length} ${bus.topics.length === 1 ? 'topic' : 'topics'}</span></button>
		<span class="k-rt-legend" aria-hidden="true"><i class="k-rt-dot"></i>publishes <i class="k-rt-ring"></i>picks up later</span>
		${lanes.join('')}
	</div>`
}

function outsideHtml(placed, outside, view, glide = '') {
	const id = `outside:${placed.id}`
	const person = outside?.kind === 'person'
	const name = outside?.name ?? placed.id
	const picked = view.brief === id
	if (person) {
		return `<button class="k-rt-person${picked ? ' is-picked' : ''}" style="${px(placed)}" data-act="brief-open" data-concept="${esc(id)}" data-key="rt-${esc(placed.id)}" aria-pressed="${picked}"${glide}>
			<svg class="k-rt-figure" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="17" r="13"/><path d="M6 62c0-15 11.500-24 26-24s26 9 26 24z"/></svg>
			<span class="k-rt-out-name">${esc(name)}</span><span class="k-rt-eyebrow">Person</span>
		</button>`
	}
	return `<button class="k-rt-out${picked ? ' is-picked' : ''}" style="${px(placed)}" data-act="brief-open" data-concept="${esc(id)}" data-key="rt-${esc(placed.id)}" aria-pressed="${picked}"${glide}>
		<span class="k-rt-eyebrow">${mark('outside')}Outside</span><span class="k-rt-out-name">${esc(name)}</span>
	</button>`
}

function foldHtml(placed, view) {
	const fold = placed.thing
	const swatches = fold.members
		.slice(0, 6)
		.map((member) => {
			const part = view.thingOf.get(member)
			return `<span class="k-sw ${part?.kind === 'part' ? view.colour(part.part) : ''}"></span>`
		})
		.join('')
	return `<button class="k-rt-fold" style="${px(placed)}" data-act="arch-unfold" data-key="rt-${esc(placed.id)}" aria-label="${esc(`${fold.name}: ${fold.members.length} things, folded. Press to open them.`)}">
		<span class="k-rt-fold-name">${esc(fold.name)}</span><span class="k-rt-fold-count">${fold.members.length} things, folded</span><span class="k-rt-fold-sw">${swatches}</span>
	</button>`
}

function frameHtml(placed, view) {
	const frame = placed.frame
	const id = `frame:${frame.id}`
	const label = labelRect(placed)
	const copies = copiesOf(frame)
	return `<div class="k-rt-frame depth-${Math.min(placed.depth, 3)}${DASHED.includes(frame.kind) ? ' is-dashed' : ''}${view.brief === id ? ' is-picked' : ''}" style="${px(placed)}">
		<button class="k-rt-flabel" style="width:${label.w}px" data-act="brief-open" data-concept="${esc(id)}" data-key="frame-${esc(frame.id)}" aria-pressed="${view.brief === id}" aria-label="${esc(`${FRAME_NAMES[frame.kind] ?? 'Frame'}: ${frame.name}${copies ? `, ${copies}` : ''}`)}">${mark(frame.kind)}<span class="k-rt-fname">${esc(frame.name)}</span>${copies ? `<span class="k-rt-copies">${copies}</span>` : ''}</button>
	</div>`
}

// view holds what the canvas shows: home, layer, process stops by part name, the open brief, a part's colour class,
// and the boxes of the top level by name. The answer is the HTML of the world, its size, and its rects for the map.
export function runtimeHtml(views, layout, view) {
	const outsideOf = new Map((views.world?.outside ?? []).map((each) => [each.id, each]))
	view.thingOf = new Map(views.runtime.things.map((thing) => [thing.id, thing]))
	// A store has the colour of the one part that uses it, when one part does.
	view.storeColour = new Map()
	for (const placed of layout.things) {
		if (placed.thing.kind !== 'store') continue
		const users = views.runtime.crossings
			.flatMap((c) => (c.to === placed.id ? [c.from] : c.from === placed.id ? [c.to] : []))
			.map((other) => view.thingOf.get(other))
		const parts = [...new Set(users.filter((u) => u?.kind === 'part').map((u) => u.part))]
		if (parts.length === 1 && users.length === parts.length) view.storeColour.set(placed.id, view.colour(parts[0]))
	}
	const lit = view.litCrossings ?? new Set()
	const stale = new Set(views.stale?.map((item) => item.id))
	const frames = layout.frames.toSorted((a, b) => a.depth - b.depth).map((placed) => frameHtml(placed, view))
	const things = layout.things.map((placed) => {
		const kind = placed.thing.kind
		if (kind === 'part') return partHtml(placed, view)
		if (kind === 'fold') return foldHtml(placed, view)
		if (kind === 'outside') return outsideHtml(placed, outsideOf.get(placed.id), view)
		return placed.thing.topics?.length > 0 ? busHtml(placed, view, layout) : storeHtml(placed, view)
	})
	const lines = []
	const over = []
	const labels = []
	for (const line of layout.lines) {
		const crossings = line.crossings ?? (line.crossing ? [line.crossing.id] : [])
		const picked = crossings.some((c) => view.brief === `crossing:${c}`)
		const on = crossings.some((c) => lit.has(c))
		const earlier = crossings.some((id) => stale.has(id))
		const cls = `k-rt-line is-${line.kind}${earlier ? ' is-stale' : ''}${picked ? ' is-picked' : ''}${on ? ' is-lit' : ''}`
		const ends =
			line.kind === 'call' || line.kind === 'event'
				? ` marker-end="url(#rt-head)"${line.both ? ' marker-start="url(#rt-head)"' : ''}`
				: line.kind === 'stem'
					? `${line.into ? ' marker-end="url(#rt-head)"' : ''}${line.outOf ? ' marker-start="url(#rt-head)"' : ''}`
					: ''
		lines.push(`<path class="${cls}" d="${pathOf(line.points)}"${ends}/>`)
		for (const ring of line.rings) lines.push(`<circle class="k-rt-cross" cx="${ring.x}" cy="${ring.y}" r="6"/>`)
		if (line.inside) {
			over.push(`<path class="${cls}" d="M${line.inside.x} ${line.inside.y1}V${line.inside.y2}"/>`)
		}
		if (line.kind !== 'call' && line.kind !== 'event') continue
		const c = line.crossing
		const from = view.nameOf(c.from)
		const to = view.nameOf(c.to)
		const said = c.kind === 'call' ? `${from} to ${to}: ${howLabel(c)}, ${c.text}` : `${from} sends ${c.topic} to ${to}`
		// A line inside one place has no label: a round handle in its middle, seen on a hover or a focus, opens it.
		const mid = line.label ? null : middleOf(line.points)
		const shape = mid ? 'k-rt-knob' : 'k-rt-label'
		const place = mid ? px({ x: mid.x - 13, y: mid.y - 13, w: 26, h: 26 }) : px(line.label)
		labels.push(
			`<button class="${shape} is-${line.kind}${picked ? ' is-picked' : ''}${on ? ' is-lit' : ''}" style="${place}" data-act="brief-open" data-concept="crossing:${esc(c.id)}" data-ends="${esc(`${c.from} ${c.to}`)}" data-key="line-${esc(c.id)}" aria-pressed="${picked}" aria-label="${esc(said)}${earlier ? '. Source changed.' : ''}">${line.words.map(esc).join('<br>')}</button>`,
		)
	}
	const marks = layout.marks.map((m) => {
		const picked = view.brief === `crossing:${m.crossing}`
		const who = view.nameOf(m.thing)
		const said =
			m.kind === 'pub'
				? `${who} publishes ${m.topic}`
				: m.kind === 'sub'
					? `${who} picks up ${m.topic}`
					: `${who} publishes and picks up ${m.topic}`
		return `<button class="k-rt-mark is-${m.kind}${picked ? ' is-picked' : ''}${lit.has(m.crossing) ? ' is-lit' : ''}" style="left:${m.x}px;top:${m.y}px" data-act="brief-open" data-concept="crossing:${esc(m.crossing)}" data-key="mark-${esc(m.thing)}-${esc(m.topic)}" aria-pressed="${picked}" aria-label="${esc(said)}${stale.has(m.crossing) ? '. Source changed.' : ''}"></button>`
	})
	const svg = (cls, body) =>
		`<svg class="k-wires ${cls}" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${ARROWS}${body}</svg>`
	return `${frames.join('')}${svg('k-rt-lines', lines.join(''))}${things.join('')}${svg('k-rt-over', over.join(''))}${marks.join('')}${labels.join('')}`
}

// The point halfway along a line.
function middleOf(points) {
	const pieces = points.slice(1).map((p, k) => Math.abs(p.x - points[k].x) + Math.abs(p.y - points[k].y))
	let left = pieces.reduce((sum, n) => sum + n, 0) / 2
	for (const [k, n] of pieces.entries()) {
		if (left <= n) {
			const t = n === 0 ? 0 : left / n
			return {
				x: points[k].x + (points[k + 1].x - points[k].x) * t,
				y: points[k].y + (points[k + 1].y - points[k].y) * t,
			}
		}
		left -= n
	}
	return points[0]
}

// "Where it runs" in small, for a brief: the frames as outlines, the things as blocks in their colours, the lines,
// and what the brief is about lit, as the reader saw it on the canvas. Nothing when the drawing does not hold it.
export function runtimePictureHtml(layout, id, colour) {
	const concept = readConcept(id)
	if (!concept) return ''
	const ends = (line) =>
		line.kind === 'stem' ? [line.thing, line.bus] : line.kind === 'tie' ? [] : [line.crossing.from, line.crossing.to]
	const lines = new Set(
		concept.kind === 'crossing' ? layout.lines.filter((line) => line.crossings?.includes(concept.name)) : [],
	)
	const things = new Set(
		layout.things
			.filter((placed) =>
				concept.kind === 'part'
					? concept.within.length === 0 && placed.thing.part === concept.name
					: concept.kind === 'frame'
						? placed.solo?.id === concept.name
						: placed.id === concept.name || [...lines].some((line) => ends(line).includes(placed.id)),
			)
			.map((placed) => placed.id),
	)
	const frame = concept.kind === 'frame' ? layout.frames.find((f) => f.id === concept.name) : null
	if (!frame && things.size === 0) return ''
	const frames = layout.frames
		.toSorted((a, b) => a.depth - b.depth)
		.map(
			(f) =>
				`<rect class="k-rtp-frame${DASHED.includes(f.frame.kind) ? ' is-dashed' : ''}${f === frame ? ' is-lit' : ''}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="18"/>`,
		)
	const paths = layout.lines.map(
		(line) => `<path class="k-rtp-line${lines.has(line) ? ' is-lit' : ''}" d="${pathOf(line.points)}"/>`,
	)
	const blocks = layout.things.map((placed) => {
		const part = placed.thing.kind === 'part' ? colour(placed.thing.part) : 'is-other'
		return `<rect class="k-rtp-thing ${part}${things.has(placed.id) ? ' is-lit' : ''}" x="${placed.x}" y="${placed.y}" width="${placed.w}" height="${placed.h}" rx="16"/>`
	})
	return `<div class="k-pic k-rt-pic" aria-hidden="true"><svg viewBox="0 0 ${layout.width} ${layout.height}">${frames.join('')}${paths.join('')}${blocks.join('')}</svg></div>`
}

// The project as one block with its parts as tiles, its people and systems around it, and a labelled line for each
// crossing.
export function worldHtml(views, layout, view) {
	const { project } = layout
	const stale = new Set(views.stale?.map((item) => item.id))
	const tiles = project.tiles.map((tile) => {
		const id = partId([], tile.name)
		const picked = view.brief === id
		return `<button class="k-wd-tile ${view.colour(tile.name)}${picked ? ' is-picked' : ''}" style="${px({ ...tile, x: project.x + tile.x, y: project.y + tile.y })}" data-act="arch-view-pick" data-name="${esc(tile.name)}" data-concept="${esc(id)}" data-key="wd-${esc(tile.name)}" aria-pressed="${picked}" data-glide="part:${esc(tile.name)}"><span class="k-blk-icon">${icon(partIcon(tile.name))}</span><span>${esc(tile.name)}</span></button>`
	})
	const outside = layout.outside.map((placed) => outsideHtml(placed, placed.outside, view))
	const lines = []
	const labels = []
	for (const line of layout.lines) {
		const c = line.crossing
		const picked = view.brief === `crossing:${c.id}`
		const [start, end] =
			c.direction === 'in'
				? ['', ' marker-end="url(#rt-head)"']
				: c.direction === 'out'
					? [' marker-start="url(#rt-head)"', '']
					: [' marker-start="url(#rt-head)"', ' marker-end="url(#rt-head)"']
		lines.push(
			`<path class="k-rt-line is-call${stale.has(c.id) ? ' is-stale' : ''}${picked ? ' is-picked' : ''}" d="${pathOf(line.points)}"${start}${end}/>`,
		)
		const other = view.outsideName(c.outside)
		const said =
			c.direction === 'in'
				? `${other} to the project: ${line.words.join(' ')}`
				: c.direction === 'out'
					? `The project to ${other}: ${line.words.join(' ')}`
					: `Between the project and ${other}: ${line.words.join(' ')}`
		if (line.label) {
			labels.push(
				`<button class="k-rt-label is-call is-world${picked ? ' is-picked' : ''}" style="${px(line.label)}" data-act="brief-open" data-concept="crossing:${esc(c.id)}" data-key="line-${esc(c.id)}" aria-pressed="${picked}" aria-label="${esc(said)}${stale.has(c.id) ? '. Source changed.' : ''}">${line.words.map(esc).join('<br>')}</button>`,
			)
		}
	}
	const projectBlock = `<div class="k-wd-project" style="${px(project)}"><div class="k-wd-head">${mark('project')}<b>${esc(view.projectName)}</b><span class="k-wd-line">${esc(views.world.project?.line ?? '')}</span></div><p class="k-wd-count">${project.tiles.length} ${project.tiles.length === 1 ? 'part' : 'parts'}</p></div>`
	return `<svg class="k-wires k-rt-lines" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${ARROWS}${lines.join('')}</svg>${projectBlock}${tiles.join('')}${outside.join('')}${labels.join('')}`
}
