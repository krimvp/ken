// The home's frame, which is the board: the strip with the ways in, the canvas with the picture, the readout line
// under it, the "Show it another way" bar, and the Detail control over the column beside the picture. The column is the board's own while nothing is picked, and the reading panel once something is.
// Each region is drawn again only when what it shows changed, so a box the reader points at and a text they type stay
// as they are while another region updates.
import { fillDrawings, markPart } from '../draw-diagrams.js'
import { drawPictures } from '../project/parts-picture.js'
import { fill } from '../shell/fill.js'
import { readoutHtml } from './board/readout.js'
import { detailHtml, stripHtml } from './board/strip.js'
import { canvasHtml } from './canvas/canvas.js'
import { fitJobs } from './canvas/part-box.js'
import { redrawBarHtml } from './canvas/redraw-bar.js'
import { inspectorHtml } from './inspector/inspector.js'

// The picture's boxes and arrows are sized from where the page laid them out: after each draw of the canvas, and when
// it changes size. The boxes come first, since the arrows start at their edges.
export function drawCanvas(canvas) {
	fitJobs(canvas)
	drawPictures(canvas)
}

// The readout line alone, for a box the reader points at: nothing else on the home changes with it.
export function showReadout(root, home) {
	fill(root.querySelector('#home-readout'), readoutHtml(home))
}

// Draws the home into root, the element that holds its six regions. env is what the page around the home is doing:
// see inspectorHtml. redraw is called when a diagram in a card has been drawn.
export function showHome(root, home, env, redraw) {
	const region = (name) => root.querySelector(`#home-${name}`)
	fill(region('toolbar'), stripHtml(home))
	fill(region('detail'), detailHtml(home))
	showReadout(root, home)
	const canvas = region('canvas')
	if (fill(canvas, canvasHtml(home, env.rows))) {
		drawCanvas(canvas)
		// The tabs scroll sideways inside their row, so the one on screen is brought into it.
		const tabs = canvas.querySelector('.pic-tabs')
		const on = tabs?.querySelector('[aria-pressed="true"]')
		if (on) tabs.scrollLeft = on.offsetLeft + on.offsetWidth - tabs.clientWidth
	}
	// A drawn picture is drawn again on every pass, so the mark on what the reader picked in it is set again too.
	fillDrawings(canvas, redraw)
	if (home.selected?.kind === 'element') markPart(canvas, home.content.id, home.selected.number)
	fill(region('redraw'), redrawBarHtml(home, env.off))
	// The box holds the reader's words whenever the home does: as typed, and put back after a run that made nothing.
	const box = root.querySelector('#redraw-text')
	if (box.value !== home.redraw.text) box.value = home.redraw.text
	// The panel keeps its place when it is drawn again. With a stop open, that stop stays where it is on screen, also
	// when words arrive over it, as a tour's do a moment after its level. Side by side the panel scrolls, and in one
	// column the page does.
	const inspector = region('inspector')
	const top = () => inspector.querySelector('.path-step.is-on')?.getBoundingClientRect().top ?? null
	const scroll = inspector.querySelector('#insp-scroll')?.scrollTop ?? 0
	const from = top()
	if (fill(inspector, inspectorHtml(home, env))) {
		const now = inspector.querySelector('#insp-scroll')
		if (now) now.scrollTop = scroll
		const moved = from !== null && top() !== null ? top() - from : 0
		if (now && moved !== 0) {
			if (getComputedStyle(now).overflowY === 'visible') window.scrollBy(0, moved)
			else now.scrollTop += moved
		}
	}
	// A drawing that does not fit gives its place to its numbered list, as in a thread.
	const tooWide = fillDrawings(inspector, redraw).filter((id) => !home.ui.tooWide.has(id))
	for (const id of tooWide) home.ui.tooWide.add(id)
	if (tooWide.length > 0) redraw()
}

// The home is off screen: its regions are emptied, so a field the canvas of the Architecture page names alike is the
// only one on the page.
const REGIONS = ['toolbar', 'detail', 'readout', 'canvas', 'redraw', 'inspector']
export function clearHome(root) {
	for (const name of REGIONS) fill(root.querySelector(`#home-${name}`), '')
}
