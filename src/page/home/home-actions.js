// What the reader can do on the home: every button, form and key of it. The state these act on is in state/, which
// also reads the level from the server and holds the runs of ken's model the home starts.
import { numberAt } from '../draw-diagrams.js'
import { stepParts, stopTopics } from '../project/walk.js'
import { boardActions } from './board/board-actions.js'
import { askedQuestion } from './inspector/ask-drawer.js'
import { readAddress, writeAddress } from './state/address.js'
import { firstUnseen, pathOf, placeOf, shownDetail, stoodOn } from './state/content.js'
import { FIRST_DETAIL, WHOLE } from './state/home-state.js'
import { homeLoads } from './state/loads.js'
import { homeRuns } from './state/runs.js'
import { homeSeen } from './state/seen.js'

// app is the page: its state, render, the calls to the server, send, which asks ken's model a question, and the two
// small stores of this browser.
export function homeActions(app) {
	const { state, render, post, send, store } = app
	const $ = (selector) => document.querySelector(selector)
	const level = () => state.home.trail.at(-1)
	const loads = homeLoads(app)
	const { settle, refresh, enter } = loads
	const seen = homeSeen(app, loads)
	// From 1200 pixels the picture and the panel stand side by side, each scrolling by itself. Under that they are one
	// column and the page scrolls.
	const sideBySide = matchMedia('(min-width: 1200px)')

	// The address follows the reader once the home has read where it starts. A new level or way in is a new entry in
	// the browser's history, so Back goes to the one before. Anything finer rewrites the entry it is in.
	let addressed = null
	function address() {
		const home = state.home
		const hash = writeAddress(home)
		const coarse = JSON.stringify([home.wayIn, home.trail])
		if (addressed !== null && hash !== location.hash) {
			history[coarse === addressed ? 'replaceState' : 'pushState'](null, '', hash)
		}
		if (addressed !== null) addressed = coarse
	}

	// A place from the address becomes where the reader is. With none, ken's suggestion and what this browser kept
	// decide, as on a first visit.
	async function start() {
		const place = readAddress(location.hash)
		if (place) Object.assign(state.home, place)
		await loads.start(place !== null)
		addressed = JSON.stringify([state.home.wayIn, state.home.trail])
		address()
	}

	// Back and Forward in the browser: the home goes to the place the address names.
	async function back() {
		const place = readAddress(location.hash)
		if (!place) return
		Object.assign(state.home, place, { askOpen: false, openArrows: new Set(), opened: false, why: null, fixing: null })
		addressed = JSON.stringify([place.wayIn, place.trail])
		await show()
		toPicture()
	}

	async function show() {
		state.view = state.base = 'home'
		state.menuOpen = false
		render()
		await refresh()
	}

	const boxNamed = (name) => state.home.look.boxes.find((box) => box.name === name)

	function stopOn() {
		const home = state.home
		if (home.content.kind !== 'level' || home.selected?.kind !== 'part') return null
		const path = pathOf(home.look, home.content)
		return path[placeOf(path, home.selected)] ?? null
	}

	// "I know this part": ken writes that the reader said so, and their map learns the topics ken keeps for the part.
	async function know() {
		const home = state.home
		const box = boxNamed(home.selected.name)
		const step = stopOn()
		const topics = step ? stopTopics(step) : []
		try {
			await Promise.all([
				post('/api/seen', { did: 'said', paths: box.paths }),
				...(stoodOn(box, topics) === 'none' ? [] : [post('/api/map', { signal: 'know', topics })]),
			])
		} catch (error) {
			home.trouble = { said: 'ken could not save that.', message: error.message, again: false }
		}
		await seen.recorded()
		render()
	}

	// What the reader picks shows in the panel. A picked stop or step comes to the top of the panel, whole, and what
	// was picked in the picture comes into view there. In one column the panel is under the picture, so the page
	// scrolls to it: to the open stop, or to the panel's top, which names the part. focus moves the keyboard to the
	// open stop's line, for a reader who came by the arrow keys.
	async function select(selected, focus = false) {
		const home = state.home
		home.selected = selected
		render()
		// A part the reader picked, in the picture or on the reading path, is a part they opened.
		const box = selected?.kind === 'part' ? boxNamed(selected.name) : null
		if (box) void seen.tell({ did: 'opened', paths: box.paths })
		if (selected) {
			const path = pathOf(home.look, home.content)
			const open = document.getElementById(`path-${placeOf(path, selected)}`)
			if (!sideBySide.matches) (open ?? $('#home-inspector')).scrollIntoView({ block: 'start' })
			else {
				// Side by side, only the panel and the canvas move: the page itself stays where it is.
				const panel = $('#insp-scroll')
				if (panel)
					panel.scrollTop = open ? open.offsetTop - Number.parseFloat(getComputedStyle(open).scrollMarginTop) : 0
				$('#home-canvas :is(.is-chosen, .drawing .is-open)')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
			}
			if (focus) open?.querySelector('.path-head')?.focus({ preventScroll: true })
		}
		void loads.loadDiff()
	}

	// The reader picks a part in the picture: while ken picks the detail, the part opens where the server says for
	// this reader.
	function pick(box) {
		const home = state.home
		if (home.pinned === null && home.look.named) home.detail = box.knows.go.detail
		Object.assign(home, { why: board.whyOf(box), fixing: null })
		return select({ kind: 'part', name: box.name })
	}

	function stepTo(k, focus = false) {
		const home = state.home
		const step = pathOf(home.look, home.content)[k]
		if (!step) return
		if (home.content.kind === 'drawn') return select({ kind: 'element', number: step.number }, focus)
		const picked = step.part === null ? { kind: 'step', number: step.number } : { kind: 'part', name: step.part }
		return select(picked, focus)
	}

	function stepBy(by) {
		const home = state.home
		if (!home.look || shownDetail(home) === 'big') return false
		const path = pathOf(home.look, home.content)
		if (path.length === 0) return false
		const at = placeOf(path, home.selected)
		// Moving on from a tour stop says the reader read it.
		if (by > 0) seen.now('read')
		void stepTo(at < 0 ? (home.content.kind === 'level' ? firstUnseen(home.look, path) : 0) : at + by, true)
		return true
	}

	function toPicture() {
		$('#home-canvas').scrollTop = 0
		if (!sideBySide.matches) $('#home-canvas').scrollIntoView({ block: 'start' })
		$('#home-level')?.focus({ preventScroll: true })
	}

	// The level changes under the reader's focus, so focus goes to the level's heading, which names where they are,
	// and the opened picture comes into view.
	// With nothing open, the picture shows at the detail the reader pinned, else at the one its way in starts at.
	const atRest = () => ({
		opened: false,
		why: null,
		fixing: null,
		detail: state.home.pinned ?? FIRST_DETAIL[state.home.wayIn],
	})

	async function moveTo(trail) {
		Object.assign(state.home, { trail, shown: null, selected: null, openArrows: new Set(), pointed: null, ...atRest() })
		await refresh()
		toPicture()
	}

	const { run, ended } = homeRuns(app, loads, stepTo)
	const board = boardActions(app, loads, select)

	// The detail in use changes. One the reader pinned for every part moves with it, so the control says what shows.
	function toDetail(detail) {
		const home = state.home
		home.detail = detail
		if (home.pinned !== null) {
			home.pinned = detail
			store('ken-detail', detail)
		}
		// The big picture of a change shows no steps, so a step picked at a finer detail is let go.
		if (detail === 'big' && home.selected?.kind === 'step') home.selected = null
		return select(home.selected)
	}

	const levelLens = (kind) => ({
		kind,
		within: level().within,
		name: state.home.trail.length > 1 ? level().name : null,
	})

	const actions = {
		home: show,
		// A way in lays its change over the picture, and the panel shows what ken says of the whole of it.
		async 'way-in'(el) {
			const home = state.home
			Object.assign(home, { picked: true, opened: true, why: null, fixing: null })
			store('ken-way-in', el.dataset.way)
			await enter(el.dataset.way)
			await settle()
		},
		// A press in the panel that goes to a finer detail. One that opens code or a diff says so to ken at once. The
		// button pressed is gone from the panel, so the keyboard goes to what opened in its place.
		async detail(el) {
			await toDetail(el.dataset.detail)
			if (el.dataset.detail === 'code') seen.now()
			const opened = $('.path-step.is-on .path-head') ?? $('#insp-title')
			opened?.focus({ preventScroll: true })
		},
		// The Detail control. "ken picks" lets each part open where the server says, and any other detail stays for
		// every part until the reader picks "ken picks" again.
		'detail-pin'(el) {
			const home = state.home
			const pinned = el.dataset.detail === 'ken' ? null : el.dataset.detail
			home.pinned = pinned
			store('ken-detail', pinned ?? '')
			const box = home.selected?.kind === 'part' ? boxNamed(home.selected.name) : null
			return toDetail(pinned ?? box?.knows.go.detail ?? FIRST_DETAIL[home.wayIn])
		},
		// A box picks its part, and a second press goes into it. On a change with a walkthrough it picks the next step
		// that quotes the part's files.
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
			if (!same) return pick(box)
			// A box of one file has no level inside, so a second press lets it go.
			return box.opens ? actions['home-open']() : select(null)
		},
		'home-step'(el) {
			const k = Number(el.dataset.index)
			const path = pathOf(state.home.look, state.home.content)
			// The line of the open step closes it. Back and Next always move, and the keyboard goes with them: their
			// own buttons are drawn again under other names.
			if (el.matches('.path-head') && placeOf(path, state.home.selected) === k) return select(null)
			// Next from a tour stop says the reader read it.
			if (k > placeOf(path, state.home.selected)) seen.now('read')
			return stepTo(k, true)
		},
		// What ken says of the whole level or change, in place of the part or step that was picked.
		'home-clear'() {
			Object.assign(state.home, { opened: true, why: null })
			return select(null)
		},
		// Back to the board: nothing is picked, what the panel had to say is put away, and the column beside the
		// picture is "Next for you" again.
		async 'home-board'() {
			const home = state.home
			const drawn = home.shown !== null
			Object.assign(home, { shown: null, said: null, ended: null, trouble: null, ...atRest() })
			await select(null)
			if (drawn) await settle()
			$('#insp-title')?.focus({ preventScroll: true })
		},
		'home-picture'(el) {
			Object.assign(state.home, { shown: el.dataset.id || null, selected: null })
			return settle()
		},
		'home-tour'(el) {
			const home = state.home
			// A tour is read at "How it works", unless the reader pinned the code.
			home.detail = home.pinned === 'code' ? 'code' : 'how'
			if (home.pinned !== null) home.pinned = home.detail
			return stepTo(Number(el.dataset.index), true)
		},
		// The last stop or step is behind the reader: the board says what is next.
		async 'home-done'() {
			const home = state.home
			seen.now('read')
			Object.assign(home, atRest())
			await select(null)
			toPicture()
		},
		'home-open'() {
			const box = boxNamed(state.home.selected.name)
			return moveTo([...state.home.trail, { name: box.name, within: box.paths }])
		},
		'home-crumb': (el) => moveTo(state.home.trail.slice(0, Number(el.dataset.index) + 1)),
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
		'home-know': know,
		'home-unfold'(el) {
			state.home.unfolded.add(el.dataset.name)
			render()
		},
		'home-story'() {
			state.home.storyOpen = !state.home.storyOpen
			render()
		},
		async 'home-reset'() {
			Object.assign(state.home, { trail: [WHOLE], at: '', typed: { at: '', since: '', another: '' }, opened: false })
			await enter(state.home.wayIn)
			await settle()
		},
		'home-up': toPicture,
		// The first stop for the Tab key: past the header, the controls and the picture, to what ken says.
		skip() {
			$('#insp-title')?.focus()
		},
		'home-chip': (el) =>
			send({ lens: { kind: 'change', change: state.home.look.change.asked, want: el.dataset.chip } }),
		'run-name': () => run('name', levelLens('parts')),
		'run-tour': () => run('tour', levelLens('tour')),
		'run-story': () => run('story', { kind: 'change', change: state.home.look.change.asked, want: 'story' }),
		'run-walk': () => run('walk', { kind: 'change', change: state.home.look.change.asked, want: 'walk' }),
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
		'redraw-open'() {
			Object.assign(state.home, { redrawOpen: !state.home.redrawOpen, noteProblem: null })
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
		// The way back to where a run started: the one under way, or the one that ended while the reader was elsewhere.
		'home-run-go'() {
			const home = state.home
			const { trail, change, wayIn } = state.running?.onHome ?? home.ended.started
			Object.assign(home, { change, wayIn, at: '', ended: null })
			return moveTo(trail)
		},
		'home-trouble-close'() {
			state.home.trouble = null
			render()
		},
		'home-retry'() {
			state.home.trouble = null
			return settle()
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
		...board.actions,
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

	function submit(event) {
		const home = state.home
		const form = event.target.closest('#redraw-form, #ask-form, .home-typed')
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
			// The examples and the notes close, so the picture has its room while the run goes on, and the keyboard goes to
			// the panel, which shows the run.
			Object.assign(home, { said: null, redrawOpen: false, noteProblem: null })
			$('#redraw-text').value = ''
			void run('redraw', { ...levelLens('view'), text })
			$('#insp-title')?.focus({ preventScroll: true })
		} else if (form.id === 'ask-form') sendAsk()
		else {
			const { field } = form.dataset
			const text = home.typed[field].trim()
			if (field === 'at') home.at = text
			else if (text === '') return true
			else home.change = field === 'since' ? `since:${text}` : text
			// The reader asked for a change or a commit, so the panel says what it is.
			Object.assign(home, { selected: null, opened: true, why: null })
			void refresh()
		}
		return true
	}

	// What the reader types is drawn again with the rest, so it is kept here as typed.
	function input(event) {
		const home = state.home
		const { id, value } = event.target
		if (id === 'redraw-text') home.redraw.text = value
		else if (id === 'ask-text') home.askText = value
		else if (id === 'home-at') home.typed.at = value
		else if (id === 'home-since') home.typed.since = value
		else if (id === 'home-another') home.typed.another = value
		else return false
		return true
	}

	function change(event) {
		if (event.target.id !== 'home-change') return false
		Object.assign(state.home, { change: event.target.value, selected: null, storyOpen: false, opened: true, why: null })
		Object.assign(state.home.typed, { since: '', another: '' })
		void refresh()
		return true
	}

	function key(event) {
		const home = state.home
		const typing = event.target.matches?.('input, textarea, select')
		// Esc closes what is open, the nearest first: the drawer, a correction, what the panel shows in place of the
		// board, and then the level, which goes up one.
		if (event.key === 'Escape') {
			if (home.askOpen) closeAsk()
			else if (home.fixing) actions['home-fix']({ dataset: {} })
			else if (home.selected || home.opened || home.shown !== null || home.said || home.ended || home.trouble)
				void actions['home-board']()
			else if (home.trail.length > 1 && !typing) void moveTo(home.trail.slice(0, -1))
			else return false
			return true
		}
		if (event.key === 'Enter' && event.target.id === 'ask-text' && !event.shiftKey && !event.isComposing) {
			event.preventDefault()
			sendAsk()
			return true
		}
		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !typing && !home.askOpen && !home.reading) {
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
			opened: false,
			why: null,
		})
		await show()
		$('#home-level')?.focus({ preventScroll: true })
	}

	function pickInDrawing(target) {
		const number = target.closest('#home-canvas') ? numberAt(target) : null
		if (number === null) return
		const { selected } = state.home
		void select(selected?.number === number ? null : { kind: 'element', number })
	}

	// A press in the bar of "Show it another way" must not take the keyboard out of its box: the examples show only
	// while the box has it, so the bar would shrink under the mouse and the button would move away before the click.
	function press(event) {
		if (event.target.closest?.('#redraw-form') && event.target.id !== 'redraw-text') event.preventDefault()
	}

	// A quoted line opened in the panel is code the reader opened.
	const quoted = () => seen.now('code')

	return {
		actions,
		start,
		back,
		address,
		ended,
		submit,
		input,
		change,
		key,
		press,
		openAt,
		pick: pickInDrawing,
		point: board.point,
		watch: seen.watch,
		quoted,
	}
}
