// Each part of the project's top level keeps one colour wherever the page names it: its box in the picture on the home, the
// change card, the list of arrows, and the names under a reply. So a reader who has seen the picture once knows a part
// by its colour. The colour follows the part's name, so a part keeps it when ken's model draws the level again with
// other parts around it. The page learns the top level from the server at start, and again from each top-level look,
// since naming the parts changes it. This file is the one place that decides a part's colour.

// The number of colours in page.css, from .pc-0 to .pc-7.
const COLOURS = 8

let colours = new Map()
let places = []

// The same number for the same name, every time.
function numberOf(name) {
	let number = 0
	for (const letter of name) number = (number * 31 + letter.codePointAt(0)) >>> 0
	return number
}

// parts are the top level's parts in order, each its name and its paths. A part whose name lands on a colour an
// earlier part took gets the next one that is free, while one is.
export function learnParts(parts) {
	colours = new Map()
	const taken = new Set()
	for (const part of parts) {
		let colour = numberOf(part.name) % COLOURS
		for (let tried = 1; taken.has(colour) && tried < COLOURS; tried++) colour = (colour + 1) % COLOURS
		taken.add(colour)
		colours.set(part.name, colour)
	}
	places = parts.flatMap((part) => part.paths.map((place) => [place, part.name]))
}

// The name of the top-level part that holds a file, or null.
export function partOfFile(file) {
	return places.find(([place]) => file === place || file.startsWith(`${place}/`))?.[1] ?? null
}

// The class that gives an element its part's colour, or '' for a name that is not a part of the top level.
export function partClass(name) {
	const colour = colours.get(name)
	return colour === undefined ? '' : `pc-${colour}`
}
