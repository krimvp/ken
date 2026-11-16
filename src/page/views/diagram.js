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

// The title, then the drawing, then one line that says who drew it and opens the numbered list. A drawing that does not
// fit the column at its smallest text gives its place to the list, with a way to see it anyway. On a narrow screen each
// part of the list folds to its words, and its quotes open under it.
export function diagramHtml(diagram, index, rows) {
	const { ui } = rows
	const title = `diagram-${index}-title`
	const instead = ui.tooWide.has(index) && !ui.drawingsShown.has(index)
	const open = instead || ui.openParts.has(index)
	const said = `Drawn by ken's model. ken did not check the arrows. ${NUMBERS[diagram.kind] ?? ''}`
	const toggle = instead
		? `<p class="parts-toggle">The drawing is wider than your screen, so its ${diagram.elements.length} parts are listed here. <button class="link" data-act="drawing" data-diagram="${index}" data-key="drawing-${index}">See the drawing</button></p>`
		: `<p class="caption parts-toggle">${said} <button class="link" data-act="parts" data-diagram="${index}" data-key="parts-${index}" aria-expanded="${open}">${open ? 'Hide the list' : `List the ${diagram.elements.length} parts and their quotes`}</button></p>`
	return `<section class="diagram" aria-labelledby="${title}">
		<h3 class="diagram-title" id="${title}">${label(diagram.label)}${prose(diagram.title)}</h3>
		<div class="drawing-frame"${instead ? ' hidden' : ''}><div class="drawing" data-diagram="${index}" data-mermaid="${esc(diagram.mermaid)}" role="img" aria-label="Diagram: ${esc(diagram.title)}. The numbered list says the same in words."></div></div>
		<p class="drawing-hint">The drawing is wider than the screen. Scroll it sideways to see the rest.</p>
		${toggle}
		${open ? `<ol class="elements">${diagram.elements.map((element) => elementHtml(element, diagram, index, rows)).join('')}</ol>` : ''}
	</section>`
}

function elementHtml(element, diagram, index, rows) {
	const { ui } = rows
	const key = elementKey(index, element.number)
	const own = element.label !== null && element.label !== diagram.label ? label(element.label) : ''
	const n = element.quotes.length
	const shown = ui.wide || ui.openElements.has(key) || [...ui.openQuotes].some((each) => each.startsWith(`${key}-q`))
	const more =
		n === 0 || shown
			? ''
			: ` <button class="link small nowrap" data-act="element" data-item="${key}" data-key="el-${key}">${n === 1 ? 'Show its quote' : `Show its ${n} quotes`}</button>`
	return `<li class="st${shown ? '' : ' folded'}" id="item-${key}">
		<span class="st-n">${element.number}</span>
		<div>
			<p class="st-text">${own}${prose(element.text)}${more}</p>
			${shown && n > 0 ? quoteRows(element.quotes, key, rows) : ''}
		</div>
	</li>`
}
