// Each part of the project's top level keeps one colour wherever the page names it: its box in the picture on the home, the
// change card, the list of arrows, and the names under a reply. So a reader who has seen the picture once knows a part
// by its colour. The colour follows the part's place in the top level. The page learns the top level from the server
// at start, and again from each top-level look, since naming the parts changes it.

// The number of colours in page.css, from .pc-0 to .pc-7.
const COLOURS = 8

let order = new Map()
let places = []

// parts are the top level's parts in order, each its name and its paths.
export function learnParts(parts) {
	order = new Map(parts.map((part, i) => [part.name, i]))
	places = parts.flatMap((part) => part.paths.map((place) => [place, part.name]))
}

// The name of the top-level part that holds a file, or null.
export function partOfFile(file) {
	return places.find(([place]) => file === place || file.startsWith(`${place}/`))?.[1] ?? null
}

// The class that gives an element its part's colour, or '' for a name that is not a part of the top level.
export function partClass(name) {
	const i = order.get(name)
	return i === undefined ? '' : `pc-${i % COLOURS}`
}
