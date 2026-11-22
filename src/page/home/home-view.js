// The home's frame: the toolbar with the two controls, the canvas, the "Show it another way" bar, the panel beside the
// picture, and the "Ask ken" drawer over it. Each region is drawn again only when what it shows changed, so a box the
// reader points at and a text they type stay as they are while another region updates.
import { fillDrawings, markPart } from '../draw-diagrams.js'
import { drawPictures } from '../project/parts-picture.js'
import { count, esc } from '../views/format.js'
import { canvasHtml } from './canvas/canvas.js'
import { redrawBarHtml } from './canvas/redraw-bar.js'
import { askDrawerHtml } from './inspector/ask-drawer.js'
import { inspectorHtml } from './inspector/inspector.js'
import { shownDetail } from './state/content.js'
import { DETAILS, WAYS } from './state/home-state.js'

// The second line of "Catch up": the span on screen while the reader catches up, and before that the first span ken
// found commits in.
function catchUpFact(home) {
	const { look, changes, suggestion } = home
	if (home.wayIn !== 'catch-up' || !look?.change) return suggestion?.facts['catch-up'] ?? null
	const commits = count(look.change.commits.length + look.change.moreCommits, 'commit', 'commits')
	const picked = changes.find((choice) => choice.kind === 'since' && choice.change === look.change.asked)
	const span = picked ? picked.name.slice(0, picked.name.lastIndexOf(': ')) : look.change.name
	return `${commits} ${span.replace(/^The last/, 'in the last').replace(/^./, (c) => c.toLowerCase())}`
}

// The two controls, each a group of three buttons with one pressed. A way in carries one live fact from git. On a
// level of folders the detail control waits: there is nothing finer to show until the parts have names, so its
// buttons are greyed and out of the tab order, and one line says why.
function toolbarHtml(home) {
	const facts = { ...home.suggestion?.facts, 'catch-up': catchUpFact(home) }
	const ways = Object.entries(WAYS).map(
		([way, text]) =>
			`<button class="seg" data-act="way-in" data-way="${way}" data-key="way-${way}" aria-pressed="${home.wayIn === way}"><span class="seg-text">${text}</span>${facts[way] ? `<span class="seg-fact">${esc(facts[way])}</span>` : ''}</button>`,
	)
	const waits = Boolean(home.look) && !home.look.named
	const shown = shownDetail(home)
	const details = Object.entries(DETAILS).map(
		([detail, text]) =>
			`<button class="seg" data-act="detail" data-detail="${detail}" data-key="detail-${detail}" aria-pressed="${!waits && shown === detail}"${waits ? ' disabled' : ''}><span class="seg-text">${text}</span></button>`,
	)
	return `<div class="control" role="group" aria-labelledby="way-label"><span class="control-label" id="way-label">Way in</span><div class="segs">${ways.join('')}</div></div>
		<div class="control${waits ? ' is-waiting' : ''}" role="group" aria-labelledby="detail-label"${waits ? ' aria-describedby="detail-waits"' : ''}><span class="control-label" id="detail-label">Detail</span><div class="segs">${details.join('')}</div>${waits ? `<span class="control-note small" id="detail-waits">Detail opens once ken's model has named the parts.</span>` : ''}</div>`
}

const drawn = new WeakMap()

// Draws a region again when what it shows changed. A list the reader unfolded stays unfolded: each is known by its
// key, or by the words of its line.
function fill(region, html) {
	if (drawn.get(region) === html) return false
	const key = (details) => details.dataset.key ?? details.querySelector('summary')?.textContent
	const open = new Set([...region.querySelectorAll('details[open]')].map(key))
	region.innerHTML = html
	for (const details of region.querySelectorAll('details')) if (open.has(key(details))) details.open = true
	drawn.set(region, html)
	return true
}

// Draws the home into root, the element that holds its five regions. env is what the page around the home is doing:
// see inspectorHtml. redraw is called when a diagram in a card has been drawn.
export function showHome(root, home, env, redraw) {
	const region = (name) => root.querySelector(`#home-${name}`)
	fill(region('toolbar'), toolbarHtml(home))
	const canvas = region('canvas')
	if (fill(canvas, canvasHtml(home, env.rows))) {
		drawPictures(canvas)
		// The tabs scroll sideways inside their row, so the one on screen is brought into it.
		const tabs = canvas.querySelector('.pic-tabs')
		const on = tabs?.querySelector('[aria-pressed="true"]')
		if (on) tabs.scrollLeft = on.offsetLeft + on.offsetWidth - tabs.clientWidth
	}
	// A drawn picture is drawn again on every pass, so the mark on what the reader picked in it is set again too.
	fillDrawings(canvas, redraw)
	if (home.selected?.kind === 'element') markPart(canvas, home.content.id, home.selected.number)
	if (fill(region('redraw'), redrawBarHtml(home, env.off))) root.querySelector('#redraw-text').value = home.redraw.text
	// The panel keeps its place when it is drawn again. With a stop open, that stop stays where it is on screen, also
	// when words arrive over it, as a tour's do a moment after its level.
	const inspector = region('inspector')
	const open = () => inspector.querySelector('.path-step.is-on')
	const scroll = inspector.querySelector('#insp-scroll')?.scrollTop ?? 0
	const from = open()?.offsetTop ?? null
	inspector.hidden = home.askOpen
	if (fill(inspector, inspectorHtml(home, env))) {
		const now = inspector.querySelector('#insp-scroll')
		const to = open()?.offsetTop ?? null
		if (now) now.scrollTop = from !== null && to !== null ? scroll + to - from : scroll
	}
	// A drawing that does not fit gives its place to its numbered list, as in a thread.
	const tooWide = fillDrawings(inspector, redraw).filter((id) => !home.ui.tooWide.has(id))
	for (const id of tooWide) home.ui.tooWide.add(id)
	if (tooWide.length > 0) redraw()
	const ask = region('ask')
	ask.hidden = !home.askOpen
	if (fill(ask, home.askOpen ? askDrawerHtml(home, env) : '') && home.askOpen) {
		root.querySelector('#ask-text').value = home.askText
	}
}
