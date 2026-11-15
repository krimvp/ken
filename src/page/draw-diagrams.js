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
function config() {
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
		flowchart: { useMaxWidth: false, diagramPadding: 0 },
		sequence: { useMaxWidth: false, mirrorActors: false, width: 120, actorMargin: 30, diagramMarginX: 0 },
		er: { useMaxWidth: false },
	}
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

function widthOf(svg) {
	return Number(svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)?.[1] ?? 0)
}

// ken writes every flowchart left to right. When that is wider than the box, top to bottom often fits; the narrower
// of the two is kept, and the box scrolls sideways if it is still too wide.
async function drawToFit(text, width) {
	const mermaid = await loadMermaid()
	mermaid.initialize(config())
	const across = await draw(mermaid, text)
	if (!text.startsWith('flowchart LR') || widthOf(across) <= width) return across
	const down = await draw(mermaid, text.replace('flowchart LR', 'flowchart TB'))
	return widthOf(down) < widthOf(across) ? down : across
}

// Fills each drawing box on the page from the drawings made so far, and starts the ones that are missing; redraw runs
// once one is ready. A drawing is { kind: 'drawing' }, { kind: 'drawn', svg } or { kind: 'failed' }, kept by theme, box
// width and Mermaid text, which the server wrote into data-mermaid.
export function fillDrawings(root, redraw) {
	for (const box of root.querySelectorAll('[data-mermaid]')) {
		const text = box.dataset.mermaid
		const width = Math.round(box.clientWidth / 10) * 10
		const key = `${dark() ? 'dark' : 'light'} ${width} ${text}`
		if (!drawings.has(key)) {
			drawings.set(key, { kind: 'drawing' })
			void drawToFit(text, width)
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
	}
}
