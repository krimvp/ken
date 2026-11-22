// The Architecture page: one canvas for the project's parts. The blocks of one level stand on it with their
// connectors, each connector with its verb. The reader pans it, zooms it, fits it, and sees where they are on a small
// map of it. A press on a block opens its brief. A second press, or the block's corner, opens the part in place into
// its own blocks, and then into files, and a breadcrumb says how deep they are. The layers lay a second reading over
// the same blocks, and one tool asks ken's model to draw the level another way.
import { keyHtml, switchCardHtml, viewDrawing, viewOn, viewsOffered } from '../arch-views/switch.js'
import { arrowId, partId, processId } from '../brief/concept-id.js'
import { diagramOf } from '../level/content.js'
import { colourOf, projectName } from '../level/level-state.js'
import { DOING } from '../level/runs.js'
import { icon, partIcon } from '../shell/icons.js'
import { count, esc, pathList, prose, RUN_COST } from '../views/format.js'
import { blockHtml } from './blocks.js'
import { drawToolHtml } from './draw-tool.js'
import { changeChoices, LAYER_NAMES, processStops } from './layers.js'
import { layoutOf } from './layout.js'

// Room around the blocks of a part the reader went inside, for the frame in the part's colour and its heading.
const FRAME = { side: 56, top: 132, bottom: 56 }

const layouts = new WeakMap()

// A level is laid out once for a wide window and once for a narrow one: placing tries every order of its blocks.
export function levelLayout(look, column) {
	const kept = layouts.get(look) ?? {}
	const key = column ? 'column' : 'grid'
	if (!kept[key]) {
		kept[key] = layoutOf(look, column)
		layouts.set(look, kept)
	}
	return kept[key]
}

// The size of everything the canvas draws for a level: its blocks, and the frame around them inside a part.
export function worldOf(layout, inside) {
	const bow = layout.bow
	if (!inside) return { x: 0, y: -bow, w: layout.width, h: layout.height + 2 * bow }
	return {
		x: -FRAME.side,
		y: -FRAME.top - bow,
		w: layout.width + 2 * FRAME.side,
		h: layout.height + FRAME.top + FRAME.bottom + 2 * bow,
	}
}

// The drawn processes of the level on screen, each with its diagram once the page has read the reply that holds it.
export function processesOf(home) {
	return home.pictures.slice(1).map((picture) => ({
		id: picture.id,
		name: picture.title ?? picture.asked,
		diagram: diagramOf(home.replies.get(picture.id)),
	}))
}

function crumbHtml(home) {
	const colour = home.trail.length > 1 ? colourOf(home)('') : ''
	const steps = home.trail.map((step, i) => {
		const here = i === home.trail.length - 1
		const name = i === 0 ? projectName(home) : step.name
		const swatch = i === 0 ? '' : `<span class="k-sw ${colour}"></span>`
		const sep = i === 0 ? '' : '<span class="k-crumb-sep" aria-hidden="true">/</span>'
		return `${sep}<button data-act="arch-crumb" data-index="${i}" data-key="crumb-${i}"${here ? ' aria-current="location"' : ''}>${swatch}${esc(name)}</button>`
	})
	return `<nav class="k-float k-crumb" aria-label="How deep you are in the project">${steps.join('')}</nav>`
}

function layersHtml(arch) {
	const icons = { processes: 'processes', changes: 'changes', know: 'you' }
	const buttons = Object.entries(LAYER_NAMES).map(
		([layer, name]) =>
			`<button data-act="arch-layer" data-layer="${layer}" data-key="layer-${layer}" aria-pressed="${arch.layer === layer}">${icon(icons[layer])}${name}</button>`,
	)
	return `<div class="k-float k-layers" role="group" aria-label="Layers"><span class="k-float-label">${icon('layers')}Layers</span>${buttons.join('')}</div>`
}

// Under the layers, what the layer on show lets the reader pick: one process, or one span of commits.
function layerPickHtml(home, arch, processes) {
	if (arch.layer === 'processes') {
		if (processes.length === 0) {
			return `<div class="k-float k-layer-pick"><span class="k-float-note">No process is drawn for this level yet.</span><button data-act="arch-draw" data-key="pick-draw">${icon('pencil')}Draw one</button></div>`
		}
		const picks = processes.map(
			(process) =>
				`<button data-act="arch-process" data-id="${esc(process.id)}" data-key="process-${esc(process.id)}" aria-pressed="${arch.process === process.id}" title="${esc(process.name)}"><span class="k-clip">${prose(process.name)}</span></button>`,
		)
		const on = processes.find((process) => process.id === arch.process)
		const brief = on
			? `<button class="k-pick-brief" data-act="brief-open" data-concept="${esc(processId(on.id))}" data-key="process-brief">${icon('right')}Its brief</button>`
			: ''
		return `<div class="k-float k-layer-pick" role="group" aria-label="The process on show">${picks.join('')}${brief}</div>`
	}
	if (arch.layer === 'changes') {
		const picks = changeChoices(home.changes).map(
			(choice) =>
				`<button data-act="arch-change" data-change="${esc(choice.change)}" data-key="change-${esc(choice.change)}" aria-pressed="${home.change === choice.change}">${choice.merge ? icon('merge') : ''}${esc(choice.name)}</button>`,
		)
		if (picks.length === 0)
			return '<div class="k-float k-layer-pick"><span class="k-float-note">No commit landed in the last 90 days.</span></div>'
		return `<div class="k-float k-layer-pick" role="group" aria-label="The commits on show">${picks.join('')}</div>`
	}
	return ''
}

// One line under the canvas's top row for what the level is, when it is not the named parts of the commit checked out.
function notesHtml(home, env, arch, stops) {
	const { look } = home
	const said = []
	if (look.at !== look.head) {
		said.push(`You are looking at commit <code>${esc(look.at.slice(0, 7))}</code>, not the one checked out now.`)
	}
	if (!look.named && look.boxes.length > 0 && !look.boxes.every((box) => box.files === 1)) {
		const where = home.trail.length === 1 ? 'of this project' : 'in here'
		const name = `<button class="k-link" data-act="run-name" data-key="run-name"${env.off ? ' disabled' : ''}>Ask ken to name them</button> <span class="k-muted">${env.off ? esc(env.off) : RUN_COST}</span>`
		said.push(`These blocks are folders. ken's model has not named the parts ${where} yet. ${name}`)
	}
	const unexplained = (look.explained ?? 0) < look.boxes.length
	if (look.named && look.at === look.head && home.content.kind === 'level' && unexplained && !env.running) {
		const button = `<button class="k-link" data-act="run-explain" data-key="run-explain"${env.off ? ' disabled' : ''}>Ask ken to explain these parts</button>`
		said.push(
			`ken's model has not explained these parts yet. ${button} <span class="k-muted">${env.off ? esc(env.off) : RUN_COST}</span>`,
		)
	}
	if (arch.layer === 'changes' && look.change) {
		const outside = look.change.outside ?? []
		const more = outside.length > 0 ? ` ${count(outside.length, 'changed file', 'changed files')} in no part.` : ''
		said.push(
			look.change.files === 0
				? 'These commits touched no file here.'
				: `${count(look.change.commits.length, 'commit', 'commits')}, ${count(look.change.files, 'file', 'files')}.${more}`,
		)
	}
	if (arch.layer === 'processes' && arch.process && stops && stops.count === 0) {
		said.push('ken could not place the steps of this process in the parts of this level.')
	}
	if (look.named?.asked) {
		said.push(
			`ken's model drew it the way you asked, "${esc(look.named.asked)}". <button class="k-link" data-act="home-back" data-key="home-back">Go back to the picture before</button>${home.backProblem ? ` ${esc(home.backProblem)}` : ''}`,
		)
	}
	if (look.loose.length > 0 && arch.layer === null) {
		said.push(
			`<details data-key="arch-loose"><summary>${count(look.loose.length, 'file or folder', 'files and folders')} at this level ${look.loose.length === 1 ? 'is' : 'are'} in no ${look.named ? 'part' : 'block'}.</summary><p>${pathList(look.loose)}.</p></details>`,
		)
	}
	return said.length === 0
		? ''
		: `<div class="k-float k-notes" role="status">${said.map((line) => `<p>${line}</p>`).join('')}</div>`
}

// What a run of ken's model the canvas started is doing, and what the last one left to say.
function runHtml(home, env) {
	const run = env.running?.onHome
	if (run && DOING[run.kind]) {
		const tools = env.running.q.steps.filter((step) => step.kind === 'tool').length
		return `<div class="k-float k-run" role="status"><span class="k-spin" aria-hidden="true"></span><span><b>${DOING[run.kind][1]}.</b> <span class="k-clock k-num">${Math.round(env.seconds)} s so far, ${count(tools, 'action', 'actions')}</span></span><button class="k-link" data-act="stop" data-key="run-stop">Stop</button></div>`
	}
	const close = (act) =>
		`<button class="k-icon-btn" data-act="${act}" data-key="${act}" aria-label="Close this">${icon('close')}</button>`
	if (home.ended?.kind === 'nothing') {
		const why = home.ended.outcome === 'stopped' ? 'You stopped the run.' : "ken's model made nothing to show for that."
		const reply = home.ended.id
			? ` <button class="k-link" data-act="open" data-id="${esc(home.ended.id)}" data-key="ended-reply">Read its reply</button>`
			: ''
		return `<div class="k-float k-run" role="status"><span>${why}${home.ended.error ? ` ${esc(home.ended.error)}` : ''}${reply}</span>${close('home-ended-close')}</div>`
	}
	if (home.ended?.kind === 'elsewhere') {
		return `<div class="k-float k-run" role="status"><span>The run for ${esc(home.ended.level)} ended. <button class="k-link" data-act="home-run-go" data-key="run-go">Go there</button></span>${close('home-ended-close')}</div>`
	}
	if (home.said) {
		const words = home.said.q.reply?.items.find((item) => item.kind === 'words')?.text ?? ''
		const reply = home.said.q.id
			? ` <button class="k-link" data-act="open" data-id="${esc(home.said.q.id)}" data-key="said-reply">Read the whole reply</button>`
			: ''
		return `<div class="k-float k-run is-said" role="status"><span><b>You asked: "${esc(home.said.asked)}".</b> ${prose(words)}${reply}</span>${close('home-said-close')}</div>`
	}
	if (home.trouble) {
		return `<div class="k-float k-run" role="alert"><span>${esc(home.trouble.said)} ${esc(home.trouble.message)}</span>${close('home-trouble-close')}</div>`
	}
	return ''
}

function toolsHtml(arch) {
	return `<div class="k-float k-tools">
		<button class="k-tool" data-act="arch-draw" data-key="arch-draw" aria-expanded="${arch.drawOpen}" aria-label="Draw it another way">${icon('pencil')}<span>Draw it another way</span></button>
		<div class="k-zoom" role="group" aria-label="Zoom">
			<button data-act="arch-zoom" data-by="-1" data-key="zoom-out" aria-label="Zoom out">${icon('minus')}</button>
			<span class="k-num" id="arch-zoom">100%</span>
			<button data-act="arch-zoom" data-by="1" data-key="zoom-in" aria-label="Zoom in">${icon('plus')}</button>
			<button data-act="arch-fit" data-key="zoom-fit" aria-label="Fit the whole level">${icon('fit')}</button>
		</div>
	</div>`
}

// rects are what the small map shows: [{ x, y, w, h, cls }].
function minimapHtml(rects, world) {
	const pad = 40
	const shapes = rects.map(
		(at) =>
			`<rect class="k-mm ${at.cls}" x="${at.x}" y="${at.y}" width="${at.w}" height="${at.h}" rx="${at.rx ?? 12}"/>`,
	)
	return `<div class="k-float k-minimap"><svg id="arch-minimap" viewBox="${world.x - pad} ${world.y - pad} ${world.w + 2 * pad} ${world.h + 2 * pad}" aria-hidden="true">${shapes.join('')}<rect class="k-mm-view" id="arch-mm-view" rx="16"/></svg></div>`
}

// The least zoom a drawing of where the project runs is fitted at: its words are 19.5 units, 12.5 pixels at 65%.
const LEGIBLE = 0.65

const READING = '<p class="k-canvas-line" role="status">Reading the project from git.</p>'

// view is { home, arch, env, brief, column }: the level and what is laid over it, the canvas's own state, what the
// page around it is doing, the id of the open brief, and whether the window is narrow.
export function architectureHtml({ home, arch, env, brief, column }) {
	const { look, problem } = home
	const offered = viewsOffered(home)
	const on = viewOn(arch, offered)
	const top = switchCardHtml({ home, arch, env, crumb: crumbHtml(home), offered, on })
	if (!look || home.reading === 'level') return `<div class="k-canvas">${top}${problem ? '' : READING}</div>`
	if (problem && !problem.keeps) {
		return `<div class="k-canvas">${top}<p class="k-canvas-line" role="alert">ken could not show this. ${prose(problem.message)} <button class="k-link" data-act="home-reset" data-key="home-reset">Show where you are now</button></p></div>`
	}
	const inside = home.trail.length > 1
	const layout = levelLayout(look, column)
	const world = worldOf(layout, inside)
	const colour = colourOf(home)
	const processes = processesOf(home)
	const process = processes.find((each) => each.id === arch.process) ?? null
	const stops = arch.layer === 'processes' && process?.diagram ? processStops(process.diagram, look.boxes) : null
	const classes = look.boxes.map((box) => colour(box.name))
	if (on !== 'parts') {
		const drawn = viewDrawing({
			home,
			arch,
			on,
			projectName: projectName(home),
			view: {
				home,
				layer: arch.layer,
				process: arch.process,
				brief,
				colour,
				boxes: new Map(look.boxes.map((box) => [box.name, box])),
				stops: new Map(look.boxes.map((box, i) => [box.name, stops?.byBlock[i] ?? []])),
			},
		})
		return canvasHtml({
			home,
			arch,
			env,
			brief,
			view: on,
			world: drawn.world,
			focus: drawn.focus,
			inner: drawn.html,
			top,
			notes: notesHtml(home, env, arch, stops),
			processes,
			minimap: minimapHtml(drawn.rects, drawn.world),
			hint: "Press a block, a frame's name or a line's label for its brief.",
		})
	}
	const blocks = look.boxes.map((box, i) =>
		blockHtml(box, i, layout.blocks[i], {
			home,
			layer: arch.layer,
			stops: stops?.byBlock[i] ?? [],
			colour: classes[i],
			picked: brief === partId(look.within, box.name),
		}),
	)
	const wires = layout.links.map((link) => `<path class="k-wire" d="${link.d}" marker-end="url(#k-head)"/>`)
	const verbs = layout.links.map((link) => {
		const arrow = look.arrows[link.index]
		const id = arrowId(look.within, link.index + 1)
		return `<button class="k-verb" style="left:${link.mid.x}px;top:${link.mid.y}px" data-act="brief-open" data-concept="${esc(id)}" data-key="verb-${link.index}" aria-pressed="${brief === id}" aria-label="${esc(`${arrow.from} ${arrow.text} ${arrow.to}`)}">${esc(arrow.text)}</button>`
	})
	const framed = inside
		? `<div class="k-frame ${colour('')}" style="left:${world.x}px;top:${world.y}px;width:${world.w}px;height:${world.h}px"><h2 class="k-frame-head"><span class="k-blk-icon">${icon(partIcon(home.trail.at(-1).name))}</span>${esc(home.trail.at(-1).name)}</h2></div>`
		: ''
	const empty = look.boxes.length === 0 ? '<p class="k-canvas-line">Nothing is here at this commit.</p>' : ''
	const svg = `<svg class="k-wires" width="${world.w}" height="${world.h}" viewBox="${world.x} ${world.y} ${world.w} ${world.h}" style="left:${world.x}px;top:${world.y}px" aria-hidden="true"><defs><marker id="k-head" viewBox="0 0 12 12" refX="10.500" refY="6" markerWidth="4.200" markerHeight="4.200" orient="auto"><path d="M0 0.500L12 6L0 11.500z"/></marker></defs>${wires.join('')}</svg>`
	return canvasHtml({
		home,
		arch,
		env,
		brief,
		view: 'parts',
		world,
		inner: `${framed}${svg}${blocks.join('')}${verbs.join('')}`,
		empty,
		top,
		notes: notesHtml(home, env, arch, stops),
		processes,
		minimap: minimapHtml(
			layout.blocks.map((at, i) => ({ ...at, cls: classes[i], rx: 34 })),
			world,
		),
		hint: look.boxes.length === 0 ? '' : `Press a block for its brief. Press ${icon('inside')} to go inside it.`,
	})
}

// The canvas around a drawing: the world the camera moves, and what floats over it.
function canvasHtml({
	home,
	arch,
	env,
	brief,
	view,
	world,
	focus,
	inner,
	empty = '',
	top,
	notes,
	processes,
	minimap,
	hint,
}) {
	const shownHint = hint === '' || notes !== '' || env.running?.onHome ? '' : `<p class="k-hint">${hint}</p>`
	return `<div class="k-canvas view-${view}${arch.layer ? ` layer-${arch.layer}` : ''}${brief ? ' has-brief' : ''}" id="arch-canvas" data-world="${world.x} ${world.y} ${world.w} ${world.h}"${view === 'parts' ? '' : ` data-least="${LEGIBLE}" data-focus="${focus.x} ${focus.y}"`}>
		<div class="k-world" id="arch-world"${home.reading ? ' inert' : ''}>
			${inner}
		</div>
		${empty}
		${top}
		${layersHtml(arch)}
		${layerPickHtml(home, arch, processes)}
		${keyHtml(arch)}
		<div class="k-under">${runHtml(home, env)}${notes}</div>
		${home.reading ? READING : ''}
		${toolsHtml(arch)}
		${arch.drawOpen ? drawToolHtml(home, env.off) : ''}
		${minimap}
		${shownHint}
	</div>`
}
