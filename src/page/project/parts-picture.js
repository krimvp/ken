// A level of parts as a picture: the boxes in a grid, the part with the most arrows in the middle, and the arrows drawn
// between them once the page has laid the boxes out. The boxes stay a list in the page, so on a narrow screen and to a
// screen reader the picture is the list of boxes and the numbered list of arrows under it. On a phone the boxes stand
// in one column and the arrows bend out to its right. A level holds at most 6 parts and 8 arrows, so trying every
// place for every box is cheap.

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

// The order of the boxes in one column, for a phone: the arrows bend out to the right of the column, so the order
// pays for each arrow's length and for two arrows whose ends interleave, since those cross.
export function placeColumn(count, links) {
	let best = null
	const tryFrom = (order, free) => {
		if (order.length === count) {
			const at = new Map(order.map((box, k) => [box, k]))
			const spans = links.map(([a, b]) => [Math.min(at.get(a), at.get(b)), Math.max(at.get(a), at.get(b))])
			let cost = spans.reduce((sum, [lo, hi]) => sum + hi - lo, 0)
			for (const [i, [a, b]] of spans.entries()) {
				for (const [c, d] of spans.slice(i + 1)) if ((a < c && c < b && b < d) || (c < a && a < d && d < b)) cost += 3
			}
			if (!best || cost < best.cost) best = { cost, order: [...order] }
			return
		}
		for (const [i, box] of free.entries()) {
			order.push(box)
			tryFrom(order, [...free.slice(0, i), ...free.slice(i + 1)])
			order.pop()
		}
	}
	tryFrom(
		[],
		Array.from({ length: count }, (_, i) => i),
	)
	return best?.order ?? []
}

function costOf(cells, links, degree, middle) {
	let cost = 0
	for (const [i, cell] of cells.entries()) {
		cost += COST.offCenter * degree[i] * (Math.abs(cell.col - middle.col) + 0.5 * Math.abs(cell.row - middle.row))
	}
	// An arrow between two boxes of one row with a box between them goes around the outside of the picture, so it
	// crosses nothing and pays its length and one step more.
	const around = ([a, b]) =>
		cells[a].row === cells[b].row &&
		cells.some(
			(cell, k) => k !== a && k !== b && cell.row === cells[a].row && between(cell.col, cells[a].col, cells[b].col),
		)
	const segments = []
	for (const [a, b] of links) {
		const [p, q] = [center(cells[a]), center(cells[b])]
		const length = Math.hypot(q.x - p.x, q.y - p.y)
		if (around([a, b])) {
			cost += length + 1
			continue
		}
		cost += length
		for (const [k, cell] of cells.entries()) {
			if (k !== a && k !== b && crossesBox(p, q, cell)) cost += COST.through
		}
		segments.push([p, q, a, b])
	}
	for (const [i, [p, q, a, b]] of segments.entries()) {
		for (const [r, s, c, d] of segments.slice(i + 1)) {
			if (a !== c && a !== d && b !== c && b !== d && crosses(p, q, r, s)) cost += COST.cross
		}
	}
	return cost
}

function between(x, a, b) {
	return x > Math.min(a, b) && x < Math.max(a, b)
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

// Two segments cross when each has the other's ends on its two sides. One that runs through the other's end counts too,
// as a diagonal through the middle of a vertical does.
function crosses(p, q, r, s) {
	const turn = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
	const [t1, t2, t3, t4] = [turn(p, q, r), turn(p, q, s), turn(r, s, p), turn(r, s, q)]
	if (t1 === 0 && t2 === 0) return false
	return t1 * t2 <= 0 && t3 * t4 <= 0
}

// cells are the boxes, each as the HTML inside its list item and the classes of the item. links are the arrows as
// { from, to, text } box indexes and verb. numbered draws each arrow's number and verb on it, which opens the arrow in
// the list of arrows; open holds the arrows open there. lit holds the boxes that stay lit when nothing is pointed at,
// such as the parts of the walkthrough step the reader is on.
export function pictureHtml(cells, links, { numbered, open, lit = new Set() }) {
	const pairs = links.map((link) => [link.from, link.to])
	const place = placeParts(cells.length, pairs)
	const column = placeColumn(cells.length, pairs)
	const items = cells.map(({ html, classes }, i) => {
		const at = place.cells[i]
		const near = lit.has(i) ? ' is-near' : ''
		return `<li class="${classes}${near}" style="--row:${at.row + 1};--col:${at.col + 1};--order:${column.indexOf(i)}">${html}</li>`
	})
	const data = JSON.stringify(
		links.map((link, i) => ({ from: link.from, to: link.to, text: link.text, open: open.has(i) })),
	)
	const rest = [...lit].join(' ')
	return `<div class="pv-picture${lit.size > 0 ? ' is-lit' : ''}" style="--rows:${place.rows};--cols:${place.cols}" data-links="${escAttr(data)}" data-numbered="${numbered}" data-lit="${rest}">
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
		const draw = getComputedStyle(picture).getPropertyValue('--draw').trim()
		if (draw !== '1' && draw !== 'column') continue
		const boxes = [...picture.querySelectorAll(':scope > .pv-boxes > li')]
		const links = JSON.parse(picture.dataset.links)
		const frame = picture.getBoundingClientRect()
		const rects = boxes.map((box) => {
			const r = box.getBoundingClientRect()
			return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height }
		})
		const curves = draw === 'column' ? arcs(links, rects) : routes(links, rects)
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
		if (picture.dataset.numbered === 'true') placeLabels(picture, links, curves, rects, frame, draw === 'column')
		wire(picture, links)
		lightPicture(picture, restOf(picture))
	}
}

function head(kind) {
	const id = kind === '' ? 'pv-head' : `pv-head-${kind}`
	return `<marker id="${id}" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,1 L11,6 L0,11 L3,6 z" class="pv-head ${kind}"/></marker>`
}

// Each arrow leaves its box on the side that faces the other box and meets the other box on the side facing back. Two
// boxes in one row with a box between them are joined around the outside instead: over the top row, under the bottom
// one. So no arrow runs over a box, and none crosses the arrows between the rows. The arrows on
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
			const side = rects.some((r) => mid(r).y > ca.y + a.h / 2) ? 'top' : 'bottom'
			return { from: side, to: side, far: true }
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

// On a phone the boxes stand in one column and every arrow leaves the right side of its box and bends out to the right
// before it comes back to the other box. A short arrow bends less than a long one around it, so arrows nest and do not
// cross unless their ends interleave.
function arcs(links, rects) {
	const lanes = []
	const laneOf = new Map()
	const spans = links.map((link, i) => {
		const [a, b] = [mid(rects[link.from]).y, mid(rects[link.to]).y]
		return { i, lo: Math.min(a, b), hi: Math.max(a, b) }
	})
	for (const span of [...spans].sort((p, q) => p.hi - p.lo - (q.hi - q.lo))) {
		let lane = 0
		while ((lanes[lane] ?? []).some((other) => other.lo < span.hi && span.lo < other.hi)) lane++
		lanes[lane] = [...(lanes[lane] ?? []), span]
		laneOf.set(span.i, lane)
	}
	const ports = new Map()
	for (const [i, link] of links.entries()) {
		for (const [box, other] of [
			[link.from, link.to],
			[link.to, link.from],
		]) {
			if (!ports.has(box)) ports.set(box, [])
			ports.get(box).push({ link: i, other })
		}
	}
	const at = new Map()
	for (const [box, list] of ports) {
		list.sort((p, q) => mid(rects[p.other]).y - mid(rects[q.other]).y || p.link - q.link)
		for (const [k, port] of list.entries()) {
			const share = list.length === 1 ? 0.5 : 0.25 + (0.5 * k) / (list.length - 1)
			at.set(`${port.link}:${box}`, pointOn(rects[box], 'right', share))
		}
	}
	return links.map((link, i) => {
		const start = step(at.get(`${i}:${link.from}`), 'right', 3)
		const stop = step(at.get(`${i}:${link.to}`), 'right', 4)
		const out = 26 + 16 * laneOf.get(i)
		return [start, step(start, 'right', out), step(stop, 'right', out), stop]
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
// of the boxes, of the labels already placed and of the other lines, inside the picture. On a phone a label is the
// number alone, and the list under the picture gives the verb.
function placeLabels(picture, links, curves, rects, frame, compact) {
	const layer = document.createElement('div')
	layer.className = 'pv-labels'
	layer.setAttribute('aria-hidden', 'true')
	picture.append(layer)
	const taken = rects.map((r) => ({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 }))
	for (const [i, link] of links.entries()) {
		if (!curves[i]) continue
		const label = document.createElement('span')
		label.className = `pv-label${link.open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`
		label.dataset.act = 'pv-arrow'
		label.dataset.index = `${i}`
		label.innerHTML = `<span class="pv-label-n">${i + 1}</span><span class="pv-label-text"></span>`
		label.lastChild.textContent = link.text ?? ''
		layer.append(label)
		// A label that finds no free spot on one line tries again folded to a narrow column.
		const lines = curves.flatMap((curve, k) => (k === i || !curve ? [] : samples(curve)))
		const area = { w: frame.width, h: frame.height }
		const wide = spotFor(label, curves[i], taken, lines, area)
		label.classList.add('is-narrow')
		const narrow = wide.cover === 0 || compact ? wide : spotFor(label, curves[i], taken, lines, area)
		const best = narrow.cover < wide.cover ? narrow : wide
		label.classList.toggle('is-narrow', best === narrow && best !== wide)
		label.style.left = `${round(best.box.x)}px`
		label.style.top = `${round(best.box.y)}px`
		taken.push(best.box)
	}
}

// A label that sits over another arrow's line hides that line, so a point of another line under it costs as much as
// a large overlap. A label past the picture's edge is cut off, so that costs more still.
function spotFor(label, curve, taken, lines, area) {
	const w = label.offsetWidth
	const h = label.offsetHeight
	const spots = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8].map((t) => {
		const p = bezier(curve, t)
		const box = { x: p.x - w / 2, y: p.y - h / 2, w, h }
		const under = lines.filter((q) => q.x > box.x - 2 && q.x < box.x + w + 2 && q.y > box.y - 2 && q.y < box.y + h + 2)
		const outside = box.x < 0 || box.y < 0 || box.x + w > area.w || box.y + h > area.h ? 1e6 : 0
		const cover = taken.reduce((sum, r) => sum + overlap(box, r), 0) + 400 * under.length + outside
		return { box, cover }
	})
	return spots.find((spot) => spot.cover === 0) ?? spots.reduce((a, b) => (b.cover < a.cover ? b : a))
}

function samples(curve) {
	return Array.from({ length: 41 }, (_, k) => bezier(curve, k / 40))
}

function overlap(a, b) {
	const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return x > 0 && y > 0 ? x * y : 0
}

// The boxes a picture keeps lit when nothing is pointed at.
function restOf(picture) {
	return new Set((picture.dataset.lit ?? '').split(' ').filter(Boolean).map(Number))
}

// Lights the boxes given and the arrows hot gives, by default those between two of them. The other boxes lose their
// colour and their arrows fade. An empty set puts the picture back as it was drawn.
export function lightPicture(picture, boxes, hot = null) {
	const links = JSON.parse(picture.dataset.links)
	const lit = hot ?? new Set(links.flatMap((link, i) => (boxes.has(link.from) && boxes.has(link.to) ? [i] : [])))
	picture.classList.toggle('is-lit', boxes.size > 0)
	for (const [i, each] of picture.querySelectorAll(':scope > .pv-boxes > li').entries()) {
		each.classList.toggle('is-near', boxes.has(i))
	}
	for (const each of picture.querySelectorAll('.pv-link, .pv-label')) {
		each.classList.toggle('is-hot', lit.has(Number(each.dataset.index)))
	}
}

// Pointing at a box, or moving focus to it, lights its arrows and the boxes at their other ends. Pointing at a label
// lights its arrow and the two boxes it joins. Leaving the picture puts back the boxes it keeps lit.
function wire(picture, links) {
	if (picture.dataset.wired) return
	picture.dataset.wired = 'true'
	const light = (event) => {
		const label = event.target.closest?.('.pv-label')
		const cell = event.target.closest?.('.pv-boxes > li')
		const cells = [...picture.querySelectorAll(':scope > .pv-boxes > li')]
		const box = cell ? cells.indexOf(cell) : -1
		if (label) {
			const i = Number(label.dataset.index)
			lightPicture(picture, new Set([links[i].from, links[i].to]), new Set([i]))
		} else if (box >= 0) {
			const hot = new Set(links.flatMap((link, i) => (link.from === box || link.to === box ? [i] : [])))
			lightPicture(picture, new Set([box, ...[...hot].flatMap((i) => [links[i].from, links[i].to])]), hot)
		} else lightPicture(picture, restOf(picture))
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
