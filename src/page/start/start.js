// The Home page: where to start and how things stand, as tiles. A wide "Start here" leads with the first thing ken
// would have the reader look at, and offers the next two. Under it, one tile for each page says its count in a big
// number over a small picture: the architecture filled as far as the reader knows each part, a few concepts worth a
// few minutes, the drawn processes, the commits that landed, and the reader's own map. A tile's picture is pressed
// like the page it stands for. What the project is leads on every visit: on a first one, and until ken's model names
// the parts, in place of "Start here", and after that smaller, above it.
import { partId } from '../brief/concept-id.js'
import { dayText } from '../changes/timeline.js'
import { live } from '../jobs/jobs.js'
import { KNOWN, levelLabel } from '../level/level-state.js'
import { partClass } from '../project/part-colours.js'
import { placeParts } from '../project/parts-picture.js'
import { icon, KIND_ICONS, levelMark } from '../shell/icons.js'
import { count, esc, prose } from '../views/format.js'
import { changedParts, openCount } from '../views/open.js'
import { firstVisitHtml } from './first-visit.js'

// Concepts the tile lists.
const SHOWN_CONCEPTS = 6
const BAR_DAYS = 30
const DAY = 86_400_000
const SHOWN_PROCESSES = 2

// What the button of "Start here" says, by the kind of the thing ken leads with.
const DOES = {
	decision: 'Open decisions',
	stale: 'Show what changed',
	review: 'Review it',
	tour: 'Open its brief',
	read: 'Open its brief',
}

const head = (title, page, label) =>
	`<div class="k-tile-head"><h2 class="k-eyebrow">${title}</h2><button class="k-tile-go" data-act="go-page" data-page="${page}" data-key="tile-${page}" aria-label="${label}">${icon('right')}</button></div>`

const big = (number, words) => `<p class="k-big"><b class="k-num">${number}</b> ${words}</p>`

function cellsOf(look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)]).filter(([a, b]) => a >= 0 && b >= 0)
	const placed = look.boxes.length <= 6 ? placeParts(look.boxes.length, links) : null
	const cells = placed?.cells ?? look.boxes.map((_, i) => ({ row: Math.floor(i / 3), col: i % 3 }))
	return {
		cells,
		links,
		cols: Math.max(1, ...cells.map((cell) => cell.col + 1)),
		rows: Math.max(1, ...cells.map((cell) => cell.row + 1)),
	}
}

// The top level as a small map. lit names the parts to light, and the others step back. With byLevel each part is
// filled as far as ken thinks the reader knows it, and is a button that opens its brief.
function mapHtml(look, { lit = null, byLevel = false, key }) {
	const { cells, links, cols, rows } = cellsOf(look)
	const mid = (cell) => `${cell.col * 100 + 50} ${cell.row * 100 + 50}`
	const lines = links.map(([a, b]) => `<path d="M${mid(cells[a])}L${mid(cells[b])}"/>`)
	const boxes = look.boxes.map((box, i) => {
		const place = `grid-row:${cells[i].row + 1};grid-column:${cells[i].col + 1}`
		const colour = partClass(box.name)
		if (!byLevel) {
			return `<span class="k-mini-box ${colour}${lit?.includes(box.name) ? ' is-lit' : ''}" style="${place}"></span>`
		}
		const known = KNOWN.indexOf(box.knows.level) / (KNOWN.length - 1)
		return `<button class="k-mini-box is-level knows-${box.knows.level} ${colour}" style="${place};--known:${known}" data-act="brief-open" data-concept="${esc(partId(look.within, box.name))}" data-key="${key}-${i}"><span>${esc(box.name)}</span></button>`
	})
	return `<div class="k-mini${byLevel ? ' is-big' : ''}" style="--cols:${cols}"><svg viewBox="0 0 ${cols * 100} ${rows * 100}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${boxes.join('')}</div>`
}

// The other ways in, under the main one: a smaller link each, which says what the thing is, such as how large a change
// to review is.
function nextLink(item, index) {
	const size = item.size
		? `${count(item.size.files, 'file', 'files')}${item.parts.length > 0 ? `, ${count(item.parts.length, 'part', 'parts')}` : ''}`
		: item.kind === 'stale'
			? item.why.replace(/\.$/, '')
			: ''
	return `<li><button class="k-link k-then-link" data-act="start-go" data-index="${index}" data-key="start-then-${index}">${prose(item.title)}${size ? `<span class="k-then-size">: ${prose(size)}</span>` : ''}</button></li>`
}

// briefOf gives a brief the page has read: a stop of the tour says what its part does, from its brief.
function startHtml({ look, briefOf }) {
	const items = look.next?.items ?? []
	const [lead, ...rest] = items
	if (!lead) {
		return `<section class="k-tile k-start" aria-labelledby="start-title">
			<div class="k-start-pic">${mapHtml(look, { lit: [], key: 'start-map' })}</div>
			<div class="k-start-words"><p class="k-eyebrow">Start here</p><h2 id="start-title">Nothing new since you looked</h2><p class="k-start-why">${look.named ? 'The architecture is as you left it.' : "ken's model has not named the parts of this project yet."}</p>
			<button class="k-btn is-big" data-act="go-page" data-page="architecture" data-key="start-primary">See the architecture${icon('right')}</button></div>
		</section>`
	}
	const stale = lead.kind === 'stale' ? look.boxes.find((box) => box.name === lead.parts[0])?.knows.since : null
	const badge = stale ? `<span class="k-badge">${icon('changed')}<span class="k-num">${stale}</span></span>` : ''
	const stop = lead.kind === 'tour' ? briefOf(partId(look.within, lead.parts[0]))?.line : null
	return `<section class="k-tile k-start" aria-labelledby="start-title">
		<div class="k-start-pic">${mapHtml(look, { lit: lead.parts, key: 'start-map' })}${badge}</div>
		<div class="k-start-words"><p class="k-eyebrow">Start here</p><h2 id="start-title">${prose(lead.title)}</h2><p class="k-start-why">${prose(stop ?? lead.why)}</p>
			<button class="k-btn is-big" data-act="start-go" data-index="0" data-key="start-primary">${DOES[lead.kind] ?? 'Open it'}${icon('right')}</button>
			${
				rest.length > 0
					? `<ul class="k-then" aria-label="Or">${rest
							.slice(0, 2)
							.map((item, i) => nextLink(item, i + 1))
							.join('')}</ul>`
					: ''
			}</div>
	</section>`
}

// Folders are not parts, so before ken's model names the parts they are a list with their size, not boxes.
function foldersHtml(look) {
	const most = Math.max(1, ...look.boxes.map((box) => box.size?.lines ?? 0))
	const rows = look.boxes.map((box, i) => {
		const lines = box.size?.lines ?? 0
		return `<li><button class="k-mini-row" data-act="brief-open" data-concept="${esc(partId(look.within, box.name))}" data-key="arch-row-${i}">${icon(box.opens ? 'folder' : 'file')}<span class="k-mini-name">${esc(box.name)}</span><span class="k-size-bar" style="--size:${Math.round((lines / most) * 100)}%" aria-hidden="true"></span><span class="k-mini-lines k-num">${count(lines, 'line', 'lines')}</span>${levelMark(box.knows.level, 15)}</button></li>`
	})
	return `<ul class="k-mini-rows">${rows.join('')}</ul>`
}

function architectureHtml(look) {
	const opened = look.boxes.filter((box) => box.knows.level !== 'new').length
	const noun = look.named ? 'parts' : 'folders'
	return `<section class="k-tile k-tile-arch">${head('Architecture', 'architecture', 'Open Architecture')}
		${big(opened, `of ${look.boxes.length} ${noun} opened`)}
		${look.named ? mapHtml(look, { byLevel: true, key: 'arch-map' }) : foldersHtml(look)}
	</section>`
}

// The concepts worth a few minutes: the parts ken would have the reader look at first, then a process and terms.
function conceptsHtml(look, concepts, home) {
	const wanted = (look.next?.items ?? []).flatMap((item) => item.parts)
	const rank = (name) => (wanted.includes(name) ? wanted.indexOf(name) : wanted.length)
	const parts = look.boxes
		.map((box) => ({ id: partId(look.within, box.name), kind: 'part', name: box.name, level: box.knows.level }))
		.sort((a, b) => rank(a.name) - rank(b.name))
	const others = (kind, most) => concepts.filter((each) => each.kind === kind).slice(0, most)
	const rest = [...others('process', 1), ...others('term', 2)]
	const shown = [...parts.slice(0, SHOWN_CONCEPTS - rest.length), ...rest]
	const rows = shown.map((each, i) => {
		const lead =
			each.kind === 'part' ? `<span class="k-sw ${partClass(each.name)}"></span>` : icon(KIND_ICONS[each.kind])
		const level = each.level
			? `${levelMark(each.level, 15)}<span class="visually-hidden">${esc(levelLabel(home, each.level))}</span>`
			: ''
		const minutes = concepts.find((row) => row.id === each.id)?.minutes ?? each.minutes
		const time = minutes ? `<span class="k-concept-min k-num">${minutes} min</span>` : ''
		return `<li><button class="k-chip k-concept" data-act="brief-open" data-concept="${esc(each.id)}" data-key="concept-${i}">${lead}<span class="k-concept-name">${prose(each.name)}</span>${level}${time}</button></li>`
	})
	return `<section class="k-tile k-tile-concepts"><div class="k-tile-head"><h2 class="k-eyebrow">Concepts</h2><span class="k-tile-note">minutes to read</span></div><ul class="k-concepts">${rows.join('')}</ul></section>`
}

// A process as a line through its stops, each in the colour of its part.
export function routeHtml(stops) {
	if (stops.length === 0) return `<span class="k-route is-plain">${icon('processes')}</span>`
	const [w, h] = [128, 40]
	const at = (i) => ({ x: 8 + (i * (w - 16)) / Math.max(stops.length - 1, 1), y: i % 2 === 0 ? 10 : 30 })
	const line = stops.map((_, i) => `${i === 0 ? 'M' : 'L'}${at(i).x} ${at(i).y}`).join('')
	const dots = stops.map(
		(colour, i) => `<rect class="${colour}" x="${at(i).x - 5}" y="${at(i).y - 5}" width="10" height="10" rx="3"/>`,
	)
	return `<svg class="k-route" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${line}"/>${dots.join('')}</svg>`
}

// With none drawn, the main process ken's model named is offered to draw, as the top of Home offers it.
function processesHtml(concepts, briefOf, look, env) {
	const drawn = concepts.filter((each) => each.kind === 'process')
	const rows = drawn.slice(0, SHOWN_PROCESSES).map((process, i) => {
		const brief = briefOf(process.id)
		const stops = (brief?.steps ?? []).map((step) =>
			step.part ? partClass(step.part.slice(step.part.lastIndexOf(':') + 1)) : '',
		)
		const steps = brief?.steps ? `<span>${count(brief.steps.length, 'step', 'steps')}</span>` : ''
		return `<li><button class="k-proc" data-act="brief-open" data-concept="${esc(process.id)}" data-key="proc-${i}">${routeHtml(stops)}<span class="k-proc-words"><b>${prose(process.name)}</b>${steps}</span></button></li>`
	})
	const flow = look.named?.flows[0]
	const drawing = env?.jobs?.some((job) => job.kind === 'process' && live(job))
	const named = !flow
		? 'Ask for one on the Architecture page, with "Draw it another way".'
		: drawing
			? `ken's model named the main process, <b>${prose(flow)}</b>, and ken is drawing it now.`
			: `ken's model named the main process, <b>${prose(flow)}</b>. <button class="k-link" data-act="first-draw" data-key="tile-draw"${env?.off ? ' disabled' : ''}>Draw it</button>`
	const none = drawn.length === 0 ? `<p class="k-tile-note">None drawn yet. ${named}</p>` : ''
	return `<section class="k-tile">${head('Processes', 'processes', 'Open Processes')}
		${big(drawn.length, 'drawn')}
		<ul class="k-procs">${rows.join('')}</ul>${none}
	</section>`
}

// The commits that landed, as a small chart of the last 30 days, with a frame round the days since the reader looked
// at the first part that changed, or round the first span of time the server offers.
function changesHtml(look, changes, timeline) {
	const changed = changedParts(look)
	const span = changes.find((choice) => choice.kind === 'since')
	const tile = (body) => `<section class="k-tile">${head('Changes', 'changes', 'Open Changes')}${body}</section>`
	if (changed.length === 0 && !span) return tile('<p class="k-tile-note">Nothing landed in the last 90 days.</p>')
	let title
	let from
	if (changed.length > 0) {
		title = big(changed.length, `${changed.length === 1 ? 'part' : 'parts'} changed since you looked`)
		const looked = changed.map((box) => Date.parse(box.knows.last ?? '') + DAY).filter(Number.isFinite)
		from = looked.length > 0 ? Math.min(...looked) : null
	} else {
		const named = span.name.slice(0, span.name.lastIndexOf(': '))
		const words = span.days ? `in the last ${span.days} days` : `${named[0].toLowerCase()}${named.slice(1)}`
		title = big(span.commits, `${span.commits === 1 ? 'commit' : 'commits'} ${words}`)
		from = Date.parse(span.start)
	}
	const first = dayText(new Date(Date.now() - (BAR_DAYS - 1) * DAY).toISOString().slice(0, 10))
	const key = `<p class="k-bars-key"><span>${esc(first)}</span><span>commits a day</span><span>today</span></p>`
	return tile(`${title}${timeline ? `${barsHtml(timeline.days, from)}${key}` : ''}`)
}

// The commits of each of the last 30 days, one slot a day up to today, and a frame round the days from the time from,
// when there is one.
function barsHtml(days, from) {
	const [w, h, slots] = [300, 84, BAR_DAYS]
	const step = w / slots
	const today = Date.parse(new Date().toISOString().slice(0, 10))
	const slotOf = (time) => slots - 1 - Math.round((today - time) / DAY)
	const most = Math.max(1, ...days.map((each) => each.commits))
	const since = from === null ? slots : Math.max(0, slotOf(Date.parse(new Date(from).toISOString().slice(0, 10))))
	const bars = days
		.filter((each) => slotOf(Date.parse(each.day)) >= 0 && each.commits > 0)
		.map((each) => {
			const at = slotOf(Date.parse(each.day))
			const tall = Math.max(3, Math.sqrt(each.commits / most) * (h - 8))
			return `<rect class="${at >= since ? 'is-since' : ''}" x="${at * step + 1}" y="${h - 2 - tall}" width="${step - 2}" height="${tall}" rx="1.5"/>`
		})
	const frame =
		since < slots
			? `<rect class="k-bars-since" x="${since * step - 1}" y="1" width="${(slots - since) * step + 1}" height="${h - 2}" rx="6"/>`
			: ''
	return `<svg class="k-bars" viewBox="0 0 ${w} ${h}" aria-hidden="true">${frame}<path class="k-bars-base" d="M0 ${h - 1.5}H${w}"/>${bars.join('')}</svg>`
}

// The reader's own map, small: the project in the middle and a branch for each part, which grows with the level.
function youHtml(look, project) {
	const known = look.boxes.filter((box) => box.knows.level === 'said').length
	const [w, h, r] = [300, 150, 56]
	const nodes = look.boxes.map((box, i) => {
		const turn = (i / look.boxes.length) * 2 * Math.PI - Math.PI / 2
		const [x, y] = [w / 2 + r * 1.9 * Math.cos(turn), h / 2 + r * Math.sin(turn)]
		const at = KNOWN.indexOf(box.knows.level)
		return `<g class="k-you-node ${partClass(box.name)} is-${box.knows.level}"><path d="M${w / 2} ${h / 2}L${x} ${y}" stroke-width="${1.5 + at * 1.5}"/><rect x="${x - 26}" y="${y - 10}" width="52" height="20" rx="10"/></g>`
	})
	return `<section class="k-tile">${head('You', 'you', 'Open You')}
		${big(known, `of ${look.boxes.length} parts known`)}
		<svg class="k-you" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(project)} and its ${look.boxes.length} parts, each drawn as far as ken thinks you know it">${nodes.join('')}<circle cx="${w / 2}" cy="${h / 2}" r="13"/></svg>
	</section>`
}

function waitingHtml(followUp, look) {
	const waiting = openCount(followUp, changedParts(look))
	if (waiting === 0) return ''
	return `<button class="k-tile k-waiting" data-act="follow-up" data-key="tile-waiting">${icon('decision')}<span class="k-waiting-words"><b class="k-num">${waiting}</b> ${waiting === 1 ? 'thing waits' : 'things wait'} on you</span>${icon('right')}</button>`
}

// A first visit is one where the reader has opened nothing and ken has recorded nothing of them.
const isFirst = (look, reader) =>
	(reader?.learned.length ?? 0) === 0 && look.boxes.every((box) => box.knows.level === 'new')

// view is { top, home, reader, followUp, concepts, timeline, project, briefOf, first, env }: the top level as the
// server sends it, with the changes it lists, what ken recorded, what is open, what search can find, the commits by
// day when the server has them, the project's name, the briefs the page has read, what plain code read of the
// project, and what the page is doing.
export function startPageHtml(view) {
	const { top, home, project, first } = view
	const drawn = { mapHtml, routeHtml }
	if (!top && first?.kind === 'ok') return `<div class="k-home">${firstVisitHtml({ ...view, look: null }, drawn)}</div>`
	if (!top) {
		const said = home.problem
			? `ken could not read the project. ${esc(home.problem.message)}`
			: 'Reading the project from git.'
		return `<div class="k-home"><p class="k-home-line" role="status">${said}</p></div>`
	}
	const { look, changes } = top
	const lead =
		!look.named || isFirst(look, view.reader)
			? firstVisitHtml({ ...view, look }, drawn)
			: `${firstVisitHtml({ ...view, look, small: true }, drawn)}${startHtml({ look, briefOf: view.briefOf })}`
	return `<div class="k-home">
		${lead}
		${architectureHtml(look)}
		${conceptsHtml(look, view.concepts, home)}
		${processesHtml(view.concepts, view.briefOf, look, view.env)}
		${changesHtml(look, changes, view.timeline)}
		${youHtml(look, project)}
		${waitingHtml(view.followUp, look)}
	</div>`
}
