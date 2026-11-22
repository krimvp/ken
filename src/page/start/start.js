// The Home page: where to start and how things stand, as tiles. A wide "Start here" leads with the first thing ken
// would have the reader look at, and offers the next two. Under it, one tile for each page says its count in a big
// number over a small picture: the architecture filled as far as the reader knows each part, a few concepts worth a
// few minutes, the drawn processes, the commits that landed, and the reader's own map. A tile's picture is pressed
// like the page it stands for. On a first visit "Start here" is the project in two sentences and the path through
// the pages.
import { partId } from '../brief/concept-id.js'
import { KNOWN, levelLabel } from '../home/state/home-state.js'
import { partClass } from '../project/part-colours.js'
import { placeParts } from '../project/parts-picture.js'
import { icon, KIND_ICONS, levelMark } from '../shell/icons.js'
import { count, esc, prose } from '../views/format.js'
import { openCount } from '../views/open.js'

// Concepts the tile lists.
const SHOWN_CONCEPTS = 6
const SHOWN_PROCESSES = 2

// What the button of "Start here" says, by the kind of the thing ken leads with.
const DOES = { stale: 'Show what changed', review: 'Review it', tour: 'Open its brief', read: 'Open its brief' }

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

function startHtml({ look, reader, project }) {
	const items = look.next?.items ?? []
	const first = (reader?.learned.length ?? 0) === 0 && look.boxes.every((box) => box.knows.level === 'new')
	const chip = (item, i) =>
		`<button class="k-chip" data-act="start-go" data-index="${i}" data-key="start-chip-${i}">${icon(item.go.way === 'learn' ? 'architecture' : item.kind === 'review' ? 'merge' : 'changes')}<span>Then: ${prose(item.title)}</span></button>`
	if (first && look.named) {
		const steps = [
			['words', 'In two sentences'],
			['architecture', 'Architecture'],
			['deeper', 'Deeper'],
			['question', 'Questions'],
		].map(
			([name, label], i) =>
				`<li${i === 0 ? ' class="is-on"' : ''}><span class="k-path-dot">${icon(name)}</span>${label}</li>`,
		)
		return `<section class="k-tile k-start is-first" aria-labelledby="start-title">
			<ol class="k-path" aria-label="The way through the pages">${steps.join('')}</ol>
			<div class="k-start-words"><p class="k-eyebrow">Start here</p><h2 id="start-title">${esc(project)}</h2><p class="k-start-why">${prose(look.named.about)}</p>
				<div class="k-then">${items.slice(0, 2).map(chip).join('')}</div></div>
			<button class="k-btn is-big" data-act="go-page" data-page="architecture" data-key="start-primary">See the architecture${icon('right')}</button>
		</section>`
	}
	const [lead, ...rest] = items
	if (!lead) {
		return `<section class="k-tile k-start" aria-labelledby="start-title">
			<div class="k-start-pic">${mapHtml(look, { lit: [], key: 'start-map' })}</div>
			<div class="k-start-words"><p class="k-eyebrow">Start here</p><h2 id="start-title">Nothing new since you looked</h2><p class="k-start-why">${look.named ? 'The architecture is as you left it.' : "ken's model has not named the parts of this project yet."}</p></div>
			<button class="k-btn is-big" data-act="go-page" data-page="architecture" data-key="start-primary">See the architecture${icon('right')}</button>
		</section>`
	}
	const stale = lead.kind === 'stale' ? look.boxes.find((box) => box.name === lead.parts[0])?.knows.since : null
	const badge = stale ? `<span class="k-badge">${icon('changed')}<span class="k-num">${stale}</span></span>` : ''
	return `<section class="k-tile k-start" aria-labelledby="start-title">
		<div class="k-start-pic">${mapHtml(look, { lit: lead.parts, key: 'start-map' })}${badge}</div>
		<div class="k-start-words"><p class="k-eyebrow">Start here</p><h2 id="start-title">${prose(lead.title)}</h2><p class="k-start-why">${prose(lead.why)}</p>
			<div class="k-then">${rest
				.slice(0, 2)
				.map((item, i) => chip(item, i + 1))
				.join('')}</div></div>
		<button class="k-btn is-big" data-act="start-go" data-index="0" data-key="start-primary">${DOES[lead.kind] ?? 'Open it'}${icon('right')}</button>
	</section>`
}

function architectureHtml(look) {
	const opened = look.boxes.filter((box) => box.knows.level !== 'new').length
	const noun = look.named ? 'parts' : 'folders'
	return `<section class="k-tile k-tile-arch">${head('Architecture', 'architecture', 'Open Architecture')}
		${big(opened, `of ${look.boxes.length} ${noun} opened`)}
		${mapHtml(look, { byLevel: true, key: 'arch-map' })}
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
		return `<li><button class="k-chip k-concept" data-act="brief-open" data-concept="${esc(each.id)}" data-key="concept-${i}">${lead}<span class="k-concept-name">${prose(each.name)}</span>${level}</button></li>`
	})
	return `<section class="k-tile k-tile-concepts"><div class="k-tile-head"><h2 class="k-eyebrow">Concepts</h2><span class="k-tile-note">a few minutes each</span></div><ul class="k-concepts">${rows.join('')}</ul></section>`
}

// A process as a line through its stops, each in the colour of its part.
function routeHtml(stops) {
	if (stops.length === 0) return `<span class="k-route is-plain">${icon('processes')}</span>`
	const [w, h] = [128, 40]
	const at = (i) => ({ x: 8 + (i * (w - 16)) / Math.max(stops.length - 1, 1), y: i % 2 === 0 ? 10 : 30 })
	const line = stops.map((_, i) => `${i === 0 ? 'M' : 'L'}${at(i).x} ${at(i).y}`).join('')
	const dots = stops.map(
		(colour, i) => `<rect class="${colour}" x="${at(i).x - 5}" y="${at(i).y - 5}" width="10" height="10" rx="3"/>`,
	)
	return `<svg class="k-route" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${line}"/>${dots.join('')}</svg>`
}

function processesHtml(concepts, briefOf) {
	const drawn = concepts.filter((each) => each.kind === 'process')
	const rows = drawn.slice(0, SHOWN_PROCESSES).map((process, i) => {
		const brief = briefOf(process.id)
		const stops = (brief?.steps ?? []).map((step) =>
			step.part ? partClass(step.part.slice(step.part.lastIndexOf(':') + 1)) : '',
		)
		const steps = brief?.steps ? `<span>${count(brief.steps.length, 'step', 'steps')}</span>` : ''
		return `<li><button class="k-proc" data-act="brief-open" data-concept="${esc(process.id)}" data-key="proc-${i}">${routeHtml(stops)}<span class="k-proc-words"><b>${prose(process.name)}</b>${steps}</span></button></li>`
	})
	const none =
		drawn.length === 0
			? '<p class="k-tile-note">None drawn yet. Ask for one on the Architecture page, with "Draw it another way".</p>'
			: ''
	return `<section class="k-tile">${head('Processes', 'processes', 'Open Processes')}
		${big(drawn.length, 'drawn')}
		<ul class="k-procs">${rows.join('')}</ul>${none}
	</section>`
}

// The commits that landed, as a small chart: one bar a day when the server sends the days, else one bar for each
// span it counts.
function changesHtml(look, changes, timeline) {
	const stale = look.boxes.filter((box) => box.knows.stale)
	const spans = changes.filter((choice) => choice.kind === 'since')
	const title =
		stale.length > 0
			? big(stale.length, `${stale.length === 1 ? 'part' : 'parts'} changed since you looked`)
			: spans.length > 0
				? big(
						spans[0].commits,
						`${spans[0].commits === 1 ? 'commit' : 'commits'} in ${spans[0].name.slice(0, spans[0].name.lastIndexOf(': ')).replace(/^The /, 'the ')}`,
					)
				: big(0, 'commits in the last 90 days')
	const bars =
		timeline?.days.length > 0
			? timeline.days.map((each) => [each.commits, each.day > (timeline.lastVisit ?? '').slice(0, 10)])
			: null
	const [w, h] = [300, 84]
	const chart = bars
		? (() => {
				const most = Math.max(...bars.map(([n]) => n))
				const step = w / bars.length
				return `<svg class="k-bars" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars.map(([n, since], i) => `<rect class="${since ? 'is-since' : ''}" x="${i * step + 1}" y="${h - Math.max(3, (Math.sqrt(n) / Math.sqrt(most)) * (h - 4))}" width="${Math.max(step - 2, 1.5)}" height="${Math.max(3, (Math.sqrt(n) / Math.sqrt(most)) * (h - 4))}" rx="1.500"/>`).join('')}</svg>`
			})()
		: `<ul class="k-spans">${spans
				.map((span) => {
					const most = Math.max(...spans.map((each) => each.commits), 1)
					const days = span.name.match(/\d+ days/)?.[0] ?? span.name
					return `<li><span class="k-span-bar" style="--share:${Math.sqrt(span.commits / most)}"></span><b class="k-num">${span.commits}</b><span>${esc(days)}</span></li>`
				})
				.join('')}</ul>`
	return `<section class="k-tile">${head('Changes', 'changes', 'Open Changes')}${title}${chart}</section>`
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

function waitingHtml(followUp) {
	const waiting = openCount(followUp)
	if (waiting === 0) return ''
	return `<button class="k-tile k-waiting" data-act="follow-up" data-key="tile-waiting">${icon('decision')}<span class="k-waiting-words"><b class="k-num">${waiting}</b> ${waiting === 1 ? 'thing waits' : 'things wait'} on you</span>${icon('right')}</button>`
}

// view is { top, home, reader, followUp, concepts, timeline, project, briefOf }: the top level as the server sends
// it, with the changes it lists, what ken recorded, what is open, what search can find, the commits by day when the
// server has them, the project's name, and the briefs the page has read.
export function startPageHtml(view) {
	const { top, home, project } = view
	if (!top) {
		const said = home.problem
			? `ken could not read the project. ${esc(home.problem.message)}`
			: 'Reading the project from git.'
		return `<div class="k-home"><p class="k-home-line" role="status">${said}</p></div>`
	}
	const { look, changes } = top
	return `<div class="k-home">
		${startHtml({ look, reader: view.reader, project })}
		${architectureHtml(look)}
		${conceptsHtml(look, view.concepts, home)}
		${processesHtml(view.concepts, view.briefOf)}
		${changesHtml(look, changes, view.timeline)}
		${youHtml(look, project)}
		${waitingHtml(view.followUp)}
	</div>`
}
