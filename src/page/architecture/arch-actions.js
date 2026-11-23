// What the reader can do on the canvas: press a block for its brief and press it again to go inside, go up by the
// breadcrumb, turn a layer on and pick what it shows, zoom and fit, and open the tool that asks ken's model to draw
// the level another way. The level itself, its change and the runs of ken's model are the home's, from before the
// pages: this module moves them and draws the canvas.
import { glide, gliders } from '../arch-views/glide.js'
import { foldedAt } from '../arch-views/runtime-layout.js'
import { viewOfConcept, viewOn, viewsOffered } from '../arch-views/switch.js'
import { freshTree } from '../folder-tree/folder-tree.js'
import { WHOLE } from '../level/level-state.js'
import { fill } from '../shell/fill.js'
import { architectureHtml, processesOf } from './architecture.js'
import { fitJobs, isFileBlock } from './blocks.js'
import { canvasCamera } from './camera.js'
import { changeChoices } from './layers.js'

// What the canvas holds of its own: the layer on show, the process it shows, the camera, and whether the draw tool
// is open. fitted says what the camera was last fitted to.
export const freshArch = () => ({
	layer: null,
	process: null,
	cam: { x: 0, y: 0, z: 1 },
	moved: false,
	drawOpen: false,
	fitted: null,
	// The brief the camera last brought into sight beside the canvas.
	shownBrief: null,
	// The drawing the reader chose last ("world", "runtime" or "parts"), whether the key is open, whether a crowded
	// frame of "Where it runs" is folded, and what the last run to draw them left to say.
	view: null,
	format: null,
	keyOpen: false,
	folded: true,
	viewsProblem: null,
	// The drawing on screen when the canvas was last drawn, so a switch glides.
	shown: null,
	// The folders open in the tree of a level ken's model has not named.
	tree: freshTree(),
	// Whether the reader picked a layer themselves. Until they do, a drawn process is lit.
	layerPicked: false,
	// The sheet open over the drawing on a phone: "views", "layers", "notes" or "zoom", or null.
	sheet: null,
})

const narrow = matchMedia('(max-width: 760px)')
const wide = matchMedia('(min-width: 1000px)')

// app is the page: its state, render, the brief's actions, and home, the actions of the views from before the pages.
export function archActions(app) {
	const { state, render } = app
	const arch = state.arch
	const $ = (selector) => document.querySelector(selector)
	const page = $('#pg-arch')
	// A brief open beside the canvas takes its right side on a wide window, and lies over all of it on a narrow one.
	const drawer = () => (state.brief.id !== null && wide.matches ? $('#brief').offsetWidth : 0)
	arch.view = app.stored('ken-arch-view')
	const onShow = () => (state.home.trail.length > 1 ? 'parts' : viewOn(arch, viewsOffered(state.home)))
	// Zooming in past 100% opens a folded drawing, and zooming well out folds it again, about the same point.
	const camera = canvasCamera(page, arch, drawer, (z) => {
		if (onShow() !== 'runtime') return
		const folded = foldedAt(z, arch.folded)
		if (folded === arch.folded) return
		const before = worldSize()
		arch.folded = folded
		render()
		const after = worldSize()
		const room = page.querySelector('#arch-canvas')
		const [cx, cy] = [room.clientWidth / 2, room.clientHeight / 2]
		const { x, y } = arch.cam
		arch.cam = {
			z,
			x: cx - ((cx - x) * after.w) / before.w,
			y: cy - ((cy - y) * after.h) / before.h,
		}
		camera.apply()
	})
	function worldSize() {
		const [, , w, h] = (page.querySelector('#arch-canvas')?.dataset.world ?? '0 0 1 1').split(' ').map(Number)
		return { w, h }
	}

	// Draws the canvas. The camera fits the level when the level, the window or the room beside a brief changed, and
	// stays where the reader left it otherwise.
	function draw(env) {
		const { home } = state
		const column = narrow.matches
		const view = onShow()
		const switched = arch.shown !== null && arch.shown !== view && page.querySelector('#arch-world')
		const before = switched ? gliders(page) : new Map()
		arch.shown = view
		const topViews = state.shell.top?.look?.views ?? null
		const reading = page.querySelector('.k-arch-reading')
		const scroll = reading?.scrollTop ?? 0
		const drawn = fill(
			page,
			architectureHtml({ home, arch, env, brief: state.brief.id, column, topViews, text: state.shell.prefs.text }),
		)
		const readAfter = page.querySelector('.k-arch-reading')
		if (readAfter && reading?.dataset.level === readAfter.dataset.level) readAfter.scrollTop = scroll
		if (drawn && arch.drawOpen) {
			const box = page.querySelector('#redraw-text')
			if (box && box.value !== home.redraw.text) box.value = home.redraw.text
		}
		if (!page.querySelector('#arch-world')) return
		if (drawn) fitJobs(page)
		const level = [home.look?.within.join(','), view, column, page.clientWidth, page.clientHeight].join('|')
		const key = `${level}|${drawer()}|${camera.clearTop()}`
		const brief = state.brief.id
		// A camera the reader moved stays where they left it when a brief opens beside it or a layer adds a row over the
		// canvas. One they did not move fits again, so nothing that floats on top covers a block.
		const kept = arch.moved && arch.fitted?.startsWith(`${level}|`)
		const refit = arch.fitted !== key && !kept
		if (refit) camera.fit()
		if (drawer() > 0 && (arch.fitted !== key || arch.shownBrief !== brief)) camera.show(brief)
		else if (drawn && !refit) camera.apply()
		arch.fitted = key
		arch.shownBrief = brief
		if (switched) glide(page, before, arch.cam.z)
	}

	// The level changed under the reader, so the keyboard goes to the breadcrumb, which names where they are.
	async function moveTo(trail) {
		await app.level.moveTo(trail)
		render()
		$('.k-crumb [aria-current]')?.focus({ preventScroll: true })
		const { look } = state.home
		// A level of files is as deep as the canvas goes: the reader came to the part's code.
		if (trail.length > 1 && look?.boxes.length > 0 && look.boxes.every((box) => isFileBlock(box, look))) {
			void app.level.tell({ did: 'code', paths: trail.at(-1).within })
		}
	}

	const inside = (box) => moveTo([...state.home.trail, { name: box.name, within: box.paths }])

	// From a brief: the canvas goes inside the brief's part. A part of the level on the canvas keeps the trail above
	// it, and any other part stands right under the project.
	async function goInside(concept, within) {
		const { trail } = state.home
		const here = trail.at(-1).within.join(',') === concept.within.join(',')
		if (state.shell.page !== 'architecture') await app.shell.goPage('architecture')
		return moveTo([...(here ? trail : [WHOLE]), { name: concept.name, within }])
	}

	async function layChange(change) {
		Object.assign(state.home, { change, at: '' })
		await app.level.loads.loadLayout()
		await app.level.loads.settle()
	}

	// A press on a part in a drawing does what a press on its block does: its brief, then inside it.
	function pickPart(el) {
		const box = state.home.look.boxes.find((each) => each.name === el.dataset.name)
		if (state.brief.id !== el.dataset.concept) return app.brief.show(el.dataset.concept, { opener: el.dataset.key })
		return box?.opens ? inside(box) : app.brief.close()
	}

	// Inside a part the switch takes the reader back up to the drawing they pressed.
	function showView(view) {
		arch.view = view
		app.store('ken-arch-view', view)
		if (state.home.trail.length > 1 && view !== 'parts') return moveTo([WHOLE])
		render()
	}

	// From search: the drawing that holds the concept is shown, on the Architecture page at the top of the project.
	async function showConcept(id) {
		const view = viewOfConcept(id, state.shell.top?.look?.views ?? state.home.look?.views)
		if (!view) return
		if (state.shell.page !== 'architecture') await app.shell.goPage('architecture')
		if (state.home.trail.length > 1) await moveTo([WHOLE])
		arch.view = view
	}

	// The run that draws where the project runs ended: the level is read again, and "Where it runs" opens.
	async function viewsEnded(q) {
		await app.level.loads.refresh()
		const views = state.home.look?.views
		const drew = Boolean(q.outcome === 'answered' && (views?.runtime || views?.world) && !views?.stale?.length)
		arch.viewsProblem = drew
			? null
			: (q.error ?? "ken's model drew nothing ken could check against the repository. Its reply says why.")
		if (drew && (arch.view === 'parts' || !views[arch.view])) arch.view = views.runtime ? 'runtime' : 'world'
		render()
	}

	const actions = {
		'arch-format'(el) {
			arch.format = el.dataset.format
			arch.keyOpen = false
			render()
			page.querySelector('[data-key="arch-format"]')?.focus()
		},
		'arch-view'(el) {
			arch.sheet = null
			return showView(el.dataset.view)
		},
		'arch-sheet'(el) {
			arch.sheet = arch.sheet === el.dataset.sheet ? null : el.dataset.sheet
			render()
		},
		'arch-view-pick': pickPart,
		'arch-key'() {
			arch.keyOpen = !arch.keyOpen
			render()
			$(arch.keyOpen ? '#key-title' : '[data-key="view-key"]')?.focus()
		},
		'arch-unfold'() {
			arch.folded = false
			render()
		},
		async 'arch-draw-views'() {
			if (state.brief.id) {
				await showConcept(state.brief.id)
				app.brief.close()
			}
			arch.viewsProblem = null
			const { home } = state
			return app.send(
				{ lens: { kind: 'views', within: [] } },
				{ kind: 'views', trail: home.trail, change: home.change, wayIn: home.wayIn },
			)
		},
		// The first press on a block opens its brief. A press on the block whose brief is open goes inside it, and
		// closes the brief of a block that has nothing inside.
		'arch-pick'(el) {
			const box = state.home.look.boxes[Number(el.dataset.index)]
			if (state.brief.id !== el.dataset.concept) return app.brief.show(el.dataset.concept, { opener: el.dataset.key })
			return box.opens ? inside(box) : app.brief.close()
		},
		'arch-inside': (el) => inside(state.home.look.boxes[Number(el.dataset.index)]),
		// The project's name at the top level, where there is nowhere higher to go, opens the project's brief.
		'arch-crumb': (el) =>
			state.home.trail.length === 1
				? app.brief.project(el.dataset.key)
				: moveTo(state.home.trail.slice(0, Number(el.dataset.index) + 1)),
		async 'arch-layer'(el) {
			arch.layerPicked = true
			const layer = arch.layer === el.dataset.layer ? null : el.dataset.layer
			const wasChanges = arch.layer === 'changes'
			arch.layer = layer
			if (layer === 'processes') arch.process ??= processesOf(state.home)[0]?.id ?? null
			if (layer === 'changes') await layChange(changeChoices(state.home.changes)[0]?.change ?? 'none')
			else if (wasChanges) await layChange('none')
			render()
		},
		'arch-process'(el) {
			arch.process = el.dataset.id
			render()
		},
		async 'arch-change'(el) {
			await layChange(el.dataset.change)
			render()
		},
		// A folder of the tree opens in place, and its folders and files are read the way the level is.
		async 'tree-open'(el) {
			const key = el.dataset.paths
			if (arch.tree.has(key)) {
				arch.tree.delete(key)
				return render()
			}
			arch.tree.set(key, { kind: 'reading' })
			render()
			const within = key.split(',').map((each) => `within=${encodeURIComponent(each)}`)
			const answer = await app.read(`/api/layout?${within.join('&')}`).catch((error) => ({
				ok: false,
				body: { message: error.message },
			}))
			if (!arch.tree.has(key)) return
			arch.tree.set(
				key,
				answer.ok ? { kind: 'ok', boxes: answer.body.look.boxes } : { kind: 'failed', message: answer.body.message },
			)
			render()
		},
		'arch-zoom': (el) => camera.zoomBy(Number(el.dataset.by)),
		'arch-fit': () => camera.fit(),
		'arch-draw'() {
			arch.drawOpen = !arch.drawOpen
			state.home.noteProblem = null
			render()
			$(arch.drawOpen ? '#redraw-text' : '[data-key="arch-draw"]')?.focus()
		},
	}

	// The page is the Architecture page again: the level is read with what the canvas lays over it, and nothing else.
	async function enter() {
		const { home } = state
		Object.assign(home, { selected: null, shown: null, opened: false, why: null, wayIn: 'learn', at: '' })
		if (arch.layer !== 'changes') home.change = 'none'
		else if (home.change === 'none') home.change = changeChoices(home.changes)[0]?.change ?? 'none'
		await app.level.loads.refresh()
		// Process first: the page opens on how it works, so a drawn process is lit until the reader picks a layer.
		if (arch.layer === null && !arch.layerPicked && processesOf(home).length > 0) arch.layer = 'processes'
		if (arch.layer === 'processes') arch.process ??= processesOf(home)[0]?.id ?? null
	}

	function closeDraw() {
		if (!arch.drawOpen) return false
		arch.drawOpen = false
		render()
		$('[data-key="arch-draw"]')?.focus()
		return true
	}

	narrow.addEventListener('change', render)
	wide.addEventListener('change', render)
	window.addEventListener('resize', () => state.shell.page === 'architecture' && render())

	function closeSheet() {
		if (!arch.sheet) return false
		const key = `sheet-${arch.sheet}`
		arch.sheet = null
		render()
		$(`[data-key="${key}"]`)?.focus()
		return true
	}

	function closeKey() {
		if (!arch.keyOpen) return false
		arch.keyOpen = false
		render()
		$('[data-key="view-key"]')?.focus()
		return true
	}

	return { actions, draw, enter, goInside, moveTo, closeDraw, closeKey, closeSheet, showConcept, viewsEnded }
}
