// Draws a region of the page again only when what it shows changed, so a box the reader points at and a text they
// type stay as they are while another region updates. A list the reader unfolded stays unfolded: each is known by
// its key, or by the words of its line.
const drawn = new WeakMap()

export function fill(region, html) {
	if (drawn.get(region) === html) return false
	const key = (details) => details.dataset.key ?? details.querySelector('summary')?.textContent
	const open = new Set([...region.querySelectorAll('details[open]')].map(key))
	region.innerHTML = html
	for (const details of region.querySelectorAll('details')) if (open.has(key(details))) details.open = true
	drawn.set(region, html)
	return true
}
