// Draws an answer's diagrams with Mermaid. ken's server wrote each Mermaid text from checked data, so the model never
// writes diagram syntax. Mermaid loads from ken's own address, and only once an answer has a diagram. A drawing that
// fails leaves the numbered list under it, which says the same in words.

const drawings = new Map()
let mermaidLoad = null
let counter = 0

// What a drawing box shows until its picture is ready, and when drawing fails.
export const DRAWING = 'Drawing the diagram.'
export const NOT_DRAWN = 'ken could not draw this diagram here. The numbered list under it says the same in words.'

function loadMermaid() {
	mermaidLoad ??= new Promise((resolve, reject) => {
		const script = document.createElement('script')
		script.src = 'mermaid.min.js'
		script.onload = () =>
			window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid.min.js set no mermaid'))
		script.onerror = () => reject(new Error('mermaid.min.js did not load'))
		document.head.append(script)
	})
	return mermaidLoad
}

function dark() {
	return matchMedia('(prefers-color-scheme: dark)').matches
}

// Mermaid's base theme takes plain colours, so each token is read as the browser resolved it for the current theme.
// actor is the size of a sequence diagram's participant boxes: wider when the column has room, taller when a name takes
// more than one line.
function config(actor) {
	const css = getComputedStyle(document.documentElement)
	const token = (name) => css.getPropertyValue(name).trim()
	const text = token('--color-text')
	const box = token('--color-label-bg')
	const edge = token('--color-accent')
	const line = token('--color-muted')
	const card = token('--color-card')
	return {
		startOnLoad: false,
		securityLevel: 'strict',
		suppressErrorRendering: true,
		theme: 'base',
		look: 'classic',
		fontFamily: token('--font-text'),
		themeVariables: {
			darkMode: dark(),
			fontFamily: token('--font-text'),
			fontSize: '16px',
			background: card,
			textColor: text,
			primaryColor: box,
			primaryTextColor: text,
			primaryBorderColor: edge,
			secondaryColor: token('--color-code-bg'),
			tertiaryColor: token('--color-bg'),
			lineColor: line,
			mainBkg: box,
			nodeBorder: edge,
			nodeTextColor: text,
			clusterBkg: token('--color-bg'),
			clusterBorder: token('--color-border'),
			titleColor: text,
			edgeLabelBackground: card,
			actorBkg: box,
			actorBorder: edge,
			actorTextColor: text,
			actorLineColor: token('--color-border'),
			signalColor: line,
			signalTextColor: text,
			labelBoxBkgColor: box,
			labelBoxBorderColor: edge,
			labelTextColor: text,
			attributeBackgroundColorOdd: card,
			attributeBackgroundColorEven: token('--color-code-bg'),
		},
		// Tight spacing, and sequence labels broken into lines by breakSequence, so a diagram at the bounds (6 parts,
		// 8 arrows) fits the answer column at 1440 pixels: six participants take 6 x 120 + 5 x 8 pixels.
		flowchart: { useMaxWidth: false, diagramPadding: 4, nodeSpacing: 24, rankSpacing: 36, wrappingWidth: 140 },
		sequence: {
			useMaxWidth: false,
			mirrorActors: false,
			width: actor.width,
			actorMargin: ACTOR_MARGIN,
			wrapPadding: 4,
			boxMargin: 4,
			height: actor.height,
			diagramMarginX: 4,
			diagramMarginY: 4,
		},
		er: { useMaxWidth: false, nodeSpacing: 24, rankSpacing: 36, entityPadding: 3, minEntityWidth: 60 },
	}
}

// A drawing wider than its box shrinks until its smallest text is this many pixels, and scrolls sideways from there.
const SMALLEST_TEXT = 14

// A drawing is at most this much shorter than the window, so the caption above it and the head of the next part of the
// answer fit on one screen with it.
const ROOM_AROUND = 280

function tallest() {
	return innerHeight - ROOM_AROUND
}

function smallestText(svg) {
	const sizes = [...svg.querySelectorAll('text, tspan, span, div, p')]
		.filter((el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
		.map((el) => Number.parseFloat(getComputedStyle(el).fontSize))
	return sizes.length === 0 ? SMALLEST_TEXT : Math.min(...sizes)
}

// Shrinks a drawing to the column, but never so far that its smallest text drops under SMALLEST_TEXT. The frame around
// the box fades the cut edge while part of a wide drawing is out of sight.
function fit(box, drawing) {
	const frame = box.parentElement
	const svg = box.querySelector('svg')
	if (!svg) {
		frame.classList.remove('wide')
		return false
	}
	drawing.smallest ??= smallestText(svg)
	const natural = svg.viewBox.baseVal.width
	const style = getComputedStyle(box)
	const room = box.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
	// A drawing taller than tallest() shrinks too, as far as the same floor allows.
	const tall = tallest() / svg.viewBox.baseVal.height
	const scale = Math.min(1, Math.max(SMALLEST_TEXT / drawing.smallest, Math.min(room / natural, tall)))
	svg.style.width = `${natural * scale}px`
	const wide = natural * scale > room + 1
	frame.classList.toggle('wide', wide)
	const atEnd = () => frame.classList.toggle('at-end', box.scrollLeft + box.clientWidth >= box.scrollWidth - 1)
	box.addEventListener('scroll', atEnd)
	atEnd()
	return wide
}

// Mermaid wraps a sequence label by cutting long words, and it cuts through the entity codes ken writes for characters
// such as "{" or ",", which then show as garbage. So the page breaks each label itself, only between words, into lines
// of about as many characters as fit between the participants a message joins. The participants spread across the
// column, so a label uses the room there is. It adds nothing but <br> between words that ken's server already made safe.
const CHAR_PX = 8.5
const LINE_PX = 20
const ACTOR_MARGIN = 8
const ACTOR_WIDTH = { least: 120, most: 180 }

function participantsOf(text) {
	const order = new Map()
	for (const line of text.split('\n')) {
		const id = line.match(/^ {2}participant (n\d+) as /)?.[1]
		if (id) order.set(id, order.size)
	}
	return order
}

// Six participants at 1440 pixels keep the narrowest boxes; two get wide boxes and long label lines.
function actorWidth(text, room) {
	const n = participantsOf(text).size
	return Math.round(Math.min(ACTOR_WIDTH.most, Math.max(ACTOR_WIDTH.least, room / n - ACTOR_MARGIN)))
}

function breakSequence(text, room, width) {
	const order = participantsOf(text)
	// The room between the middles of two participants next to each other, when they spread across the column.
	const gap = Math.max(width + ACTOR_MARGIN, (room - width) / Math.max(1, order.size - 1))
	return text
		.split('\n')
		.map((line) => {
			const actor = line.match(/^( {2}participant n\d+ as )(.*)$/)
			if (actor) return actor[1] + inLines(actor[2], Math.floor((width - 16) / CHAR_PX))
			const message = line.match(/^( {2}(n\d+)->>(n\d+): )(.*)$/)
			if (!message) return line
			const gaps = Math.max(1, Math.abs(order.get(message[2]) - order.get(message[3])))
			return message[1] + inLines(message[4], Math.floor((gaps * gap) / CHAR_PX))
		})
		.join('\n')
}

// Mermaid measures a line before it turns each entity code back into its character, while the code still stands as a
// placeholder about six characters wide, so a code counts as six.
function inLines(label, most) {
	const shown = (words) => words.replaceAll(/#\d+;/g, '######').length
	const lines = []
	for (const word of label.split(' ')) {
		// A long word such as "desk.ask(chat," may break after a code, here after "(" or ",", and never inside one.
		for (const [i, piece] of word.split(/(?<=#\d+;)/).entries()) {
			const last = lines.at(-1)
			const joined = i === 0 ? `${last} ${piece}` : `${last}${piece}`
			if (last !== undefined && shown(joined) <= most) lines[lines.length - 1] = joined
			else lines.push(piece)
		}
	}
	return lines.join('<br>')
}

async function draw(mermaid, text) {
	const id = `ken-drawing-${++counter}`
	try {
		const { svg } = await mermaid.render(id, text)
		return svg
	} finally {
		// Mermaid measures in a box it adds to the page, and can leave it there when it fails.
		document.getElementById(`d${id}`)?.remove()
	}
}

function sizeOf(svg) {
	const [, width = 0, height = 0] = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)/) ?? []
	return { width: Number(width), height: Number(height) }
}

// How far a drawing must shrink to fit the column and the height limit: 1 is not at all. Of two layouts the one that
// shrinks less wins, and the shorter one when neither shrinks.
function better(a, b, room) {
	const shrink = (svg) => {
		const { width, height } = sizeOf(svg)
		return Math.min(1, room / width, tallest() / height)
	}
	const [sa, sb] = [shrink(a), shrink(b)]
	if (Math.abs(sa - sb) > 0.01) return sa > sb ? a : b
	return sizeOf(a).height <= sizeOf(b).height ? a : b
}

// ken writes a flowchart left to right and an entity diagram top to bottom. The page also draws the other way and
// keeps the layout that fits the column and the screen better.
async function drawToFit(text, room) {
	const mermaid = await loadMermaid()
	if (text.startsWith('sequenceDiagram')) {
		const width = actorWidth(text, room)
		const broken = breakSequence(text, room, width)
		const lines = Math.max(
			...broken.split('\n').map((line) => (line.startsWith('  participant') ? line.split('<br>').length : 1)),
		)
		mermaid.initialize(config({ width, height: 30 + lines * LINE_PX }))
		return await draw(mermaid, broken)
	}
	mermaid.initialize(config({ width: ACTOR_WIDTH.least, height: 50 }))
	const other = text.startsWith('flowchart LR')
		? text.replace('flowchart LR', 'flowchart TB')
		: text.replace('erDiagram', 'erDiagram\n  direction LR')
	const first = await draw(mermaid, text)
	return better(first, await draw(mermaid, other), room)
}

// Fills each drawing box on the page from the drawings made so far, and starts the ones that are missing; redraw runs
// once one is ready. A drawing is { kind: 'drawing' }, { kind: 'drawn', svg } or { kind: 'failed' }, kept by theme, box
// width and Mermaid text, which the server wrote into data-mermaid. A drawn one also keeps the size of its smallest text.
// A message label in a sequence diagram sits where lifelines run, and Mermaid draws it with no background. Each line of
// it gets a box in the colour of the card behind it, so no line runs through the text. The size of the text is known
// only once it is on the page.
function backLabels(svg) {
	for (const text of svg?.querySelectorAll('text.messageText') ?? []) {
		const { x, y, width, height } = text.getBBox()
		const back = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
		for (const [name, value] of Object.entries({ x: x - 3, y, width: width + 6, height, class: 'label-back' })) {
			back.setAttribute(name, String(value))
		}
		text.before(back)
	}
}

// Returns the numbers of the diagrams whose drawing is too wide for its box.
export function fillDrawings(root, redraw) {
	const tooWide = []
	for (const box of root.querySelectorAll('[data-mermaid]')) {
		const text = box.dataset.mermaid
		const style = getComputedStyle(box)
		const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
		const room = Math.round((box.clientWidth - padding) / 10) * 10
		const key = `${dark() ? 'dark' : 'light'} ${room} ${innerHeight} ${text}`
		if (!drawings.has(key)) {
			drawings.set(key, { kind: 'drawing' })
			void drawToFit(text, room)
				.then(
					(svg) => drawings.set(key, { kind: 'drawn', svg }),
					() => drawings.set(key, { kind: 'failed' }),
				)
				.then(redraw)
		}
		const drawing = drawings.get(key)
		box.innerHTML =
			drawing.kind === 'drawn'
				? drawing.svg
				: `<p class="drawing-note">${drawing.kind === 'failed' ? NOT_DRAWN : DRAWING}</p>`
		if (drawing.kind === 'drawn' && !drawing.backed) {
			backLabels(box.querySelector('svg'))
			drawing.svg = box.innerHTML
			drawing.backed = true
		}
		if (fit(box, drawing)) tooWide.push(Number(box.dataset.diagram))
	}
	return tooWide
}
