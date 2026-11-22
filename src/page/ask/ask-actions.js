// What the reader does with the "Ask ken" drawer: open and close it from the rail, take a question it suggests into
// the box, send the box, and show their earlier replies. The drawer keeps the briefs the reader opened last, for the
// questions it suggests.
import { fill } from '../shell/fill.js'
import { askDrawerHtml, suggestions } from './ask.js'

const REMEMBERED = 6

export const freshAsk = () => ({ open: false, text: '', earlier: false, recent: [] })

// app is the page: its state, render, send, and the store of briefs.
export function askActions(app) {
	const { state, render, send } = app
	const ask = state.ask
	const $ = (selector) => document.querySelector(selector)

	const briefOf = (id) => {
		const found = app.briefs.get(id, render)
		return found.kind === 'ok' ? found.brief : null
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
		$('[data-key="ask-open"], [data-key="bar-ask"]')?.focus()
		return true
	}

	function sendBox() {
		const text = ask.text.trim()
		// With no run to start, the question stays in its box.
		if (text === '' || state.running || state.model?.kind !== 'ok') return
		Object.assign(ask, { text: '', open: false })
		void send({ question: text })
	}

	const actions = {
		'ask-open'() {
			ask.open = !ask.open
			app.brief.close()
			render()
			if (ask.open) $('#ask-title')?.focus()
		},
		'ask-close': close,
		'ask-earlier'() {
			ask.earlier = !ask.earlier
			render()
		},
		'ask-suggest'(el) {
			ask.text = suggestions(ask.recent, briefOf)[Number(el.dataset.index)]?.text ?? ''
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
