// A diagram in the answer: its title and label, the drawing, and under it one numbered row per box and arrow with the
// rows of the lines it quotes. The rows are also the text version of the drawing.
import { esc, label, prose, quoteRows } from './format.js'

// The key of a diagram element in the page's list of things that carry quotes, beside "d0" and "s3".
export function elementKey(index, number) {
	return `g${index}n${number}`
}

export function diagramHtml(diagram, index, ui) {
	const title = `diagram-${index}-title`
	return `<section class="diagram" aria-labelledby="${title}">
		<p class="caption">The agent's diagram. ken found each quote; it did not check what the arrows say.</p>
		<h3 class="diagram-title" id="${title}">${label(diagram.label)}${prose(diagram.title)}</h3>
		<div class="drawing-frame"><div class="drawing" data-diagram="${index}" data-mermaid="${esc(diagram.mermaid)}" role="img" aria-label="Diagram: ${esc(diagram.title)}. The numbered list under it says the same in words."></div></div>
		<p class="drawing-hint">The diagram is wider than the screen. Scroll it sideways to see the rest.</p>
		<ol class="elements">${diagram.elements.map((element) => elementHtml(element, diagram, index, ui)).join('')}</ol>
	</section>`
}

function elementHtml(element, diagram, index, ui) {
	const key = elementKey(index, element.number)
	const own = element.label !== null && element.label !== diagram.label ? label(element.label) : ''
	return `<li class="st" id="item-${key}">
		<span class="st-n">${element.number}</span>
		<div>
			<p class="st-text">${own}${prose(element.text)}</p>
			${element.quotes.length > 0 ? quoteRows(element.quotes, key, ui) : ''}
		</div>
	</li>`
}
