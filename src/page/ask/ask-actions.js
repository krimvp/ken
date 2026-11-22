// What the reader does with the "Ask ken" drawer: open and close it from the rail, take a question it suggests into
// the box, send the box, and show their earlier replies. The drawer keeps the briefs the reader opened last, for the
// questions it suggests.
import { fill } from '../shell/fill.js'
import { focusLabel } from '../views/format.js'
import { askDrawerHtml } from './ask.js'

const REMEMBERED = 6

export const freshAsk = () => ({
	open: false,
	opener: null,
	text: '',
	suggestion: null,
	about: null,
	earlier: false,
	recent: [],
})

// app is the page: its state, render, send, and the store of briefs.
export function askActions(app) {
	const { state, render, send } = app
	const ask = state.ask
	const $ = (selector) => document.querySelector(selector)

	const briefOf = (id) => {
		const found = app.briefs.get(id, render)
		return found.kind === 'ok' ? found.brief : null
	}

	// Carry the active architecture view and a few of its links. The model can open their saved evidence on demand.
	function architectureFocus() {
		const { look } = state.home
		if (state.view !== 'home' || state.shell.page !== 'architecture' || !look || state.home.reading) return null
		const view = state.arch.shown
		if (!view) return null
		const nodes = document.querySelectorAll('#arch-world [data-concept], .k-arch-reading article [data-concept]')
		const ids = [...new Set(Array.from(nodes, (node) => node.dataset.concept))].filter((id) => id && id.length <= 120)
		const links = ids.filter((id) => /^(crossing|arrow):/.test(id)).slice(0, 3)
		const concepts = [...new Set([...links, ...ids])].slice(0, 8)
		const earlier =
			view === 'parts'
				? look.arrows.some((arrow) => arrow.stale) || look.boxes.some((box) => box.state === 'changed')
				: Boolean(look.views?.stale?.some((item) => item.view === view))
		return { view, commit: look.at, concepts, earlier }
	}

	// A brief the reader opened, newest first, for the questions the drawer suggests.
	function remember(id) {
		const kind = id.slice(0, id.indexOf(':'))
		if (!['part', 'term', 'process'].includes(kind)) return
		ask.recent = [id, ...ask.recent.filter((each) => each !== id)].slice(0, REMEMBERED)
	}

	function draw(env) {
		const drawer = $('#ask-drawer')
		drawer.hidden = !ask.open
		fill(drawer, ask.open ? askDrawerHtml(ask, env, briefOf) : '')
	}

	function close() {
		if (!ask.open) return false
		ask.open = false
		render()
		if (ask.opener) $(`[data-key="${ask.opener}"]`)?.focus()
		return true
	}

	function sendBox() {
		const text = ask.text.trim()
		// With no run to start, the question stays in its box.
		if (text === '' || state.running || state.model?.kind !== 'ok') return
		const about = ask.about
		const typed = text !== ask.suggestion
		Object.assign(ask, { text: '', open: false, about: null, suggestion: null })
		if (state.brief.on === 'source') app.brief.close()
		if (about?.focus) void send({ question: text, focus: about.focus })
		else if (about) {
			app.brief.show(about.id, { opener: ask.opener })
			void app.brief.ask(text, typed)
		} else void send({ question: text })
	}

	const actions = {
		'ask-open'(el) {
			if (ask.open) return close()
			ask.open = true
			ask.opener = el.dataset.key
			const brief = app.brief.open()
			const page = state.brief.on === 'source' ? state.brief.source : null
			if (!ask.text.trim() || el.dataset.key === 'ask-source') {
				if (page?.lines?.length) {
					const { path, commit } = page.where
					const focus = { path, commit, start: page.start, end: page.start + page.lines.length - 1 }
					ask.about = { name: focusLabel(focus), focus }
				} else if (brief && !brief.local) ask.about = { id: brief.id, name: brief.name }
				else {
					const focus = brief ? null : architectureFocus()
					ask.about = focus ? { name: focusLabel(focus), focus } : null
				}
			}
			if (!page?.lines?.length) app.brief.close()
			render()
			$('#ask-title')?.focus()
		},
		'ask-close': close,
		'ask-earlier'() {
			ask.earlier = !ask.earlier
			render()
		},
		'ask-suggest'(el) {
			const brief = briefOf(el.dataset.about)
			const question = brief?.questions.find((each) => each.id === el.dataset.concept)
			if (!question) return
			ask.text = ask.suggestion = question.text
			ask.about = { id: brief.id, name: brief.name }
			render()
			$('#ask-text')?.focus()
		},
		'ask-anything'() {
			ask.about = null
			render()
			$('#ask-text')?.focus()
		},
	}

	function submit(event) {
		if (event.target.id !== 'ask-form') return false
		event.preventDefault()
		sendBox()
		return true
	}

	function input(event) {
		if (event.target.id !== 'ask-text') return false
		ask.text = event.target.value
		return true
	}

	// Enter sends the question; Shift and Enter starts a new line.
	function key(event) {
		if (event.key !== 'Enter' || event.target.id !== 'ask-text' || event.shiftKey || event.isComposing) return false
		event.preventDefault()
		sendBox()
		return true
	}

	return { actions, draw, close, remember, submit, input, key }
}
