// A diagram in the answer: its title and label, the drawing, and under it one numbered row per box and arrow with the
// rows of the lines it quotes. The rows are also the text version of the drawing.
import { esc, label, prose, quoteRows } from './format.js'

// The key of a diagram element in the page's list of things that carry quotes, beside "d0" and "s3".
export function elementKey(index, number) {
	return `g${index}n${number}`
}

// Only a sequence diagram numbers its messages in the order they happen. Elsewhere a number only names a part.
const NUMBERS = {
	sequence: 'Each number opens its quote.',
	component: 'Each number names a part and opens its quote.',
	'entity-relationship': 'Each number names a part and opens its quote.',
}

// The link to the numbered list sits above the drawing, so a tall drawing does not hide the way to its quotes. The list
// itself folds under the drawing. A box or an arrow opens its quote all the same.
export function diagramHtml(diagram, index, rows) {
	const title = `diagram-${index}-title`
	const open = rows.ui.openParts.has(index)
	const toggle = `<button class="link small" data-act="parts" data-diagram="${index}" data-key="parts-${index}" aria-expanded="${open}">${open ? 'Hide the list' : `List the ${diagram.elements.length} parts and their quotes`}</button>`
	return `<section class="diagram" aria-labelledby="${title}">
		<p class="caption">The agent's diagram. The arrows are not checked. ${NUMBERS[diagram.kind] ?? ''}</p>
		<h3 class="diagram-title" id="${title}">${label(diagram.label)}${prose(diagram.title)}</h3>
		<p class="parts-toggle">${toggle}</p>
		<p class="drawing-hint">The diagram is wider than the screen. Scroll it sideways to see the rest.</p>
		<div class="drawing-frame"><div class="drawing" data-diagram="${index}" data-mermaid="${esc(diagram.mermaid)}" role="img" aria-label="Diagram: ${esc(diagram.title)}. The numbered list says the same in words."></div></div>
		${open ? `<ol class="elements">${diagram.elements.map((element) => elementHtml(element, diagram, index, rows)).join('')}</ol>` : ''}
	</section>`
}

function elementHtml(element, diagram, index, rows) {
	const key = elementKey(index, element.number)
	const own = element.label !== null && element.label !== diagram.label ? label(element.label) : ''
	return `<li class="st" id="item-${key}">
		<span class="st-n">${element.number}</span>
		<div>
			<p class="st-text">${own}${prose(element.text)}</p>
			${element.quotes.length > 0 ? quoteRows(element.quotes, key, rows) : ''}
		</div>
	</li>`
}
