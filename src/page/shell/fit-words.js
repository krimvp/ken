// A name or a sentence too long for its box is cut after its last whole word that fits, with "…", and the whole
// text shows on hover. An element marked data-fit holds its whole text in that attribute. The page fits them after
// each draw, when the window changes size and when its fonts have loaded, as each changes how many words fit.
export function fitWords(root = document) {
	for (const el of root.querySelectorAll('[data-fit]')) {
		const whole = el.dataset.fit
		el.textContent = whole
		const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
		const words = whole.split(' ')
		while (words.length > 1 && over()) {
			words.pop()
			el.textContent = `${words.join(' ').replace(/[,;:.]$/, '')}…`
		}
		if (el.textContent === whole) el.removeAttribute('title')
		else el.title = whole
	}
}
