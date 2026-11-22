// The seventeen small drawings a thing to know can stand beside. ken's model picks one by name for each point, and
// the page draws it here, so no picture is ever made up by the model. Each is drawn in the ink of the text around it
// and filled with the colour of the part the brief is about. A name the page does not know draws as "dot". A
// drawing's label is not drawn in it: the brief writes it under the drawing, at a size a reader can read.
const [W, H] = [96, 56]
const INK = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
const FULL = 'fill="var(--k-pc)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"'
const HOLLOW = 'fill="var(--k-surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"'
const head = (x, y, turn = 0) => `<path d="M-5 -4L0 0L-5 4" transform="translate(${x} ${y}) rotate(${turn})" ${INK}/>`

const within = (value, least, most, otherwise) =>
	Number.isInteger(value) && value >= least && value <= most ? value : otherwise

// count things spread evenly from lo to hi.
const spread = (count, lo, hi) => Array.from({ length: count }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / count)

const DRAW = {
	steps({ count, lit }) {
		const n = within(count, 2, 8, 4)
		const on = within(lit, 1, n, 1)
		const size = Math.min(14, 76 / n - 3)
		const boxes = spread(n, 8, 88).map(
			(x, i) =>
				`<rect x="${x - size / 2}" y="${22 - size / 2}" width="${size}" height="${size}" rx="3" ${i + 1 === on ? FULL : HOLLOW}/>`,
		)
		return `${boxes.join('')}<path d="M10 42H84" ${INK}/>${head(86, 42)}`
	},
	gate() {
		return `<path d="M8 28H38M58 28H84" ${INK}/>${head(86, 28)}<path d="M42 12V44M54 12V44" ${INK}/><rect x="40" y="20" width="16" height="16" rx="4" ${FULL}/><path d="M44 28l3 3 6-7" ${INK}/><circle cx="20" cy="28" r="5" ${HOLLOW}/>`
	},
	swap() {
		return `<rect x="12" y="20" width="26" height="18" rx="4" ${HOLLOW} stroke-dasharray="4 4"/><rect x="58" y="20" width="26" height="18" rx="4" ${FULL}/><path d="M26 15C36 4 60 4 70 14" ${INK}/>${head(71, 15, 50)}<path d="M70 44C60 54 36 54 26 44" ${INK}/>${head(25, 43, 230)}`
	},
	log({ count }) {
		const n = within(count, 2, 5, 4)
		const lines = spread(n, 8, 50).map(
			(y, i) => `<rect x="18" y="${y - 3.5}" width="50" height="7" rx="3" ${i === n - 1 ? FULL : HOLLOW}/>`,
		)
		return `${lines.join('')}<path d="M80 12V40" ${INK}/>${head(80, 42, 90)}`
	},
	once() {
		return `<rect x="6" y="20" width="18" height="16" rx="4" ${HOLLOW}/><path d="M27 28H34" ${INK}/>${head(36, 28)}<path d="M48 14l9 3v10c0 7-4 11-9 14-5-3-9-7-9-14V17z" ${FULL}/><path d="M44 28l3 3 6-7" ${INK}/><path d="M61 28H68" ${INK}/>${head(70, 28)}<rect x="74" y="26" width="16" height="13" rx="3" ${FULL}/><path d="M78 26v-4a4 4 0 0 1 8 0v4" ${INK}/>`
	},
	fanout({ count }) {
		const ys = spread(within(count, 2, 5, 3), 4, 52)
		return `${ys.map((y) => `<path d="M26 28C46 28 46 ${y} 68 ${y}" ${INK}/><circle cx="76" cy="${y}" r="6" ${HOLLOW}/>`).join('')}<circle cx="18" cy="28" r="9" ${FULL}/>`
	},
	fanin({ count }) {
		const ys = spread(within(count, 2, 5, 3), 4, 52)
		return `${ys.map((y) => `<path d="M26 ${y}C48 ${y} 48 28 68 28" ${INK}/><circle cx="18" cy="${y}" r="6" ${HOLLOW}/>`).join('')}<circle cx="78" cy="28" r="9" ${FULL}/>`
	},
	loop({ count }) {
		const n = within(count, 2, 8, 3)
		const dots = Array.from({ length: n }, (_, i) => {
			const turn = (i / n) * 2 * Math.PI - Math.PI / 2
			return `<circle cx="${48 + 19 * Math.cos(turn + 0.6)}" cy="${28 + 19 * Math.sin(turn + 0.6)}" r="3.500" ${FULL}/>`
		})
		return `<path d="M48 9a19 19 0 1 1-16 9" ${INK}/>${head(33, 16, -50)}${dots.join('')}`
	},
	queue({ count }) {
		const xs = spread(within(count, 2, 6, 4), 6, 66)
		return `${xs.map((x, i) => `<circle cx="${x}" cy="28" r="6" ${i === xs.length - 1 ? FULL : HOLLOW}/>`).join('')}<path d="M74 10V46" ${INK}/><path d="M78 28H86" ${INK}/>${head(88, 28)}`
	},
	store() {
		return `<path d="M28 22v20c0 4 9 7 20 7s20-3 20-7V22" ${HOLLOW}/><ellipse cx="48" cy="22" rx="20" ry="7" ${FULL}/><path d="M48 3V11" ${INK}/>${head(48, 13, 90)}<path d="M28 32c0 4 9 7 20 7s20-3 20-7" ${INK}/>`
	},
	wall() {
		return `<rect x="6" y="18" width="24" height="20" rx="4" ${FULL}/><rect x="66" y="18" width="24" height="20" rx="4" ${HOLLOW}/><rect x="42" y="6" width="12" height="44" rx="2" ${HOLLOW}/><path d="M42 17h12M42 28h12M42 39h12M48 6v11M48 28v11" ${INK}/>`
	},
	clock() {
		return `<circle cx="34" cy="28" r="19" ${HOLLOW}/><path d="M34 16v12l8 5" ${INK}/><path d="M34 9a19 19 0 0 1 19 19H34z" fill="var(--k-pc)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M66 12V44M66 28H88" ${INK}/>`
	},
	cut() {
		return `<rect x="8" y="20" width="46" height="16" rx="4" ${FULL}/><rect x="54" y="20" width="32" height="16" rx="4" ${HOLLOW} stroke-dasharray="4 4"/><path d="M54 8V48" ${INK}/>`
	},
	eye() {
		return `<path d="M8 28C20 10 76 10 88 28C76 46 20 46 8 28z" ${HOLLOW}/><circle cx="48" cy="28" r="10" ${FULL}/><circle cx="48" cy="28" r="3.500" fill="currentColor"/>`
	},
	fork() {
		return `<path d="M8 28H36C52 28 52 12 70 12M36 28C52 28 52 44 70 44" ${INK}/>${head(72, 12)}${head(72, 44)}<circle cx="82" cy="12" r="6" ${FULL}/><circle cx="82" cy="44" r="6" ${HOLLOW}/><circle cx="12" cy="28" r="5" ${HOLLOW}/>`
	},
	link() {
		return `<rect x="10" y="17" width="42" height="22" rx="11" ${HOLLOW}/><rect x="44" y="17" width="42" height="22" rx="11" fill="none" stroke="currentColor" stroke-width="2"/><rect x="44" y="24" width="8" height="8" fill="var(--k-pc)" stroke="none"/><path d="M44 17a11 11 0 0 0 0 22" ${INK}/>`
	},
	dot() {
		return `<circle cx="48" cy="28" r="9" ${FULL}/>`
	},
}

export const DRAWINGS = Object.keys(DRAW)

// drawing is { kind, count, lit, label } as a brief's point carries it, or nothing. label is written by the caller.
export function drawingHtml(drawing) {
	const draw = Object.hasOwn(DRAW, drawing?.kind ?? '') ? DRAW[drawing.kind] : DRAW.dot
	return `<svg class="k-drawing" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${draw(drawing ?? {})}</svg>`
}
