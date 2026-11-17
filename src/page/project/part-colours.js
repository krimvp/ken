// Each part of the project's top level keeps one colour wherever the page names it: its box in the Project view, the
// change card, the list of arrows, and the names under a reply. So a reader who has seen the picture once knows a part
// by its colour. The colour follows the part's place in the top level, which the page learns from each top-level look.

// The number of colours in page.css, from .pc-0 to .pc-7.
const COLOURS = 8

let order = new Map()

export function learnParts(boxes) {
	order = new Map(boxes.map((box, i) => [box.name, i]))
}

// The class that gives an element its part's colour, or '' for a name that is not a part of the top level.
export function partClass(name) {
	const i = order.get(name)
	return i === undefined ? '' : `pc-${i % COLOURS}`
}
