// What the reader can do on the home: every button, form and key of it. The state these act on is in state/, which
// also reads the level from the server and holds the runs of ken's model the home starts.
import { numberAt } from '../draw-diagrams.js'
import { stepParts, stopTopics } from '../project/walk.js'
import { chipQuestion } from '../views/reply.js'
import { askedQuestion } from './inspector/ask-drawer.js'
import { firstUnseen, pathOf, placeOf, shownDetail, stoodOn } from './state/content.js'
import { WHOLE } from './state/home-state.js'
import { homeLoads } from './state/loads.js'
import { homeRuns } from './state/runs.js'

// app is the page: its state, render, the calls to the server, send, which asks ken's model a question, and the two
// small stores of this browser.
export function homeActions(app) {
	const { state, render, post, send, store } = app
	const $ = (selector) => document.querySelector(selector)
	const level = () => state.home.trail.at(-1)
	const loads = homeLoads(app)
	const { loadLayout, settle, refresh, enter, start } = loads

	async function show() {
		state.view = state.base = 'home'
		state.menuOpen = false
		render()
		await refresh()
	}

	const boxNamed = (name) => state.home.look.boxes.find((box) => box.name === name)

	// The reader reached a stop of a stored tour whose part they had not met: their map learns it.
	async function reach() {
		const home = state.home
		const step = stopOn()
		if (!step || !home.content.tour?.q || shownDetail(home) === 'big') return
		if (stoodOn(boxNamed(step.part), stopTopics(step)) !== 'new') return
		await learn(step, 'toured')
	}

	// The stop of the part the reader picked, on a named level.
	function stopOn() {
		const home = state.home
		if (home.content.kind !== 'level' || home.selected?.kind !== 'part') return null
		const path = pathOf(home.look, home.content)
		return path[placeOf(path, home.selected)] ?? null
	}

	async function learn(step, signal) {
		try {
			await post('/api/map', { signal, topics: stopTopics(step) })
		} catch (error) {
			state.problem = error.message
		}
		await loadLayout()
		render()
	}

	// What the reader picks shows in the inspector. On a narrow screen the inspector is under the picture, so its
	// heading comes into view. A picked stop or step comes into view in the path.
	async function select(selected) {
		const home = state.home
		home.selected = selected
		render()
		if (selected) {
			const path = pathOf(home.look, home.content)
			const open = document.getElementById(`path-${placeOf(path, selected)}`)
			if (!state.ui.wide) (open ?? $('#insp-title'))?.scrollIntoView({ block: 'start' })
			else if (open) open.scrollIntoView({ block: 'nearest' })
			else if ($('#insp-scroll')) $('#insp-scroll').scrollTop = 0
			// A drawn picture can be longer and wider than the canvas, so the number picked in the list comes into view.
			if (state.ui.wide) $('#home-canvas .drawing .is-open')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		}
		await reach()
	}

	function stepTo(k) {
		const home = state.home
		const step = pathOf(home.look, home.content)[k]
		if (!step) return
		if (home.content.kind === 'drawn') return select({ kind: 'element', number: step.number })
		return select(step.part === null ? { kind: 'step', number: step.number } : { kind: 'part', name: step.part })
	}

	function stepBy(by) {
		const home = state.home
		if (!home.look || shownDetail(home) === 'big') return false
		const path = pathOf(home.look, home.content)
		if (path.length === 0) return false
		const at = placeOf(path, home.selected)
		void stepTo(at < 0 ? (home.content.kind === 'level' ? firstUnseen(home.look, path) : 0) : at + by)
		return true
	}

	// The level changes under the reader's focus, so focus goes to the level's heading, which names where they are.
	async function moveTo(trail) {
		Object.assign(state.home, { trail, shown: null, selected: null, openArrows: new Set() })
		await refresh()
		$('#home-level')?.focus({ preventScroll: true })
		$('#home-canvas').scrollTop = 0
	}

	const { run, ended } = homeRuns(app, loads, stepTo)

	const levelLens = (kind) => ({
		kind,
		within: level().within,
		name: state.home.trail.length > 1 ? level().name : null,
	})

	const actions = {
		home: show,
		async 'way-in'(el) {
			const home = state.home
			home.picked = true
			store('ken-way-in', el.dataset.way)
			await enter(el.dataset.way)
			await settle()
		},
		detail(el) {
			const home = state.home
			home.detail = el.dataset.detail
			store(`ken-detail-${home.wayIn}`, home.detail)
			// The big picture of a change shows no steps, so a step picked at a finer detail is let go.
			if (home.detail === 'big' && home.selected?.kind === 'step') home.selected = null
			return select(home.selected)
		},
		// A box picks its part. On a change with a walkthrough it picks the next step that quotes the part's files.
		'home-box'(el) {
			const home = state.home
			const box = home.look.boxes[Number(el.dataset.index)]
			const path = pathOf(home.look, home.content)
			if (home.content.kind === 'change' && shownDetail(home) !== 'big') {
				const steps = path.filter((step) => stepParts(step, home.look.boxes).has(Number(el.dataset.index)))
				const on = steps.findIndex((step) => home.selected?.kind === 'step' && step.number === home.selected.number)
				const next = steps[(on + 1) % (steps.length || 1)]
				if (next) return select({ kind: 'step', number: next.number })
			}
			const same = home.selected?.kind === 'part' && home.selected.name === box.name
			return select(same ? null : { kind: 'part', name: box.name })
		},
		'home-step'(el) {
			const k = Number(el.dataset.index)
			const path = pathOf(state.home.look, state.home.content)
			// The line of the open step closes it. Back and Next always move.
			if (el.matches('.path-head') && placeOf(path, state.home.selected) === k) return select(null)
			return stepTo(k)
		},
		'home-clear': () => select(null),
		// A tab over the canvas shows the parts, or one drawn picture in their place.
		'home-picture'(el) {
			Object.assign(state.home, { shown: el.dataset.id || null, selected: null })
			return settle()
		},
		'home-tour'() {
			const home = state.home
			home.detail = 'how'
			return stepTo(firstUnseen(home.look, pathOf(home.look, home.content)))
		},
		'home-open'() {
			const box = boxNamed(state.home.selected.name)
			return moveTo([...state.home.trail, { name: box.name, within: box.paths }])
		},
		'home-crumb': (el) => moveTo(state.home.trail.slice(0, Number(el.dataset.index) + 1)),
		// An arrow picked in the picture picks the part it starts from and opens its line in the inspector.
		'pv-arrow'(el) {
			const home = state.home
			const arrow = home.look.arrows[Number(el.dataset.index)]
			home.openArrows.add(Number(el.dataset.index))
			return select({ kind: 'part', name: arrow.from })
		},
		'home-arrow'(el) {
			const open = state.home.openArrows
			const i = Number(el.dataset.index)
			if (open.has(i)) open.delete(i)
			else open.add(i)
			render()
		},
		'home-know': () => learn(stopOn(), 'know'),
		'home-unfold'(el) {
			state.home.unfolded.add(el.dataset.name)
			render()
		},
		'home-story'() {
			state.home.storyOpen = !state.home.storyOpen
			render()
		},
		async 'home-reset'() {
			Object.assign(state.home, { trail: [WHOLE], at: '', formOpen: false })
			await enter(state.home.wayIn)
			await settle()
		},
		'home-chip': (el) => send({ question: chipQuestion(el.dataset.chip, state.home.look.change.range) }),
		'run-name': () => run('name', levelLens('parts')),
		'run-tour': () => run('tour', levelLens('tour')),
		'run-story': () => run('story', { kind: 'change', change: state.home.look.change.asked, want: 'story' }),
		'run-walk': () => run('walk', { kind: 'change', change: state.home.look.change.asked, want: 'walk' }),
		async 'home-back'() {
			const home = state.home
			try {
				await post('/api/layout/back', { within: level().within })
				Object.assign(home, { backProblem: null, said: null })
			} catch (error) {
				home.backProblem = error.message
			}
			await refresh()
		},
		async 'note-remove'(el) {
			try {
				state.home.notes = (await post('/api/notes', { remove: el.dataset.id })).notes
			} catch (error) {
				state.home.redraw.problem = error.message
			}
			render()
		},
		'redraw-example'(el) {
			state.home.redraw.text = el.textContent
			const box = $('#redraw-text')
			box.value = el.textContent
			box.focus()
		},
		'redraw-open'() {
			state.home.redrawOpen = !state.home.redrawOpen
			render()
			if (state.home.redrawOpen) $('#redraw-text')?.focus()
		},
		'home-said-close'() {
			state.home.said = null
			render()
		},
		'home-ended-close'() {
			state.home.ended = null
			render()
		},
		async 'ask-open'() {
			const home = state.home
			if (state.view !== 'home') await show()
			Object.assign(home, { askOpen: !home.askOpen, askWhole: false })
			render()
			if (home.askOpen) $('#ask-text')?.focus()
			else $('[data-key="ask-open"]')?.focus()
		},
		'ask-close': () => closeAsk(),
		'ask-whole'() {
			state.home.askWhole = true
			render()
			$('#ask-text')?.focus()
		},
	}

	function closeAsk() {
		state.home.askOpen = false
		render()
		$('[data-key="ask-open"]')?.focus()
	}

	function sendAsk() {
		const home = state.home
		const text = home.askText.trim()
		// With no run to start, the question stays in its box.
		if (text === '' || state.running || state.model?.kind !== 'ok') return
		const question = askedQuestion(home, text)
		Object.assign(home, { askText: '', askOpen: false })
		void send({ question })
	}

	// The forms of the home: the box of "Show it another way", the question of the drawer, and the commit of the picker.
	function submit(event) {
		const home = state.home
		const form = event.target.closest('#redraw-form, #ask-form, #home-picker')
		if (!form) return false
		event.preventDefault()
		if (form.id === 'redraw-form') {
			const text = home.redraw.text.trim()
			if (text === '') {
				home.redraw.problem = 'Say first how you want to see it.'
				render()
				$('#redraw-text')?.focus()
				return true
			}
			home.redraw = { text: '', asked: text, problem: null }
			home.said = null
			$('#redraw-text').value = ''
			void run('redraw', { ...levelLens('view'), text })
		} else if (form.id === 'ask-form') sendAsk()
		else void refresh()
		return true
	}

	// What the reader types is drawn again with the rest, so it is kept here as typed.
	function input(event) {
		const home = state.home
		const { id, value } = event.target
		if (id === 'redraw-text') home.redraw.text = value
		else if (id === 'ask-text') home.askText = value
		else if (id === 'home-at') home.at = value
		else return false
		return true
	}

	function change(event) {
		if (event.target.id !== 'home-change') return false
		Object.assign(state.home, { change: event.target.value, selected: null, storyOpen: false })
		void refresh()
		return true
	}

	// Escape closes the drawer, then lets go of what is picked. The arrow keys move along the reading path, unless the
	// reader is typing. Enter in the drawer's box sends the question.
	function key(event) {
		const home = state.home
		const typing = event.target.matches?.('input, textarea, select')
		if (event.key === 'Escape') {
			if (home.askOpen) closeAsk()
			else if (home.selected) void select(null)
			else return false
			return true
		}
		if (event.key === 'Enter' && event.target.id === 'ask-text' && !event.shiftKey && !event.isComposing) {
			event.preventDefault()
			sendAsk()
			return true
		}
		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !typing && !home.askOpen) {
			if (!stepBy(event.key === 'ArrowLeft' ? -1 : 1)) return false
			event.preventDefault()
			return true
		}
		return false
	}

	// A part of a change card in a thread opens the home at that part, with the same change laid over it.
	async function openAt(box, change) {
		Object.assign(state.home, {
			wayIn: 'review',
			trail: [WHOLE, { name: box.name, within: box.paths }],
			at: '',
			change,
			shown: null,
			selected: null,
		})
		await show()
		$('#home-level')?.focus({ preventScroll: true })
	}

	// A box or an arrow picked in the drawing of a drawn picture picks its row in the inspector, and lets go of it when
	// picked again.
	function pick(target) {
		const number = target.closest('#home-canvas') ? numberAt(target) : null
		if (number === null) return
		const { selected } = state.home
		void select(selected?.number === number ? null : { kind: 'element', number })
	}

	return { actions, start, ended, submit, input, change, key, openAt, pick }
}
