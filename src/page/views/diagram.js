// A diagram card: its title and label, the drawing, and under it one numbered row per box and arrow with the rows of
// the lines it quotes. The rows are also the text version of the drawing. id names the diagram in the thread.
import { esc, label, prose, quoteRows } from './format.js'

// The key of a diagram element in the page's list of things that carry quotes, beside the keys of the cards.
export function elementKey(id, number) {
	return `g${id}n${number}`
}

// Only a sequence diagram numbers its messages in the order they happen. Elsewhere a number only names a part. When
// some numbers have no quote, the caption says which ones open.
const NUMBERS = {
	sequence: ['Each number opens its quote.', 'A numbered arrow with a quote opens it.'],
	component: [
		'Each number names a part and opens its quote.',
		'Each number names a part. A number with a quote opens it.',
	],
	'entity-relationship': [
		'Each number names a part and opens its quote.',
		'Each number names a part. A number with a quote opens it.',
	],
}

// The title, then the drawing, then one line that says who drew it and opens the numbered list. On a phone, a drawing
// that does not fit the column at its smallest text gives its place to the list, with a way to see it anyway: the list then shows the
// boxes, and the arrows behind one link, so the rest of the reply comes sooner. On a narrow screen each part of the
// list folds to its words, and its quotes open under it.
export function diagramHtml(diagram, id, rows) {
	const { ui } = rows
	const title = `diagram-${id}-title`
	const instead = ui.tooWide.has(id) && !ui.drawingsShown.has(id)
	const open = instead || ui.openParts.has(id)
	const every = diagram.elements.every((element) => element.quotes.length > 0)
	const said = `ken's model chose the parts. ken found the lines each arrow quotes. ${NUMBERS[diagram.kind]?.[every ? 0 : 1] ?? ''}`
	const arrowsShown = !instead || ui.openParts.has(id)
	const listed = arrowsShown ? diagram.elements : diagram.elements.filter((element) => element.label === null)
	const arrows = diagram.elements.length - diagram.elements.filter((element) => element.label === null).length
	const toggle = instead
		? `<p class="parts-toggle">The drawing is wider than your screen, so its parts are listed here. <button class="link" data-act="drawing" data-diagram="${id}" data-key="drawing-${id}">See the drawing</button></p>`
		: `<p class="caption parts-toggle">${said} <button class="link" data-act="parts" data-diagram="${id}" data-key="parts-${id}" aria-expanded="${open}">${open ? 'Hide the list' : `List the ${diagram.elements.length} parts and their quotes`}</button></p>`
	return `<section class="diagram" aria-labelledby="${title}">
		<h3 class="diagram-title" id="${title}">${label(diagram.label)}${prose(diagram.title)}</h3>
		<div class="drawing-frame"${instead ? ' hidden' : ''}><div class="drawing" data-diagram="${id}" data-mermaid="${esc(diagram.mermaid)}" role="img" aria-label="Diagram: ${esc(diagram.title)}. The numbered list says the same in words."></div></div>
		<p class="drawing-hint">The drawing is wider than the screen. Scroll it sideways to see the rest.</p>
		${toggle}
		${open ? `<ol class="elements">${listed.map((element) => elementHtml(element, diagram, id, rows)).join('')}</ol>` : ''}
		${instead && arrows > 0 ? `<p class="parts-more"><button class="link" data-act="parts" data-diagram="${id}" data-key="arrows-${id}" aria-expanded="${arrowsShown}">${arrowsShown ? 'Hide the arrows' : `Show the ${arrows} arrows`}</button></p>` : ''}
	</section>`
}

function elementHtml(element, diagram, id, rows) {
	const { ui } = rows
	const key = elementKey(id, element.number)
	const own = element.label !== null && element.label !== diagram.label ? label(element.label) : ''
	const n = element.quotes.length
	const shown = ui.wide || ui.openElements.has(key) || [...ui.openQuotes].some((each) => each.startsWith(`${key}-q`))
	const more =
		n === 0 || shown
			? ''
			: `<p class="el-more"><button class="link small" data-act="element" data-item="${key}" data-key="el-${key}">${n === 1 ? 'Show its quote' : `Show its ${n} quotes`}</button></p>`
	return `<li class="st${shown ? '' : ' folded'}" id="item-${key}">
		<span class="st-n">${element.numbered ? element.number : ''}</span>
		<div>
			<p class="st-text">${own}${prose(element.text)}</p>${more}
			${shown && n > 0 ? quoteRows(element.quotes, key, rows) : ''}
		</div>
	</li>`
}
