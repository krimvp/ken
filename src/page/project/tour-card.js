// A tour opens on a picture of the level it tours: each part with its stop's number, a mark once the reader reached
// it, and the stop the reader is on lit. A part opens its stop. Plain code picked the order from the arrows, so the
// card says once how. The stops sit under the picture, as the steps of a change do, and the picture places the parts as the Project view does.
import { count, esc } from '../views/format.js'
import { partClass } from './part-colours.js'
import { pictureHtml } from './parts-picture.js'
import { stepParts, stopState, walkHtml } from './walk.js'

// The key the page keeps the look of a tour's level under.
export function tourKey(tour) {
	return `tour:${tour.within.join('\n')}`
}

// look is the toured level at HEAD, null while ken reads it, or { problem }. walk holds the stops, the stop the reader
// is on, the reader's map on the reply's topics, and how to draw a card and "I know this part".
export function tourCardHtml(tour, look, t, walk) {
	const boxes = look?.boxes ?? null
	const on = walk.steps.find((step) => step.number === walk.at)
	const lit = on && boxes ? stepParts(on, boxes) : new Set()
	const seen = walk.steps.filter((step) => stopState(step, walk.states) !== 'new').length
	const level = tour.within.length === 0 ? 'the whole project' : 'this part'
	const said =
		seen === 0
			? `${count(walk.steps.length, 'stop', 'stops')}, one per part.`
			: `You have seen ${seen} of the ${walk.steps.length} stops.`
	return `<section class="change-card tour-card has-walk" aria-labelledby="tc-${t}">
		<h3 class="cc-title" id="tc-${t}">A tour of ${level}</h3>
		<p class="cc-line">${said} ken picked the order from the arrows: it starts at the part nothing else uses and goes inward. Tests, build and vendored parts come last.</p>
		${pictureOf(look, t, walk, lit)}
		${walkHtml(walk.steps, t, { ...walk, boxes, change: null, tour: true })}
	</section>`
}

function pictureOf(look, t, walk, lit) {
	if (look === null) return '<p class="cc-line">Reading the parts of the project.</p>'
	if (look.problem) return `<p class="cc-line">ken could not read the parts: ${esc(look.problem)}</p>`
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => ({ from: at(arrow.from), to: at(arrow.to) }))
	const cells = look.boxes.map((box) => {
		const k = walk.steps.findIndex((step) => step.part === box.name)
		const step = walk.steps[k]
		const stood = step ? stopState(step, walk.states) : 'new'
		const mark = !step ? '' : stood === 'new' ? `Stop ${k + 1}` : `Stop ${k + 1}, seen`
		const body = `<span class="pv-name">${esc(box.name)}</span>${mark ? `<span class="tc-stop">${mark}</span>` : ''}`
		const classes = `pv-box cc-box tc-box is-${stood} ${partClass(box.name)}`
		const html = step
			? `<button class="${classes}" data-act="walk-step" data-turn="${t}" data-step="${step.number}" data-key="tc-${t}-${step.number}">${body}</button>`
			: `<div class="${classes}">${body}</div>`
		return { html, classes: 'pv-cell' }
	})
	return pictureHtml(cells, links, { numbered: false, open: new Set(), lit, still: true })
}
