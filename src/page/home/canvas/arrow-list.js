// The arrows of a level as sentences, under the numbers the picture shows on them: "Tests runs scenarios through Eval
// harness". The picture can only fit a few words on an arrow, and on a phone only its number, so this list says each
// one in full. A row opens the line of code its arrow rests on.
import { esc, quoteBody } from '../../views/format.js'
import { colourOf } from '../state/home-state.js'

// name limits the list to the arrows that start or end at one part, and null lists them all. open shows every
// arrow's line, where the reader came for the code. where names the copy, so two on one page keep their own keys.
export function arrowListHtml(home, name, { open = false, where }) {
	const { look } = home
	const colour = colourOf(home)
	const part = (each) => `<strong class="part-name ${colour(each)}">${esc(each)}</strong>`
	const rows = look.arrows.flatMap((arrow, i) => {
		if (name !== null && arrow.from !== name && arrow.to !== name) return []
		const shown = open || home.openArrows.has(i)
		const quotes = shown
			? arrow.quotes
					.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, line ${quote.startLine}. `))
					.join('')
			: ''
		const stale = arrow.stale ? ' <span class="muted">Its part changed since, so it may be out of date.</span>' : ''
		return [
			`<li class="uses-item"><button class="uses-row" data-act="home-arrow" data-index="${i}" data-key="${where}-arrow-${i}" aria-expanded="${shown}"><span class="pv-num" aria-hidden="true">${i + 1}</span><span>${part(arrow.from)} ${esc(arrow.text)} ${part(arrow.to)}${stale}</span></button>${quotes}</li>`,
		]
	})
	return rows.length === 0 ? '' : `<ul class="uses">${rows.join('')}</ul>`
}
