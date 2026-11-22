// The layers of the canvas: a second reading of the same blocks. "Processes" lights the parts one drawn process
// passes through and numbers them in order. "Changes" shows what a span of commits or one change touched. "What you
// know" shows what ken thinks the reader knows of each part, large. A layer never moves a block.
import { diagramPath } from '../level/content.js'
import { partOf } from '../project/walk.js'

export const LAYER_NAMES = { processes: 'Processes', changes: 'Changes', know: 'What you know' }

// The parts a drawn process passes through, in order: each numbered step of its diagram stands in the part that
// holds the first file it quotes. Steps in a row in one part are one stop there. The answer has, for each block of
// the level, the numbers of its stops, and how many stops there are.
export function processStops(diagram, boxes) {
	const stops = []
	for (const step of diagramPath(diagram)) {
		const file = step.quotes.find((quote) => typeof quote.path === 'string')?.path
		const part = file === undefined ? -1 : partOf(file, boxes)
		if (part >= 0 && stops.at(-1) !== part) stops.push(part)
	}
	return {
		count: stops.length,
		byBlock: boxes.map((_, i) => stops.flatMap((part, k) => (part === i ? [k + 1] : []))),
	}
}

// The spans and changes the "Changes" layer offers, from what the server lists: what landed in the last days first,
// then the newest merge.
export function changeChoices(changes) {
	const since = changes.filter((choice) => choice.kind === 'since')
	const merge = changes.find((choice) => choice.kind === 'merge')
	const pull = merge?.name.match(/Merge pull request #(\d+)/)
	return [
		...since.map((choice) => ({ change: choice.change, name: choice.name.slice(0, choice.name.lastIndexOf(': ')) })),
		...(merge
			? [{ change: merge.change, name: pull ? `Pull request #${pull[1]}` : 'The newest merge', merge: true }]
			: []),
	]
}
