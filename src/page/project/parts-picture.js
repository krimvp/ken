// A level of parts as a picture: the boxes in a grid, the part with the most arrows in the middle, and the arrows drawn
// between them once the page has laid the boxes out. The boxes stay a list in the page, so on a narrow screen and to a
// screen reader the picture is the list of boxes and the numbered list of arrows under it. A level holds at most 6
// parts and 8 arrows, so trying every place for every box is cheap.

const SVG = 'http://www.w3.org/2000/svg'

// What a layout pays, in grid steps, for an arrow through a box, for two arrows that cross, and for a busy part away
// from the middle. Length costs 1 per step.
const COST = { through: 50, cross: 10, offCenter: 2 }

// links are [from, to] pairs of box indexes. cells[i] is the row and column of box i.
export function placeParts(count, links) {
	const rows = count <= 3 ? 1 : 2
	const cols = count <= 3 ? Math.max(count, 1) : 3
	const all = []
	for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) all.push({ row, col })
	const degree = Array.from({ length: count }, (_, i) => links.filter(([a, b]) => a === i || b === i).length)
	const middle = { row: (rows - 1) / 2, col: (cols - 1) / 2 }
	let best = null
	const tryFrom = (cells, free) => {
		if (cells.length === count) {
			const cost = costOf(cells, links, degree, middle)
			if (!best || cost < best.cost) best = { cost, cells: [...cells] }
			return
		}
		for (const [i, cell] of free.entries()) {
			cells.push(cell)
			tryFrom(cells, [...free.slice(0, i), ...free.slice(i + 1)])
			cells.pop()
		}
	}
	tryFrom([], all)
	return { rows, cols, cells: best?.cells ?? [] }
}

function costOf(cells, links, degree, middle) {
	let cost = 0
	for (const [i, cell] of cells.entries()) {
		cost += COST.offCenter * degree[i] * (Math.abs(cell.col - middle.col) + 0.5 * Math.abs(cell.row - middle.row))
	}
	const segments = links.map(([a, b]) => [center(cells[a]), center(cells[b]), a, b])
	for (const [p, q, a, b] of segments) {
		cost += Math.hypot(q.x - p.x, q.y - p.y)
		for (const [k, cell] of cells.entries()) {
			if (k !== a && k !== b && crossesBox(p, q, cell)) cost += COST.through
		}
	}
	for (const [i, [p, q, a, b]] of segments.entries()) {
		for (const [r, s, c, d] of segments.slice(i + 1)) {
			if (a !== c && a !== d && b !== c && b !== d && crosses(p, q, r, s)) cost += COST.cross
		}
	}
	return cost
}

function center(cell) {
	return { x: cell.col, y: cell.row }
}

// A box fills most of its cell, so a segment through the middle part of a cell runs over the box there.
function crossesBox(p, q, cell) {
	const box = { left: cell.col - 0.4, right: cell.col + 0.4, top: cell.row - 0.35, bottom: cell.row + 0.35 }
	for (let t = 0; t <= 1; t += 0.05) {
		const x = p.x + (q.x - p.x) * t
		const y = p.y + (q.y - p.y) * t
		if (x > box.left && x < box.right && y > box.top && y < box.bottom) return true
	}
	return false
}

function crosses(p, q, r, s) {
	const turn = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
	return turn(p, q, r) * turn(p, q, s) < 0 && turn(r, s, p) * turn(r, s, q) < 0
}

// cells are the boxes, each as the HTML inside its list item and the classes of the item. links are the arrows as
// { from, to } box indexes. numbered draws each arrow's number on it, which opens the arrow in the list of arrows; open
// holds the arrows open there.
export function pictureHtml(cells, links, { numbered, open }) {
	const place = placeParts(
		cells.length,
		links.map((link) => [link.from, link.to]),
	)
	const items = cells.map(({ html, classes }, i) => {
		const at = place.cells[i]
		return `<li class="${classes}" style="--row:${at.row + 1};--col:${at.col + 1}">${html}</li>`
	})
	const data = JSON.stringify(links.map((link, i) => ({ from: link.from, to: link.to, open: open.has(i) })))
	return `<div class="pv-picture" style="--rows:${place.rows};--cols:${place.cols}" data-links="${escAttr(data)}" data-numbered="${numbered}">
		<ul class="pv-boxes">${items.join('')}</ul>
	</div>`
}

function escAttr(text) {
	return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

// Draws the arrows of every picture under root, from where the boxes sit now. Called after each render and when the
// window changes size. A narrow screen hides the picture's lines, and the list says the same.
export function drawPictures(root) {
	for (const picture of root.querySelectorAll('.pv-picture')) {
		picture.querySelector('svg')?.remove()
		const boxes = [...picture.querySelectorAll(':scope > .pv-boxes > li')]
		if (getComputedStyle(picture).getPropertyValue('--draw').trim() !== '1') continue
		const links = JSON.parse(picture.dataset.links)
		const numbered = picture.dataset.numbered === 'true'
		const frame = picture.getBoundingClientRect()
		const rects = boxes.map((box) => {
			const r = box.getBoundingClientRect()
			return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height }
		})
		const svg = document.createElementNS(SVG, 'svg')
		svg.setAttribute('class', 'pv-lines')
		svg.setAttribute('aria-hidden', 'true')
		svg.setAttribute('width', `${frame.width}`)
		svg.setAttribute('height', `${frame.height}`)
		svg.innerHTML = `<defs><marker id="pv-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="pv-head"/></marker><marker id="pv-head-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="pv-head is-open"/></marker></defs>`
		const marks = []
		for (const [i, link] of links.entries()) {
			const from = rects[link.from]
			const to = rects[link.to]
			if (!from || !to) continue
			// Two parts that use each other get two lines side by side, not one line with two heads.
			const both = links.some((other) => other.from === link.to && other.to === link.from)
			const [p, q] = between(from, to, both ? 7 : 0)
			const group = document.createElementNS(SVG, 'g')
			group.setAttribute('class', `pv-link${link.open ? ' is-open' : ''}`)
			if (numbered) {
				group.dataset.act = 'pv-arrow'
				group.dataset.index = `${i}`
			}
			const line = `x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"`
			group.innerHTML = `<line ${line} class="pv-hit"/><line ${line} class="pv-line" marker-end="url(#${link.open ? 'pv-head-open' : 'pv-head'})"/>`
			if (numbered) {
				const spot = freeSpot(p, q, marks)
				marks.push(spot)
				group.innerHTML += `<circle cx="${spot.x}" cy="${spot.y}" r="13" class="pv-badge"/><text x="${spot.x}" y="${spot.y}" class="pv-badge-text">${i + 1}</text>`
			}
			svg.append(group)
		}
		picture.prepend(svg)
	}
}

// The ends of the line from one box to another: where the line between their centres leaves each box, a few pixels
// out, moved sideways by shift.
function between(a, b, shift) {
	const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
	const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
	const dx = cb.x - ca.x
	const dy = cb.y - ca.y
	const length = Math.hypot(dx, dy) || 1
	const side = { x: (-dy / length) * shift, y: (dx / length) * shift }
	const out = (box, sign) => {
		const tx = dx === 0 ? Number.POSITIVE_INFINITY : (box.w / 2 + 6) / Math.abs(dx)
		const ty = dy === 0 ? Number.POSITIVE_INFINITY : (box.h / 2 + 6) / Math.abs(dy)
		const t = Math.min(tx, ty)
		const c = sign > 0 ? ca : cb
		return { x: round(c.x + sign * dx * t + side.x), y: round(c.y + sign * dy * t + side.y) }
	}
	return [out(a, 1), out(b, -1)]
}

// The middle of the line, or the point along it farthest from the numbers already drawn, so two arrows that cross do
// not hide one number under the other.
function freeSpot(p, q, taken) {
	const spots = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((t) => ({
		x: round(p.x + (q.x - p.x) * t),
		y: round(p.y + (q.y - p.y) * t),
	}))
	const room = (spot) => Math.min(...taken.map((other) => Math.hypot(other.x - spot.x, other.y - spot.y)))
	return spots.find((spot) => room(spot) > 30) ?? spots.reduce((best, spot) => (room(spot) > room(best) ? spot : best))
}

function round(n) {
	return Math.round(n * 10) / 10
}
