// The home's frame: the toolbar with the two controls, the canvas, the "Show it another way" bar, the inspector, and
// the "Ask ken" drawer over it. Each region is drawn again only when what it shows changed, so a box the reader points
// at and a text they type stay as they are while another region updates.
import { fillDrawings } from '../draw-diagrams.js'
import { drawPictures } from '../project/parts-picture.js'
import { esc } from '../views/format.js'
import { askDrawerHtml } from './ask-drawer.js'
import { canvasHtml } from './canvas.js'
import { shownDetail } from './content.js'
import { DETAILS, inspectorHtml } from './inspector.js'
import { redrawBarHtml } from './redraw-bar.js'

const WAYS = [
	['learn', 'Learn the project'],
	['catch-up', 'Catch up'],
	['review', 'Review a change'],
]

// The two controls, each a group of three buttons with one pressed. A way in carries one live fact from git. On a
// level of folders the detail control waits: there is nothing finer to show until the parts have names.
function toolbarHtml(home) {
	const facts = home.suggestion?.facts ?? {}
	const ways = WAYS.map(
		([way, text]) =>
			`<button class="seg" data-act="way-in" data-way="${way}" data-key="way-${way}" aria-pressed="${home.wayIn === way}"><span class="seg-text">${text}</span>${facts[way] ? `<span class="seg-fact">${esc(facts[way])}</span>` : ''}</button>`,
	)
	const waits = Boolean(home.look) && !home.look.named
	const shown = shownDetail(home)
	const details = Object.entries(DETAILS).map(
		([detail, text]) =>
			`<button class="seg" data-act="detail" data-detail="${detail}" data-key="detail-${detail}" aria-pressed="${shown === detail}"${waits ? ' disabled' : ''}><span class="seg-text">${text}</span></button>`,
	)
	return `<div class="control" role="group" aria-labelledby="way-label"><span class="control-label" id="way-label">Way in</span><div class="segs">${ways.join('')}</div></div>
		<div class="control" role="group" aria-labelledby="detail-label"><span class="control-label" id="detail-label">Detail</span><div class="segs">${details.join('')}</div>${waits ? `<span class="control-note small">Detail opens once ken's model has named the parts.</span>` : ''}</div>`
}

const drawn = new WeakMap()

function fill(region, html) {
	if (drawn.get(region) === html) return false
	region.innerHTML = html
	drawn.set(region, html)
	return true
}

// Draws the home into root, the element that holds its five regions. env is what the page around the home is doing:
// see inspectorHtml. redraw is called when a diagram in a card has been drawn.
export function showHome(root, home, env, redraw) {
	const region = (name) => root.querySelector(`#home-${name}`)
	fill(region('toolbar'), toolbarHtml(home))
	if (fill(region('canvas'), canvasHtml(home, env.rows))) drawPictures(region('canvas'))
	if (fill(region('redraw'), redrawBarHtml(home, env.off))) root.querySelector('#redraw-text').value = home.redraw.text
	const inspector = region('inspector')
	const scroll = inspector.querySelector('#insp-scroll')?.scrollTop ?? 0
	inspector.hidden = home.askOpen
	if (fill(inspector, inspectorHtml(home, env))) {
		const now = inspector.querySelector('#insp-scroll')
		if (now) now.scrollTop = scroll
		fillDrawings(inspector, redraw)
	}
	const ask = region('ask')
	ask.hidden = !home.askOpen
	if (fill(ask, home.askOpen ? askDrawerHtml(home, env) : '') && home.askOpen) {
		root.querySelector('#ask-text').value = home.askText
	}
}
