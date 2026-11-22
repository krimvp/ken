// A small picture of a level: its boxes where the big picture has them, and the ones named filled. It stands beside
// words that name those parts, so it is hidden from a screen reader.
import { placeParts } from '../../project/parts-picture.js'

// Placing the boxes tries every order of them, so each level is placed once.
const placed = new WeakMap()

const [W, H, GAP] = [18, 8, 4]

export function miniPictureHtml(look, parts) {
	if (look.boxes.length === 0) return ''
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	if (!placed.has(look)) {
		placed.set(
			look,
			placeParts(
				look.boxes.length,
				look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)]),
			),
		)
	}
	const { rows, cols, cells } = placed.get(look)
	const on = new Set(parts.map(at))
	const rects = cells.map(
		(cell, i) =>
			`<rect x="${cell.col * (W + GAP) + 1}" y="${cell.row * (H + GAP) + 1}" width="${W}" height="${H}" rx="3"${on.has(i) ? ' class="is-on"' : ''}/>`,
	)
	const [width, height] = [cols * (W + GAP) - GAP + 2, rows * (H + GAP) - GAP + 2]
	return `<svg class="mini-picture" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${rects.join('')}</svg>`
}
