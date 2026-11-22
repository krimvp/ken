// The Processes page: the processes ken has drawn, as small pictures in a row, and the chosen one large. Large, a
// process is lanes, one for each part it passes through, in the part's colour and with what ken thinks the reader
// knows of it, and its steps run left to right, numbered. A switch shows the same steps on the map of the parts
// instead. Beside the row are the processes ken offers to draw, and a box to ask for any other drawing.
import { partId, processId, readConcept, stepId } from '../brief/concept-id.js'
import { levelLabel } from '../level/level-state.js'
import { partClass } from '../project/part-colours.js'
import { placeParts } from '../project/parts-picture.js'
import { icon, levelMark } from '../shell/icons.js'
import { routeHtml } from '../start/start.js'
import { count, esc, prose, RUN_COST } from '../views/format.js'

// Offered when the level was named before ken listed the processes worth drawing.
const FIXED_OFFERS = ['Follow one request through the code', 'How the project starts up']

const nameOf = (id) => (id ? (readConcept(id)?.name ?? '') : '')

// The lanes of a process: one for each part it passes through, in the order it first gets there, and one for each
// participant ken found no part for. A step stands in the lane of the part its quoted lines are in, else of the
// participant that starts it.
export function lanesOf(process) {
	const lanes = []
	const laneOf = (part, name) => {
		const at = lanes.findIndex((lane) => (part ? lane.part === part : lane.part === null && lane.name === name))
		if (at >= 0) return at
		lanes.push({ part, name: part ? nameOf(part) : name })
		return lanes.length - 1
	}
	const steps = process.messages.map((message) => {
		const from = process.lanes[message.from]
		return { ...message, lane: laneOf(message.part ?? from?.part ?? null, from?.name ?? '') }
	})
	return { lanes, steps }
}

function galleryHtml(list, at) {
	return list
		.map((process, i) => {
			const stops = process.messages.map((message) => partClass(nameOf(message.part)))
			return `<li><button class="k-proc-card" data-act="proc-pick" data-id="${esc(process.id)}" data-key="proc-card-${i}" aria-pressed="${process.id === at}">${routeHtml(stops)}<span class="k-proc-words"><b>${prose(process.name)}</b><span>${count(process.steps, 'step', 'steps')}, drawn ${esc(dayName(process.drawn))}</span></span></button></li>`
		})
		.join('')
}

const dayName = (day) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// The offers to draw one more, and the box to ask for any other drawing. off is why no run can start now, or null.
function drawHtml(procs, offers, off) {
	const chips = offers.map(
		(text, i) =>
			`<li><button class="k-offer" data-act="proc-offer" data-index="${i}" data-key="proc-offer-${i}"${off ? ' disabled' : ''}>${icon('plus')}<span>${esc(text)}</span></button></li>`,
	)
	return `<section class="k-proc-draw" aria-labelledby="proc-draw-title">
		<h2 class="k-eyebrow" id="proc-draw-title">ken can draw</h2>
		<ul class="k-offers">${chips.join('')}</ul>
		<form class="k-proc-ask" id="proc-draw-form" autocomplete="off">
			<label class="visually-hidden" for="proc-draw-text">Ask for another drawing</label>
			<input id="proc-draw-text" name="text" data-key="proc-draw-text" maxlength="300" placeholder="Or say what to draw" />
			<button class="k-btn" type="submit" data-key="proc-draw-send"${off ? ' disabled' : ''}>Draw it</button>
		</form>
		<p class="k-muted k-proc-cost">${esc(off ?? RUN_COST)}</p>
		${procs.problem ? `<p class="k-ask-problem" role="alert">${esc(procs.problem)}</p>` : ''}
	</section>`
}

function laneHead(lane, look, home) {
	const box = lane.part ? look?.boxes.find((each) => each.name === lane.name) : null
	const level = box
		? `<span class="k-lane-level">${levelMark(box.knows.level, 14)}<span>${esc(levelLabel(home, box.knows.level))}</span></span>`
		: '<span class="k-lane-level">No part</span>'
	const name = lane.part
		? `<button class="k-lane-name" data-act="brief-open" data-concept="${esc(lane.part)}" data-key="lane-${esc(lane.name)}">${esc(lane.name)}</button>`
		: `<span class="k-lane-name">${esc(lane.name)}</span>`
	return `<div class="k-lane-head">${name}${level}</div>`
}

function lanesHtml(process, look, home) {
	const { lanes, steps } = lanesOf(process)
	const rows = lanes.map((lane, l) => {
		const colour = lane.part ? partClass(lane.name) : 'is-plain'
		const cells = steps.map((step) =>
			step.lane === l
				? `<button class="k-step ${colour}" data-act="brief-open" data-concept="${esc(stepId(process.id, step.n))}" data-key="step-${step.n}" data-n="${step.n}" style="grid-row:${l + 1};grid-column:${step.n + 1}"><b class="k-step-n k-num">${step.n}</b><span>${prose(step.line)}</span></button>`
				: '',
		)
		return `<div class="k-lane ${colour}" style="grid-row:${l + 1}">${laneHead(lane, look, home)}</div>${cells.join('')}`
	})
	return `<div class="k-lanes-scroll"><div class="k-lanes" style="--steps:${steps.length};--lanes:${lanes.length}">${rows.join('')}<svg class="k-lane-links" aria-hidden="true"></svg></div></div>`
}

// The same steps on the map of the parts: the parts it passes through lit, each with the numbers of its steps, and a
// line through them in order.
function mapHtml(process, look) {
	if (!look) return '<p class="k-muted">Reading the parts.</p>'
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)]).filter(([a, b]) => a >= 0 && b >= 0)
	const placed = placeParts(look.boxes.length, links)
	const stepsIn = look.boxes.map(() => [])
	const route = []
	for (const message of process.messages) {
		const i = at(nameOf(message.part ?? process.lanes[message.from]?.part))
		if (i < 0) continue
		stepsIn[i].push(message.n)
		if (route.at(-1) !== i) route.push(i)
	}
	const mid = (i) => `${placed.cells[i].col * 100 + 50} ${placed.cells[i].row * 100 + 50}`
	const line = route.map((i, k) => `${k === 0 ? 'M' : 'L'}${mid(i)}`).join('')
	const blocks = look.boxes.map((box, i) => {
		const cell = placed.cells[i]
		const numbers = stepsIn[i].map(
			(n) =>
				`<button class="k-route-n k-num" data-act="brief-open" data-concept="${esc(stepId(process.id, n))}" data-key="route-${n}" aria-label="Step ${n}">${n}</button>`,
		)
		const lit = numbers.length > 0
		return `<div class="k-route-blk ${partClass(box.name)}${lit ? ' is-lit' : ''}" style="--r:${cell.row + 1};--c:${cell.col + 1}"><button class="k-route-name" data-act="brief-open" data-concept="${esc(partId(look.within, box.name))}" data-key="route-part-${i}">${esc(box.name)}</button><span class="k-route-ns">${numbers.join('')}</span>${lit ? '' : '<span class="k-route-none">Not on this process</span>'}</div>`
	})
	return `<div class="k-route-map" style="--cols:${placed.cols};--rows:${placed.rows}"><svg viewBox="0 0 ${placed.cols * 100} ${placed.rows * 100}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}"/></svg>${blocks.join('')}</div>`
}

function workingHtml(run, env) {
	const tools = env.running.q.steps.filter((step) => step.kind === 'tool').length
	return `<div class="k-proc-empty" role="status"><span class="k-spin" aria-hidden="true"></span><h2>ken's model is drawing "${esc(run.text)}"</h2><p class="k-muted k-num k-clock">${Math.round(env.seconds)} s so far, ${count(tools, 'action', 'actions')}</p><button class="k-btn is-quiet" data-act="stop" data-key="proc-stop">Stop</button></div>`
}

// procs is the page's state: { list, offers, at, view, problem }. look is the top level, for the parts' colours,
// levels and the map. env says what the page is doing.
export function processesPageHtml({ procs, look, home, env }) {
	if (procs.list === null)
		return '<div class="k-procs-page"><p class="k-home-line" role="status">Reading the drawn processes.</p></div>'
	const offers = procs.offers.length > 0 ? procs.offers : FIXED_OFFERS
	const run = env.running?.onHome?.kind === 'draw' ? env.running.onHome : null
	const process = procs.list.find((each) => each.id === procs.at) ?? null
	const draw = drawHtml(procs, offers, env.off)
	if (procs.list.length === 0) {
		const empty = run
			? workingHtml(run, env)
			: `<div class="k-proc-empty">${icon('processes')}<h2>ken has not drawn a process yet</h2><p>A process is one path through the parts, step by step, each step on the lines of code it rests on. Pick one ken offers, or say what to draw.</p></div>`
		return `<div class="k-procs-page is-empty"><section class="k-tile k-proc-big">${empty}</section>${draw}</div>`
	}
	const switcher = ['lanes', 'map'].map(
		(view) =>
			`<button data-act="proc-view" data-view="${view}" data-key="proc-view-${view}" aria-pressed="${procs.view === view}">${icon(view === 'lanes' ? 'layers' : 'architecture')}${view === 'lanes' ? 'As lanes' : 'On the map'}</button>`,
	)
	const big = run
		? workingHtml(run, env)
		: process
			? `<div class="k-proc-head"><h2 id="proc-title">${prose(process.name)}</h2><button class="k-chip" data-act="brief-open" data-concept="${esc(processId(process.id))}" data-key="proc-brief">${icon('clock')}Its brief</button><span class="k-seg" role="group" aria-label="How to show it">${switcher.join('')}</span></div>
			${procs.view === 'map' ? mapHtml(process, look) : lanesHtml(process, look, home)}
			<p class="k-proc-hint">Press a numbered step for its brief and its lines of code.</p>`
			: ''
	return `<div class="k-procs-page">
		<ul class="k-proc-gallery" aria-label="The drawn processes">${galleryHtml(procs.list, procs.at)}</ul>
		${draw}
		<section class="k-tile k-proc-big" aria-labelledby="proc-title">${big}</section>
	</div>`
}

// The lines from each step to the next, drawn once the steps are laid out: out of the right side of one, down or up
// between the two, and into the left side of the next.
export function drawLaneLinks(page) {
	const grid = page.querySelector('.k-lanes')
	const svg = grid?.querySelector('.k-lane-links')
	if (!svg) return
	const origin = grid.getBoundingClientRect()
	const boxes = [...grid.querySelectorAll('.k-step')]
		.sort((a, b) => Number(a.dataset.n) - Number(b.dataset.n))
		.map((step) => {
			const box = step.getBoundingClientRect()
			return {
				left: box.left - origin.left,
				right: box.right - origin.left,
				mid: box.top - origin.top + box.height / 2,
			}
		})
	svg.setAttribute('viewBox', `0 0 ${grid.scrollWidth} ${grid.scrollHeight}`)
	svg.setAttribute('width', grid.scrollWidth)
	svg.setAttribute('height', grid.scrollHeight)
	const paths = boxes.slice(1).map((to, k) => {
		const from = boxes[k]
		const turn = (from.right + to.left) / 2
		return `<path d="M${from.right} ${from.mid}H${turn}V${to.mid}H${to.left - 6}"/><path class="k-head" d="M${to.left - 9} ${to.mid - 5}L${to.left - 2} ${to.mid}L${to.left - 9} ${to.mid + 5}z"/>`
	})
	svg.innerHTML = paths.join('')
}
