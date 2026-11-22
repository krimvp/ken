import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

// The page is plain JavaScript in the browser, so the test loads it by path.
type Cell = { row: number; col: number }
const picture: {
	placeParts: (count: number, links: [number, number][]) => { rows: number; cols: number; cells: Cell[] }
	placeColumn: (count: number, links: [number, number][]) => number[]
} = await import(path.join(import.meta.dirname, '../../src/page/project/parts-picture.js'))
const colours: {
	learnParts: (parts: { name: string; paths: string[] }[]) => void
	partClass: (name: string) => string
} = await import(path.join(import.meta.dirname, '../../src/page/project/part-colours.js'))

// A link is [the part that uses, the part it uses]. The parts are listed with the used ones first, as a level often
// lists them, so the rule cannot hold by the order of the list.
test('a part that uses another never sits below it, in the grid and in the one column of a phone', () => {
	const chain: [number, number][] = [
		[3, 2],
		[2, 1],
		[1, 0],
	]
	const grid = picture.placeParts(5, chain).cells
	for (const [user, used] of chain) {
		assert.ok(
			(grid[user]?.row ?? 9) <= (grid[used]?.row ?? -1),
			`part ${user} uses part ${used}, so it is not below it`,
		)
	}
	assert.equal(grid[0]?.row, 1, 'the part every other one stands on is in the bottom row')

	const column = picture.placeColumn(4, chain)
	assert.deepEqual(column, [3, 2, 1, 0], 'in one column the chain reads from the top down')
})

test('a part two others use sits under both of them', () => {
	const { cells } = picture.placeParts(4, [
		[1, 0],
		[2, 0],
	])
	assert.deepEqual([cells[1]?.row, cells[2]?.row, cells[0]?.row], [0, 0, 1])
})

test('a part keeps its colour when ken draws the level again with other parts around it', () => {
	const named = (...names: string[]) => names.map((name) => ({ name, paths: [name.toLowerCase()] }))
	colours.learnParts(named('Engine', 'Eval harness', 'Tests'))
	const before = colours.partClass('Tests')
	assert.notEqual(before, '', 'a part of the level has a colour')
	assert.notEqual(colours.partClass('Engine'), colours.partClass('Eval harness'), 'and no two parts share one')

	colours.learnParts(named('Tests', 'Product'))
	assert.equal(colours.partClass('Tests'), before, 'fewer, bigger parts: Tests moved up the list and kept its colour')
	assert.equal(colours.partClass('Engine'), '', 'a part that is gone has none')
})
