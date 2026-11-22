// What the reader can do on the canvas: press a block for its brief and press it again to go inside, go up by the
// breadcrumb, turn a layer on and pick what it shows, zoom and fit, and open the tool that asks ken's model to draw
// the level another way. The level itself, its change and the runs of ken's model are the home's, from before the
// pages: this module moves them and draws the canvas.
import { isFile } from '../home/canvas/part-box.js'
import { WHOLE } from '../home/state/home-state.js'
import { fill } from '../shell/fill.js'
import { architectureHtml, processesOf } from './architecture.js'
import { fitJobs } from './blocks.js'
import { canvasCamera } from './camera.js'
import { changeChoices } from './layers.js'

// What the canvas holds of its own: the layer on show, the process it shows, the camera, and whether the draw tool
// is open. fitted says what the camera was last fitted to.
export const freshArch = () => ({
	layer: null,
	process: null,
	cam: { x: 0, y: 0, z: 1 },
	drawOpen: false,
	fitted: null,
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
	const camera = canvasCamera(page, arch, drawer)

	// Draws the canvas. The camera fits the level when the level, the window or the room beside a brief changed, and
	// stays where the reader left it otherwise.
	function draw(env) {
		const { home } = state
		const column = narrow.matches
		const drawn = fill(page, architectureHtml({ home, arch, env, brief: state.brief.id, column }))
		if (drawn && arch.drawOpen) {
			const box = page.querySelector('#redraw-text')
			if (box && box.value !== home.redraw.text) box.value = home.redraw.text
		}
		if (!page.querySelector('#arch-world')) return
		if (drawn) fitJobs(page)
		const key = [home.look?.within.join(','), column, drawer(), page.clientWidth, page.clientHeight].join('|')
		if (arch.fitted !== key) {
			arch.fitted = key
			camera.fit()
		} else if (drawn) camera.apply()
	}

	// The level changed under the reader, so the keyboard goes to the breadcrumb, which names where they are.
	async function moveTo(trail) {
		await app.home.moveTo(trail)
		render()
		$('.k-crumb [aria-current]')?.focus({ preventScroll: true })
		const { look } = state.home
		// A level of files is as deep as the canvas goes: the reader came to the part's code.
		if (trail.length > 1 && look?.boxes.length > 0 && look.boxes.every(isFile)) {
			void app.home.tell({ did: 'code', paths: trail.at(-1).within })
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
		await app.home.loads.loadLayout()
		await app.home.loads.settle()
	}

	const actions = {
		// The first press on a block opens its brief. A press on the block whose brief is open goes inside it, and
		// closes the brief of a block that has nothing inside.
		'arch-pick'(el) {
			const box = state.home.look.boxes[Number(el.dataset.index)]
			if (state.brief.id !== el.dataset.concept) return app.brief.show(el.dataset.concept, { opener: el.dataset.key })
			return box.opens ? inside(box) : app.brief.close()
		},
		'arch-inside': (el) => inside(state.home.look.boxes[Number(el.dataset.index)]),
		'arch-crumb': (el) => moveTo(state.home.trail.slice(0, Number(el.dataset.index) + 1)),
		async 'arch-layer'(el) {
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
		await app.home.loads.refresh()
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

	return { actions, draw, enter, goInside, moveTo, closeDraw }
}
