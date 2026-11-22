// What the pages do with the level they show: move to another level, start a run of ken's model about it (name the
// parts, explain them, tell a change's story or walk through it, draw it another way), tell ken what the reader
// looked at, and remove a note ken keeps. The Architecture page shows the level and the Changes page lays a change
// over its top; both read it through here.
import { WHOLE } from './level-state.js'
import { homeLoads } from './loads.js'
import { homeRuns } from './runs.js'
import { homeSeen } from './seen.js'

// app is the page: its state, render, the calls to the server, and send, which asks ken's model a question.
export function levelActions(app) {
	const { state, render, post } = app
	const $ = (selector) => document.querySelector(selector)
	const level = () => state.home.trail.at(-1)
	const loads = homeLoads(app)
	const seen = homeSeen(app, loads)
	const { run, ended } = homeRuns(app, loads)

	async function moveTo(trail) {
		Object.assign(state.home, { trail, shown: null, selected: null })
		await loads.refresh()
	}

	const levelLens = (kind) => ({
		kind,
		within: level().within,
		name: state.home.trail.length > 1 ? level().name : null,
	})

	// The run that names the top level's parts, and draws where the project runs with them. auto says ken started it by
	// itself, on the reader's first open of the project.
	function nameTop(auto = false) {
		state.home.ended = null
		const lens = { kind: 'parts', within: [], name: null }
		return app.send({ lens }, { kind: 'name', auto, trail: [WHOLE], change: 'none', wayIn: 'learn' })
	}

	const changeLens = (want) => ({ kind: 'change', change: state.home.look.change.asked, want })

	const actions = {
		'run-name': () => run('name', levelLens('parts')),
		'run-explain': () => run('explainAll', { ...levelLens('explain'), part: null }),
		'run-story': () => run('story', changeLens('story')),
		'run-walk': () => run('walk', changeLens('walk')),
		'home-back': loads.back,
		async 'note-remove'(el) {
			const home = state.home
			home.noteProblem = null
			try {
				home.notes = (await post('/api/notes', { remove: el.dataset.id })).notes
			} catch (error) {
				home.noteProblem = error.message
			}
			render()
		},
		'redraw-example'(el) {
			state.home.redraw.text = el.textContent
			const box = $('#redraw-text')
			box.value = el.textContent
			box.focus()
		},
		'home-said-close'() {
			state.home.said = null
			render()
		},
		'home-ended-close'() {
			state.home.ended = null
			render()
		},
		// The way back to where a run started: the one under way, or the one that ended while the reader was elsewhere.
		async 'home-run-go'() {
			const home = state.home
			const { trail, change } = state.running?.onHome ?? home.ended.started
			Object.assign(home, { change, at: '', ended: null })
			if (state.shell.page !== 'architecture') await app.shell.goPage('architecture')
			await moveTo(trail)
			render()
		},
		'home-trouble-close'() {
			state.home.trouble = null
			render()
		},
		async 'home-reset'() {
			Object.assign(state.home, { trail: [WHOLE], at: '', change: 'none', problem: null })
			await loads.refresh()
			render()
		},
	}

	// "Draw it another way" on the canvas: one run of ken's model draws the level as the reader asked.
	function submit(event) {
		const home = state.home
		if (event.target.id !== 'redraw-form') return false
		event.preventDefault()
		const text = home.redraw.text.trim()
		if (text === '') {
			home.redraw.problem = 'Say first how you want to see it.'
			render()
			$('#redraw-text')?.focus()
			return true
		}
		home.redraw = { text: '', asked: text, problem: null }
		Object.assign(home, { said: null, noteProblem: null })
		$('#redraw-text').value = ''
		void run('redraw', { ...levelLens('view'), text })
		return true
	}

	function input(event) {
		if (event.target.id !== 'redraw-text') return false
		state.home.redraw.text = event.target.value
		return true
	}

	// A press in the draw tool must not take the keyboard out of its box: its examples would move under the mouse.
	function press(event) {
		if (event.target.closest?.('#redraw-form') && event.target.id !== 'redraw-text') event.preventDefault()
	}

	// A part of a change card in a thread opens the Changes page with that change, and the part's brief.
	async function openAt(box, change) {
		state.view = state.base = 'home'
		state.shell.page = 'changes'
		state.chg.tab = 'changes'
		render()
		await app.chg.enter(change)
		app.brief.show(`part::${box.name}`)
	}

	return {
		actions,
		nameTop,
		loads,
		moveTo,
		tell: seen.tell,
		recorded: seen.recorded,
		ended,
		submit,
		input,
		press,
		openAt,
		watch: seen.watch,
	}
}
