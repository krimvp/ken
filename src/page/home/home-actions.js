// The home's state and what the reader can do on it. The home shows one level of the project at a time, the way in
// the reader took, the detail they chose, and what they picked in the picture. The server reads the level from git on
// every move. The runs of ken's model that the home starts stay on the home: the page holds the run, and this module
// decides what the home shows when it ends.
import { learnParts } from '../project/part-colours.js'
import { stepParts, stopTopics } from '../project/walk.js'
import { chipQuestion } from '../views/reply.js'
import { askedQuestion } from './ask-drawer.js'
import { contentOf, firstUnseen, pathOf, placeOf, repliesOf, shownDetail, stoodOn } from './content.js'

const WHOLE = { name: 'Whole project', within: [] }
const WAYS = ['learn', 'catch-up', 'review']
const DETAILS = ['big', 'how', 'code']
const FIRST_DETAIL = { learn: 'big', 'catch-up': 'big', review: 'how' }

// stored reads a value this browser kept: the reader's way in, and the detail they last chose for each way in.
// ui holds the quotes and decisions open in the cards the home shows, as a thread's does.
export function freshHome(stored, ui) {
	const wayIn = WAYS.find((way) => way === stored('ken-way-in')) ?? null
	return {
		// The reader's pick, else the way in ken suggests. picked says the reader chose it themselves.
		wayIn: wayIn ?? 'learn',
		picked: wayIn !== null,
		detail: 'big',
		// The level on screen is the last of the boxes the reader opened to get here.
		trail: [WHOLE],
		// The text that asks the server for the change laid over the parts: "none" for no change, and "" for the
		// reader's own work. at is another commit to look at, as typed.
		change: 'none',
		at: '',
		look: null,
		changes: [],
		suggestion: null,
		problem: null,
		notes: [],
		selected: null,
		content: { kind: 'folders' },
		// The saved questions the content names, by id, once read.
		replies: new Map(),
		// text is the box of "Show it another way", asked the request the model is working on, problem why it was not sent.
		redraw: { text: '', asked: '', problem: null },
		redrawOpen: false,
		backProblem: null,
		// ken's reply to the last request to show a level another way, and a run that ended with nothing to show.
		said: null,
		ended: null,
		stepsOpen: false,
		storyOpen: false,
		formOpen: false,
		openArrows: new Set(),
		// The parts the reader knows whose words they asked to see anyway.
		unfolded: new Set(),
		askOpen: false,
		askText: '',
		askWhole: false,
		ui,
	}
}

// app is the page: its state, render, the calls to the server, send, which asks ken's model a question, and the two
// small stores of this browser.
export function homeActions({ state, render, getJson, post, send, stored, store, fromView }) {
	const $ = (selector) => document.querySelector(selector)
	const level = () => state.home.trail.at(-1)

	// One level from the server, for where the reader is now. A level the server refuses takes the last one off the
	// screen and shows the reason in its place.
	async function loadLayout() {
		const home = state.home
		const query = new URLSearchParams()
		if (home.at.trim() !== '') query.set('at', home.at.trim())
		for (const path of level().within) query.append('within', path)
		if (home.change !== '') query.set('change', home.change)
		try {
			const response = await fetch(`/api/layout?${query}`)
			const body = await response.json()
			if (!response.ok) {
				home.problem = { message: body.message, field: body.field ?? null }
				return
			}
			const { look, changes, wayIn } = body
			if (home.trail.length === 1 && home.at.trim() === '') learnParts(look.boxes)
			Object.assign(home, { look, changes, problem: null, change: look.change?.asked ?? 'none' })
			if (wayIn) home.suggestion = wayIn
		} catch (error) {
			home.problem = { message: error.message, field: null }
		}
	}

	// ken's notes about the reader. A server that keeps none answers 404, and the home then shows none.
	async function loadNotes() {
		try {
			const response = await fetch('/api/notes')
			state.home.notes = response.ok ? (await response.json()).notes : []
		} catch {
			state.home.notes = []
		}
	}

	// What ken has to say about the level on screen, from the saved questions, and the replies it names once read.
	async function settle() {
		const home = state.home
		if (!home.look) return
		const find = () => {
			home.content = contentOf(home.look, state.rows, home.replies)
		}
		find()
		// A pick the new level does not hold is let go.
		const { selected } = home
		const held =
			selected?.kind === 'part'
				? home.look.boxes.some((box) => box.name === selected.name)
				: home.content.kind === 'change'
		if (selected && !held) home.selected = null
		render()
		const unread = repliesOf(home.content).filter((each) => each.q === null)
		if (unread.length === 0) return
		await Promise.all(
			unread.map(async ({ id }) => {
				try {
					home.replies.set(id, fromView(await getJson(`/api/questions/${encodeURIComponent(id)}`)))
				} catch (error) {
					home.problem = { message: error.message, field: null }
				}
			}),
		)
		find()
		render()
	}

	async function refresh() {
		await loadLayout()
		await settle()
	}

	// Lays over the parts what a way in shows first: nothing to learn the project, what landed last to catch up, and
	// to review a change the reader's own work, or the newest merge when they have none.
	async function enter(wayIn) {
		const home = state.home
		const kept = stored(`ken-detail-${wayIn}`)
		Object.assign(home, {
			wayIn,
			at: '',
			selected: null,
			detail: DETAILS.find((detail) => detail === kept) ?? FIRST_DETAIL[wayIn],
			change: wayIn === 'review' ? '' : 'none',
		})
		if (wayIn === 'catch-up') home.change = home.changes.find((choice) => choice.kind === 'since')?.change ?? 'none'
		await loadLayout()
		if (wayIn === 'review' && !home.problem && !home.look.change) {
			const newest = home.changes.find((choice) => choice.kind === 'merge' || choice.kind === 'commit')
			if (newest) {
				home.change = newest.change
				await loadLayout()
			}
		}
	}

	// The first load reads the level with no change, which also says which way in ken suggests and what there is to
	// catch up on. Then the way in decides what is laid over it.
	async function start() {
		const home = state.home
		await Promise.all([loadLayout(), loadNotes()])
		if (!home.picked && home.suggestion) home.wayIn = home.suggestion.suggested
		await enter(home.wayIn)
		await settle()
	}

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
		}
		await reach()
	}

	function stepTo(k) {
		const home = state.home
		const step = pathOf(home.look, home.content)[k]
		if (!step) return
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
		Object.assign(state.home, { trail, selected: null, openArrows: new Set() })
		await refresh()
		$('#home-level')?.focus({ preventScroll: true })
		$('#home-canvas').scrollTop = 0
	}

	// A run of ken's model that stays on the home. The page calls ended when it is over.
	function run(kind, lens) {
		Object.assign(state.home, { ended: null, stepsOpen: false })
		return send({ lens }, kind)
	}

	const levelLens = (kind) => ({
		kind,
		within: level().within,
		name: state.home.trail.length > 1 ? level().name : null,
	})

	// A run the home started is over. The home reads the level, the questions and the notes again. What the run made
	// shows in its place, and a run that made nothing the home can show says so, with the way to its full reply.
	async function ended(kind, q) {
		const home = state.home
		await Promise.all([loadLayout(), loadNotes()])
		await settle()
		const { content } = home
		const made =
			q.outcome === 'answered' &&
			q.reply &&
			{
				name: () => q.reply.items.some((item) => item.kind === 'card' && item.card.kind === 'layout'),
				tour: () => content.tour?.id === q.id,
				story: () => content.story?.id === q.id,
				walk: () => content.walk?.id === q.id,
				redraw: () => true,
			}[kind]()
		if (!made) home.ended = { outcome: q.outcome, error: q.error, id: q.id }
		else if (kind === 'redraw') {
			// The picture shows the parts ken drew, so the note leaves that card out. A diagram or a claim stays in it.
			const items = q.reply.items.filter((item) => item.kind !== 'card' || item.card.kind !== 'layout')
			home.said = { asked: home.redraw.asked, q: { ...q, reply: { ...q.reply, items } } }
		} else if (kind === 'tour' && home.detail === 'big') {
			home.detail = 'how'
			await stepTo(firstUnseen(home.look, pathOf(home.look, content)))
		}
		render()
	}

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
			selected: null,
		})
		await show()
		$('#home-level')?.focus({ preventScroll: true })
	}

	return { actions, start, ended, submit, input, change, key, openAt }
}
