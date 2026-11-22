// Where the blocks and the connectors of one level stand on the canvas, in the canvas's own units. A part that uses
// another stands above it and the busiest part in the middle, as placeParts decides. A connector leaves its block on
// the side that faces the other block, and the connectors on one side share it out so none start at one point. In a
// narrow window the blocks stand in one column and a connector between two that are not neighbours bends out to the
// right. The verb of a connector sits at its middle.
import { placeColumn, placeParts } from '../project/parts-picture.js'

export const BLOCK = { w: 340, h: 212 }
const GAP = { x: 212, y: 124 }
const COLUMN_GAP = 104
// How far a connector that goes around a block bows out.
const BOW = 96

// placeParts tries every place for every box, which is cheap up to six. A level with more stands in rows of three,
// in the order the server sent.
const MOST_PLACED = 6

function cellsOf(count, links) {
	if (count <= MOST_PLACED) return placeParts(count, links).cells
	return Array.from({ length: count }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3 }))
}

const SIDES = {
	top: { nx: 0, ny: -1 },
	bottom: { nx: 0, ny: 1 },
	left: { nx: -1, ny: 0 },
	right: { nx: 1, ny: 0 },
}

// The sides a connector leaves and meets, from where its two blocks stand.
function sidesOf(a, b, rows) {
	const [dr, dc] = [b.row - a.row, b.col - a.col]
	if (dr === 0 && Math.abs(dc) === 1) return dc > 0 ? ['right', 'left'] : ['left', 'right']
	// Two blocks of one row with a block between them are joined around the outside of the row.
	if (dr === 0) return a.row === rows - 1 && rows > 1 ? ['bottom', 'bottom'] : ['top', 'top']
	return dr > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

function pointOn(rect, side, share) {
	if (side === 'top' || side === 'bottom') {
		return { x: rect.x + rect.w * share, y: side === 'top' ? rect.y : rect.y + rect.h }
	}
	return { x: side === 'left' ? rect.x : rect.x + rect.w, y: rect.y + rect.h * share }
}

const bezier = ([p0, p1, p2, p3], t) => {
	const u = 1 - t
	const at = (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]
	return { x: at('x'), y: at('y') }
}

// look is a level as the server sends it. column lays it out for a narrow window. The answer is { width, height,
// blocks: [{ x, y, w, h }], links: [{ index, from, to, d, mid }] }, with from and to the indexes of two blocks.
export function layoutOf(look, column = false) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const pairs = look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)])
	const known = pairs.filter(([a, b]) => a >= 0 && b >= 0)
	const count = look.boxes.length
	const cells = column
		? placeColumn(count, known).reduce((all, box, k) => {
				all[box] = { row: k, col: 0 }
				return all
			}, [])
		: cellsOf(count, known)
	const pitch = { x: BLOCK.w + GAP.x, y: BLOCK.h + (column ? COLUMN_GAP : GAP.y) }
	const blocks = cells.map((cell) => ({ x: cell.col * pitch.x, y: cell.row * pitch.y, ...BLOCK }))
	const rows = Math.max(0, ...cells.map((cell) => cell.row + 1))
	const cols = Math.max(0, ...cells.map((cell) => cell.col + 1))

	const ends = pairs.map(([a, b]) => {
		if (a < 0 || b < 0 || a === b) return null
		if (column && Math.abs(cells[a].row - cells[b].row) > 1) return ['right', 'right']
		return sidesOf(cells[a], cells[b], rows)
	})
	// The connectors on one side of a block, in the order of the blocks at their other ends.
	const shareOf = (link, end) => {
		const [block, side] = [pairs[link][end], ends[link][end]]
		const along = side === 'top' || side === 'bottom' ? 'x' : 'y'
		const onSide = pairs
			.flatMap((pair, i) => (ends[i] ? [0, 1].map((e) => ({ i, e, block: pair[e], side: ends[i][e] })) : []))
			.filter((each) => each.block === block && each.side === side)
			.sort((p, q) => blocks[pairs[p.i][1 - p.e]][along] - blocks[pairs[q.i][1 - q.e]][along] || p.i - q.i)
		const k = onSide.findIndex((each) => each.i === link && each.e === end)
		return (k + 1) / (onSide.length + 1)
	}
	const links = pairs.flatMap(([a, b], index) => {
		if (!ends[index]) return []
		const [out, back] = ends[index]
		const p0 = pointOn(blocks[a], out, shareOf(index, 0))
		const p3 = pointOn(blocks[b], back, shareOf(index, 1))
		const around = out === back
		const reach = around
			? BOW + Math.abs(p3.x - p0.x + p3.y - p0.y) * 0.12
			: Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.42
		const p1 = { x: p0.x + SIDES[out].nx * reach, y: p0.y + SIDES[out].ny * reach }
		const p2 = { x: p3.x + SIDES[back].nx * reach, y: p3.y + SIDES[back].ny * reach }
		const d = `M${p0.x} ${p0.y}C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`
		// Two connectors between the same two blocks run side by side, so their verbs sit at different points.
		const twins = pairs.flatMap(([c, e], i) => ((c === a && e === b) || (c === b && e === a) ? [i] : []))
		const at = (twins.indexOf(index) + 1) / (twins.length + 1)
		return [{ index, from: a, to: b, d, mid: bezier([p0, p1, p2, p3], twins.length > 1 ? 0.2 + 0.6 * at : 0.5) }]
	})
	const bow = links.some((link) => ends[link.index][0] === ends[link.index][1]) ? BOW : 0
	return {
		blocks,
		links,
		width: Math.max(cols, 1) * pitch.x - (pitch.x - BLOCK.w) + (column ? bow : 0),
		height: Math.max(rows, 1) * pitch.y - (pitch.y - BLOCK.h),
		bow: column ? 0 : bow,
	}
}
