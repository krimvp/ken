// The switch between the drawings of the top level, in one card with the breadcrumb: "In its world", "Where it
// runs", "How the code is split", and the key. A drawing the project does not have is not offered. With none drawn,
// the card offers one run of ken's model to draw them. This module also lays out the drawing on show, once per
// drawing and fold, and says which lines a process lights.
import { esc, prose } from '../views/format.js'
import { mark, runtimeHtml, runtimePictureHtml, worldHtml } from './drawing.js'
import { runtimeLayout } from './runtime-layout.js'
import { worldLayout } from './world-layout.js'

// The run that draws both, by what it does: its title, and what ken's model is doing.
export const VIEWS_RUN = ['Drawing where it runs', "ken's model is drawing where the project runs and what it talks to"]

export const VIEW_NAMES = { world: 'In its world', runtime: 'Where it runs', parts: 'How the code is split' }
const VIEW_ICONS = { world: 'world', runtime: 'runs', parts: null }
// The question each view answers, said under the switch.
const VIEW_ASKS = { runtime: 'how it works', parts: 'where each thing is in the code', world: 'what it talks to' }

// The views the switch offers, in its order: the top level's drawings, given as top. How it works comes first and how
// the code is split second, since a reader learning a system asks them in that order. Below the top level only the
// parts are drawn, and the others take the reader back up.
export function viewsOffered(home, top = null) {
	const views = home.trail.length > 1 ? top : home.look?.views
	if (!views?.world && !views?.runtime) return []
	return [views.runtime ? 'runtime' : null, 'parts', views.world ? 'world' : null].filter(Boolean)
}

// The view on show: the reader's last choice when the level has it, else the first the switch offers.
export function viewOn(arch, offered) {
	return offered.includes(arch.view) ? arch.view : (offered[0] ?? 'parts')
}

// The view a concept from search is drawn in.
export function viewOfConcept(id, views) {
	const kind = id.slice(0, id.indexOf(':'))
	const rest = id.slice(id.indexOf(':') + 1)
	if (kind === 'frame' || kind === 'store') return 'runtime'
	if (kind === 'outside') return views?.world ? 'world' : 'runtime'
	if (kind === 'crossing') return views?.world?.crossings.some((c) => c.id === rest) ? 'world' : 'runtime'
	return null
}

function askHtml(home, env) {
	const run = env.running?.onHome
	if (run?.kind === 'views') {
		return `<p class="k-vw-run" role="status"><span class="k-spin" aria-hidden="true"></span><span><b>${VIEWS_RUN[1]}.</b> <span class="k-clock k-num">${Math.round(env.seconds)} s so far</span></span><button class="k-link" data-act="stop" data-key="views-stop">Stop</button></p>`
	}
	if (home.trail.length > 1 || !home.look?.named) return ''
	const said = env.off ?? "One run of ken's model, a few minutes."
	return `<p class="k-vw-ask"><button class="k-link" data-act="arch-draw-views" data-key="arch-draw-views"${env.off ? ' disabled' : ''}>${mark('runs')}Ask ken to draw where this runs</button><span class="k-muted">${esc(said)}</span></p>`
}

// crumb is the breadcrumb's HTML. problem is what the last run to draw them left to say.
export function switchCardHtml({ home, arch, env, crumb, offered, on, format, about }) {
	const reading = format === 'text'
	const formatButton = format
		? `<button class="k-link" data-act="arch-format" data-format="${reading ? 'drawing' : 'text'}" data-key="arch-format">${reading ? 'Show diagram' : 'Read as text'}</button>`
		: ''
	const head = `<div class="k-vw-head">${crumb}${formatButton}</div>`
	const summary = about ? `<p class="k-vw-asks">${prose(about)}</p>` : ''
	if (offered.length === 0) {
		const ask = askHtml(home, env)
		const problem = arch.viewsProblem ? `<p class="k-vw-problem" role="alert">${esc(arch.viewsProblem)}</p>` : ''
		return `<div class="k-float k-vw-card">${head}${summary}${ask}${problem}</div>`
	}
	const buttons = offered.map(
		(view) =>
			`<button data-act="arch-view" data-view="${view}" data-key="view-${view}" aria-pressed="${on === view}">${VIEW_ICONS[view] ? mark(VIEW_ICONS[view]) : '<svg class="k-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="6" rx="1.500"/><rect x="13" y="14" width="8" height="6" rx="1.500"/><path d="M11 7h3a3 3 0 0 1 3 3v4"/></svg>'}<span>${VIEW_NAMES[view]}</span></button>`,
	)
	const key =
		reading || !home.look?.named
			? ''
			: `<button class="k-vw-keybtn" data-act="arch-key" data-key="view-key" aria-expanded="${arch.keyOpen}">${mark('key')}<span>Key</span></button>`
	const asks = offered.map(
		(view) => `<span${view === on ? ' class="is-on"' : ''}>${VIEW_NAMES[view]} shows ${VIEW_ASKS[view]}.</span>`,
	)
	return `<div class="k-float k-vw-card">${head}<div class="k-vw-switch" role="group" aria-label="Which drawing">${buttons.join('')}${key}</div>${summary || (reading ? '' : `<p class="k-vw-asks">${asks.join(' ')}</p>`)}</div>`
}

const KEY_SHAPES = [
	[
		'<span class="k-key-frame"></span>',
		'A frame',
		'A place code runs: a browser, a machine, a cluster, a process. Its label opens what ken found.',
	],
	[
		'<span class="k-key-frame is-dashed"></span>',
		'A dashed frame',
		'A thread, a virtual machine or a sandbox, inside another frame.',
	],
	[
		'<span class="k-key-part"></span>',
		'A part',
		'A part of the code, in the same colour in every drawing. "2 copies" says how many run.',
	],
	[
		'<span class="k-key-part is-second"></span><span class="k-key-tie"></span>',
		'The same part again',
		'Small and dashed where it runs a second time. Dots tie the two places when one frame holds the other.',
	],
	[
		'<svg viewBox="0 0 40 30"><path d="M3 6v18c0 2.500 7.500 4 17 4s17-1.500 17-4V6"/><ellipse cx="20" cy="6" rx="17" ry="4"/></svg>',
		'A store',
		'A database, a cache, files.',
	],
	[
		'<span class="k-key-bus"><i class="k-rt-dot"></i><i class="k-rt-ring"></i></span>',
		'A bus',
		'One lane per topic. A full dot publishes on it; a ring picks up later.',
	],
	[
		'<span class="k-key-out"></span>',
		'Outside',
		'A system another team or company runs. A person is drawn as a person.',
	],
	[
		'<svg viewBox="0 0 48 16"><path class="k-key-call" d="M2 8H40"/><path d="M38 3l8 5-8 5z" class="k-key-head"/></svg>',
		'A call',
		'Solid. The caller waits for the answer. The label says how: HTTPS, SQL.',
	],
	[
		'<svg viewBox="0 0 48 16"><path class="k-key-event" d="M2 8H40"/><path d="M38 3l8 5-8 5z" class="k-key-head"/></svg>',
		'An event',
		'Dashed. Sent now and picked up later.',
	],
	[
		'<svg viewBox="0 0 48 16"><path class="k-key-call" d="M2 8H46"/><circle cx="24" cy="8" r="5" class="k-key-ring"/></svg>',
		'A crossing',
		"A ring where a line passes a frame's edge. Only these lines say how: a call inside one place does not.",
	],
]

const CAN = [
	[
		'Where code runs, and how many copies',
		'from compose files, Kubernetes manifests and the code that starts a process, a worker or a sandbox',
	],
	['Who calls whom', 'from client code and the addresses in settings'],
	['Topics, and who publishes and who picks up', 'from produce and consume calls'],
	['Stores, and who uses them', 'from connection strings and migrations'],
	['Outside systems and people', 'from host names, SDKs and entry points'],
]
const CANNOT = [
	['What is set only in a cloud console', 'regions, autoscaling as it runs, network rules'],
	['Other repositories', 'unless ken is given them'],
	['Traffic', 'how much, how fast, and what is failing now'],
	['Helm templates and Terraform', "ken cannot read them, so there the model's quoted lines stand alone"],
]

export function keyHtml(arch) {
	if (!arch.keyOpen) return ''
	const shapes = KEY_SHAPES.map(
		([shape, name, line]) =>
			`<li><span class="k-key-shape" aria-hidden="true">${shape}</span><span><b>${name}</b><span class="k-key-line">${line}</span></span></li>`,
	)
	const list = (rows, cls) =>
		rows.map(([name, line]) => `<li class="${cls}"><b>${name}</b><span class="k-key-line">${line}</span></li>`).join('')
	return `<section class="k-float k-vw-key" aria-labelledby="key-title">
		<div class="k-vw-key-head"><h2 id="key-title" tabindex="-1">Key</h2><button class="k-icon-btn" data-act="arch-key" data-key="key-close" aria-label="Close the key"><svg class="k-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
		<ul class="k-key-shapes">${shapes.join('')}</ul>
		<h3 class="k-eyebrow">What ken can draw from a repository</h3>
		<ul class="k-key-can">${list(CAN, 'is-can')}</ul>
		<h3 class="k-eyebrow">What it cannot</h3>
		<ul class="k-key-can">${list(CANNOT, 'is-cannot')}</ul>
		<p class="k-key-said">So a thing missing here may be missing from the repository, not from the system. Each thing drawn rests on lines ken found in git; its brief shows them.</p>
	</section>`
}

const runtimes = new WeakMap()
const worlds = new WeakMap()

// The layout of a drawing, made once for each drawing and fold.
function laidOut(views, on, folded, parts, narrow = false) {
	if (on === 'world') {
		if (!worlds.has(views)) worlds.set(views, worldLayout(views.world, parts))
		return worlds.get(views)
	}
	const kept = runtimes.get(views) ?? {}
	const key = `${folded ? 'folded' : 'open'}${narrow ? ', narrow' : ''}`
	kept[key] ??= runtimeLayout(views, { folded, narrow })
	runtimes.set(views, kept)
	return kept[key]
}

// "Where it runs" in small with id lit, for the brief of id.
export const runtimePicture = (views, id, colour) =>
	views?.runtime ? runtimePictureHtml(laidOut(views, 'runtime', false, []), id, colour) : ''

// The crossings a process lights on "Where it runs": those between the parts of two steps in a row.
function litOf(runtime, stopsByName) {
	const order = [...stopsByName.entries()]
		.flatMap(([name, stops]) => stops.map((n) => [n, name]))
		.sort((a, b) => a[0] - b[0])
	const partOf = new Map(runtime.things.filter((t) => t.kind === 'part').map((t) => [t.id, t.part]))
	const lit = new Set()
	for (let k = 1; k < order.length; k++) {
		const [a, b] = [order[k - 1][1], order[k][1]]
		for (const c of runtime.crossings) {
			const [from, to] = [partOf.get(c.from), partOf.get(c.to)]
			if ((from === a && to === b) || (from === b && to === a)) lit.add(c.id)
		}
	}
	return lit
}

// view is what drawing.js needs, with stops by part name. The answer is the drawing's HTML, the box it fills, and
// the rects of its small map.
export function viewDrawing({ home, arch, on, view, projectName, column }) {
	const views = home.look.views
	const parts = home.look.boxes.map((box) => box.name)
	const layout = laidOut(views, on, arch.folded, parts, column)
	const thingOf = new Map((views.runtime?.things ?? []).map((t) => [t.id, t]))
	const outsideOf = new Map((views.world?.outside ?? []).map((o) => [o.id, o]))
	view.outsideName = (id) => outsideOf.get(id)?.name ?? id
	view.nameOf = (id) => {
		const thing = thingOf.get(id)
		if (!thing) return id
		return thing.kind === 'part' ? thing.part : thing.kind === 'store' ? thing.name : view.outsideName(id)
	}
	view.projectName = projectName
	if (on === 'runtime' && view.layer === 'processes') view.litCrossings = litOf(views.runtime, view.stops)
	const html = on === 'world' ? worldHtml(views, layout, view) : runtimeHtml(views, layout, view)
	const rects =
		on === 'world'
			? [{ ...layout.project, cls: 'k-mm-frame' }, ...layout.outside.map((r) => ({ ...r, cls: 'k-mm-out' }))]
			: [
					...layout.frames.map((r) => ({ ...r, cls: 'k-mm-frame' })),
					...layout.things.map((r) => ({
						...r,
						cls: r.thing.kind === 'part' ? view.colour(r.thing.part) : 'k-mm-out',
					})),
				]
	return { html, world: { x: 0, y: 0, w: layout.width, h: layout.height }, rects }
}
