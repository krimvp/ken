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
// { from, to, text } box indexes and verb. numbered draws each arrow's number and verb on it, which opens the arrow in
// the list of arrows; open holds the arrows open there.
export function pictureHtml(cells, links, { numbered, open }) {
	const place = placeParts(
		cells.length,
		links.map((link) => [link.from, link.to]),
	)
	const items = cells.map(({ html, classes }, i) => {
		const at = place.cells[i]
		return `<li class="${classes}" style="--row:${at.row + 1};--col:${at.col + 1}">${html}</li>`
	})
	const data = JSON.stringify(
		links.map((link, i) => ({ from: link.from, to: link.to, text: link.text, open: open.has(i) })),
	)
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
		picture.querySelector(':scope > svg')?.remove()
		picture.querySelector(':scope > .pv-labels')?.remove()
		if (getComputedStyle(picture).getPropertyValue('--draw').trim() !== '1') continue
		const boxes = [...picture.querySelectorAll(':scope > .pv-boxes > li')]
		const links = JSON.parse(picture.dataset.links)
		const frame = picture.getBoundingClientRect()
		const rects = boxes.map((box) => {
			const r = box.getBoundingClientRect()
			return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height }
		})
		const curves = routes(links, rects)
		const svg = document.createElementNS(SVG, 'svg')
		svg.setAttribute('class', 'pv-lines')
		svg.setAttribute('aria-hidden', 'true')
		svg.setAttribute('width', `${frame.width}`)
		svg.setAttribute('height', `${frame.height}`)
		svg.innerHTML = `<defs>${['', 'hot', 'faded'].map(head).join('')}</defs>`
		for (const [i, link] of links.entries()) {
			const curve = curves[i]
			if (!curve) continue
			const faded = boxes[link.from].classList.contains('is-faded') && boxes[link.to].classList.contains('is-faded')
			const [p0, p1, p2, p3] = curve.map((p) => `${round(p.x)},${round(p.y)}`)
			const path = `M${p0} C${p1} ${p2} ${p3}`
			const group = document.createElementNS(SVG, 'g')
			group.setAttribute('class', `pv-link${link.open ? ' is-open' : ''}${faded ? ' is-faded' : ''}`)
			group.dataset.index = `${i}`
			group.innerHTML = `<path d="${path}" class="pv-line" marker-end="url(#pv-head${faded ? '-faded' : ''})"/><path d="${path}" class="pv-line-hot" marker-end="url(#pv-head-hot)"/>`
			svg.append(group)
		}
		picture.prepend(svg)
		if (picture.dataset.numbered === 'true') placeLabels(picture, links, curves, rects)
		wire(picture, links)
	}
}

function head(kind) {
	const id = kind === '' ? 'pv-head' : `pv-head-${kind}`
	return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" class="pv-head ${kind}"/></marker>`
}

// Each arrow leaves its box on the side that faces the other box and meets the other box on the side facing back. Two
// boxes in one row with a box between them are joined under the row instead, so no arrow runs over a box. The arrows on
// one side of a box share it out, in the order of the boxes they go to, so they neither start at one point nor cross
// as they leave.
function routes(links, rects) {
	const ends = links.map((link) => {
		const a = rects[link.from]
		const b = rects[link.to]
		if (!a || !b) return null
		const ca = mid(a)
		const cb = mid(b)
		const sameRow = Math.abs(cb.y - ca.y) < (a.h + b.h) / 4
		if (sameRow && rects.some((r) => r !== a && r !== b && between1d(r, a, b) && Math.abs(mid(r).y - ca.y) < r.h / 2)) {
			return { from: 'bottom', to: 'bottom', far: true }
		}
		if (sameRow) return cb.x > ca.x ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' }
		return cb.y > ca.y ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' }
	})
	const ports = new Map()
	for (const [i, link] of links.entries()) {
		if (!ends[i]) continue
		for (const [box, side, other] of [
			[link.from, ends[i].from, link.to],
			[link.to, ends[i].to, link.from],
		]) {
			const key = `${box}:${side}`
			if (!ports.has(key)) ports.set(key, [])
			ports.get(key).push({ link: i, box, other })
		}
	}
	const at = new Map()
	for (const [key, list] of ports) {
		const side = key.split(':')[1]
		const across = side === 'top' || side === 'bottom' ? 'x' : 'y'
		list.sort((p, q) => mid(rects[p.other])[across] - mid(rects[q.other])[across] || p.link - q.link)
		for (const [k, port] of list.entries()) {
			const r = rects[port.box]
			const share = list.length === 1 ? 0.5 : 0.2 + (0.6 * k) / (list.length - 1)
			at.set(`${port.link}:${port.box}:${side}`, pointOn(r, side, share))
		}
	}
	return links.map((link, i) => {
		const end = ends[i]
		if (!end) return null
		const p0 = at.get(`${i}:${link.from}:${end.from}`)
		const p3 = at.get(`${i}:${link.to}:${end.to}`)
		const start = step(p0, end.from, 3)
		const stop = step(p3, end.to, 4)
		const reach = end.far ? 56 : Math.max(28, Math.hypot(stop.x - start.x, stop.y - start.y) * 0.4)
		return [start, step(start, end.from, reach), step(stop, end.to, reach), stop]
	})
}

function mid(r) {
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

function between1d(r, a, b) {
	const x = mid(r).x
	return x > Math.min(mid(a).x, mid(b).x) && x < Math.max(mid(a).x, mid(b).x)
}

function pointOn(r, side, share) {
	if (side === 'top') return { x: r.x + r.w * share, y: r.y }
	if (side === 'bottom') return { x: r.x + r.w * share, y: r.y + r.h }
	if (side === 'left') return { x: r.x, y: r.y + r.h * share }
	return { x: r.x + r.w, y: r.y + r.h * share }
}

function step(p, side, by) {
	const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side]
	return { x: p.x + out[0] * by, y: p.y + out[1] * by }
}

function bezier([p0, p1, p2, p3], t) {
	const u = 1 - t
	const f = (k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]
	return { x: f('x'), y: f('y') }
}

// Each arrow's number and verb sit on its line: at the middle, or the point along it where the label covers the least
// of the boxes and of the labels already placed.
function placeLabels(picture, links, curves, rects) {
	const layer = document.createElement('div')
	layer.className = 'pv-labels'
	layer.setAttribute('aria-hidden', 'true')
	picture.append(layer)
	const taken = rects.map((r) => ({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 }))
	for (const [i, link] of links.entries()) {
		if (!curves[i]) continue
		const label = document.createElement('span')
		label.className = `pv-label${link.open ? ' is-open' : ''}`
		label.dataset.act = 'pv-arrow'
		label.dataset.index = `${i}`
		label.innerHTML = `<span class="pv-label-n">${i + 1}</span><span class="pv-label-text"></span>`
		label.lastChild.textContent = link.text ?? ''
		layer.append(label)
		// A label that finds no free spot on one line tries again folded to a narrow column.
		const wide = spotFor(label, curves[i], taken)
		label.classList.add('is-narrow')
		const narrow = wide.cover === 0 ? wide : spotFor(label, curves[i], taken)
		const best = narrow.cover < wide.cover ? narrow : wide
		label.classList.toggle('is-narrow', best === narrow && best !== wide)
		label.style.left = `${round(best.box.x)}px`
		label.style.top = `${round(best.box.y)}px`
		taken.push(best.box)
	}
}

function spotFor(label, curve, taken) {
	const w = label.offsetWidth
	const h = label.offsetHeight
	const spots = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74].map((t) => {
		const p = bezier(curve, t)
		const box = { x: p.x - w / 2, y: p.y - h / 2, w, h }
		return { box, cover: taken.reduce((sum, r) => sum + overlap(box, r), 0) }
	})
	return spots.find((spot) => spot.cover === 0) ?? spots.reduce((a, b) => (b.cover < a.cover ? b : a))
}

function overlap(a, b) {
	const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return x > 0 && y > 0 ? x * y : 0
}

// Pointing at a box, or moving focus to it, lights its arrows and the boxes at their other ends. Pointing at a label
// lights its arrow and the two boxes it joins.
function wire(picture, links) {
	if (picture.dataset.wired) return
	picture.dataset.wired = 'true'
	const light = (event) => {
		const label = event.target.closest?.('.pv-label')
		const cell = event.target.closest?.('.pv-boxes > li')
		const cells = [...picture.querySelectorAll(':scope > .pv-boxes > li')]
		const box = cell ? cells.indexOf(cell) : -1
		const hot = label
			? new Set([Number(label.dataset.index)])
			: new Set(links.flatMap((link, i) => (link.from === box || link.to === box ? [i] : [])))
		const near = new Set([...hot].flatMap((i) => [links[i].from, links[i].to]))
		if (box >= 0) near.add(box)
		picture.classList.toggle('is-lit', near.size > 0)
		for (const [i, each] of cells.entries()) each.classList.toggle('is-near', near.has(i))
		for (const each of picture.querySelectorAll('.pv-link, .pv-label')) {
			each.classList.toggle('is-hot', hot.has(Number(each.dataset.index)))
		}
	}
	picture.addEventListener('pointerover', light)
	picture.addEventListener('focusin', light)
	picture.addEventListener('pointerleave', () => light({ target: picture }))
	picture.addEventListener('focusout', (event) => {
		if (!picture.contains(event.relatedTarget)) light({ target: picture })
	})
}

function round(n) {
	return Math.round(n * 10) / 10
}
