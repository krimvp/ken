// ken's page: one state object and one render per frame, with no framework. The thread on the left holds the words;
// the panel on the right holds what ken checked. Under 1100 pixels the panel goes away and the same things open in
// place. The page talks only to the server that sent it.
import { answerHtml, itemsOf } from './views/answer.js'
import { checksHtml, quoteCardHtml } from './views/checks.js'
import { count, duration, esc, prose, when } from './views/format.js'
import {
	emptyAfterHtml,
	emptyHtml,
	endedHtml,
	noModelHtml,
	stepsHtml,
	workingHtml,
	workingPanelHtml,
} from './views/states.js'

const $ = (selector) => document.querySelector(selector)
const wideQuery = matchMedia('(min-width: 1100px)')
const EARLIER_SHOWN = 3

const freshUi = () => ({
	chosen: null,
	openQuotes: new Set(),
	openFiles: new Set(),
	stepsOpen: false,
	keyOpen: false,
	coverageOpen: false,
	summaryOpen: false,
	wide: wideQuery.matches,
})

const state = {
	project: '',
	model: null,
	rows: [],
	// The question on screen: a saved one from the history, or the one running now.
	open: null,
	running: null,
	menuOpen: false,
	problem: null,
	ui: freshUi(),
}

// A saved question as the page shows it: the history entry with its project record entries in place of their ids.
function fromView(view) {
	const { entry, recorded } = view
	return { answer: null, note: '', error: null, ...entry, recorded, live: false }
}

// The same fold as the server's entryFrom, for the question while it runs. The saved entry replaces it at the end.
function addEvent(q, event) {
	switch (event.kind) {
		case 'text': {
			if (q.answer) {
				q.note += event.delta
				break
			}
			const last = q.steps.at(-1)
			if (last?.kind === 'text') last.text += event.delta
			else q.steps.push({ kind: 'text', text: event.delta })
			break
		}
		case 'tool':
			q.steps.push({ kind: 'tool', text: event.step })
			break
		case 'rejected':
			q.steps.push({ kind: 'rejected', attempt: event.attempt, problems: event.problems })
			break
		case 'accepted':
			q.answer = event.answer
			q.recorded = event.recorded
			break
		case 'usage':
			q.usage = event
			break
		case 'done':
			if (event.outcome !== 'answered') q.outcome = event.outcome
			break
		case 'error':
			q.outcome = 'error'
			q.error = event.message
			break
	}
}

async function getJson(url) {
	const response = await fetch(url)
	const body = await response.json()
	if (!response.ok) throw new Error(body.message ?? `${url} answered ${response.status}`)
	return body
}

async function* linesOf(body) {
	const reader = body.pipeThrough(new TextDecoderStream()).getReader()
	let buffer = ''
	for (;;) {
		const { value, done } = await reader.read()
		if (done) break
		buffer += value
		const lines = buffer.split('\n')
		buffer = lines.pop()
		yield* lines.filter((line) => line.trim() !== '')
	}
	if (buffer.trim() !== '') yield buffer
}

async function send(text) {
	const question = text.trim()
	if (question === '' || state.running || state.model?.kind !== 'ok') return
	const q = {
		id: null,
		question,
		askedAt: new Date().toISOString(),
		outcome: 'working',
		steps: [],
		usage: null,
		answer: null,
		recorded: [],
		note: '',
		error: null,
		live: true,
	}
	const controller = new AbortController()
	state.running = { q, controller, started: Date.now() }
	state.open = q
	state.ui = freshUi()
	state.menuOpen = false
	$('#question').value = ''
	resizeBox()
	render()
	$('#turn')?.scrollIntoView({ block: 'start' })
	try {
		const response = await fetch('/api/questions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question }),
			signal: controller.signal,
		})
		if (!response.ok) {
			q.outcome = 'error'
			q.error = (await response.json()).message
			return
		}
		for await (const line of linesOf(response.body)) {
			const event = JSON.parse(line)
			if (event.kind === 'saved') {
				if (state.open === q) state.open = fromView(event.view)
			} else {
				addEvent(q, event)
			}
			schedule()
		}
	} catch (error) {
		if (controller.signal.aborted) {
			q.outcome = 'stopped'
		} else {
			q.outcome = 'error'
			q.error = `ken stopped answering (${error.message}). Check that ken open is still running in the terminal.`
		}
	} finally {
		q.live = false
		state.running = null
		await loadRows()
		const saved = state.rows.at(-1)
		// A stopped question has no saved line, so it is read back from the history.
		if (state.open === q && controller.signal.aborted && saved?.question === question) await openQuestion(saved.id)
		render()
	}
}

async function loadRows() {
	try {
		state.rows = (await getJson('/api/questions')).questions
	} catch (error) {
		state.problem = error.message
	}
}

async function openQuestion(id) {
	const view = await getJson(`/api/questions/${encodeURIComponent(id)}`)
	state.open = fromView(view)
	state.ui = freshUi()
}

// ---- Rendering ----

let scheduled = false
function schedule() {
	if (scheduled) return
	scheduled = true
	requestAnimationFrame(() => {
		scheduled = false
		render()
	})
}

function rowMeta(row) {
	const ended = {
		rejected: 'No checked answer: three answers sent back',
		stopped: 'You stopped it',
		error: 'The model did not answer',
		'no-answer': 'The agent sent no answer',
		'out-of-turns': 'The agent ran out of turns',
	}[row.outcome]
	if (ended) return `${when(row.askedAt)} · ${ended}`
	const parts = [count(row.statements, 'statement', 'statements')]
	if (row.decisions > 0) parts.push(count(row.decisions, 'decision', 'decisions'))
	if (row.hunks) parts.push(`${row.hunks.total - row.hunks.uncovered} of ${row.hunks.total} changed hunks quoted`)
	return `${when(row.askedAt)} · ${parts.join(', ')}`
}

function rowHtml(row, where) {
	const current = state.open?.id === row.id
	return `<button class="row" data-act="open" data-id="${esc(row.id)}" data-key="${where}-${esc(row.id)}"${current ? ' aria-current="true"' : ''}>
		<span class="row-q">${esc(row.question)}</span><span class="row-meta">${current ? 'Open now · ' : ''}${rowMeta(row)}</span></button>`
}

function menuHtml() {
	const n = state.rows.length
	if (n === 0) return ''
	const button = `<button class="link" data-act="menu" data-key="menu" aria-expanded="${state.menuOpen}"><span class="wide-only">Your questions</span><span class="narrow-only">Questions</span> (${n})</button>`
	if (!state.menuOpen) return button
	const running = state.running
		? `<button class="row" data-act="open-running" data-key="menu-running"><span class="row-q">${esc(state.running.q.question)}</span><span class="row-meta">Running now</span></button>`
		: ''
	const rows = [...state.rows].reverse().map((row) => rowHtml(row, 'menu'))
	return `${button}<div class="menu"><p class="menu-head">Your questions about this project, newest first. ken keeps them on this computer, outside the project.</p>${running}${rows.join('')}</div>`
}

function runLine(q, ui) {
	const tools = q.steps.filter((step) => step.kind === 'tool').length
	const back = q.steps.filter((step) => step.kind === 'rejected').length
	const parts = []
	if (q.live) parts.push('The agent is writing a closing note')
	if (q.usage && q.steps.length > 0) parts.push(duration(q.usage.seconds))
	if (back > 0) parts.push(`${count(back, 'answer', 'answers')} sent back`)
	const toggle =
		tools + back === 0
			? ''
			: `<button class="link" data-act="steps" data-key="steps" aria-expanded="${ui.stepsOpen}">${ui.stepsOpen ? 'Hide the steps' : `Show the ${count(tools, 'step', 'steps')}`}</button>`
	const tokens = q.usage
		? `<p class="small muted">${count(q.usage.inputTokens, 'token', 'tokens')} in, ${q.usage.outputTokens.toLocaleString('en-US')} out.</p>`
		: ''
	return `<p class="run-line">${[...parts, toggle].filter((part) => part !== '').join(' · ')}</p>${ui.stepsOpen ? stepsHtml(q.steps) + tokens : ''}`
}

function turnHtml(q, ui) {
	let body
	if (q.answer) body = runLine(q, ui) + answerHtml(q, ui)
	else if (q.live) body = workingHtml(q, ui, (Date.now() - state.running.started) / 1000)
	else body = runLine(q, ui) + endedHtml(q)
	return `<article class="turn" id="turn">
		<p class="asked">You asked ${when(q.askedAt)}</p>
		<h2 class="question">${prose(q.question)}</h2>
		${body}
	</article>`
}

function threadHtml() {
	const q = state.open
	if (state.problem && !q)
		return `<div class="notice" role="alert"><h3>ken did not answer</h3><p>${esc(state.problem)}</p></div>`
	if (!q) return emptyHtml(state.project)
	const at = q.id === null ? state.rows.length : state.rows.findIndex((row) => row.id === q.id)
	const earlier = state.rows.slice(Math.max(0, at - EARLIER_SHOWN), Math.max(0, at))
	const head =
		earlier.length === 0
			? ''
			: `<div class="earlier"><p class="earlier-head">${at > earlier.length ? `Earlier questions. ${count(at - earlier.length, 'more is', 'more are')} under Your questions, at the top.` : 'Earlier questions'}</p>${earlier.map((row) => rowHtml(row, 'row')).join('')}</div>`
	return head + turnHtml(q, state.ui)
}

function panelHtml() {
	const q = state.open
	const ui = state.ui
	if (!q || !ui.wide) return ''
	if (q.answer) return ui.chosen ? quoteCardHtml(q, ui, itemsOf(q)) : checksHtml(q, ui)
	if (q.live) return workingPanelHtml()
	return ''
}

function render() {
	const ui = state.ui
	ui.wide = wideQuery.matches
	const focused = document.activeElement?.dataset?.key
	const q = state.open
	const page = $('#page')
	const panel = $('#panel')
	const scroll = panel.scrollTop
	page.classList.toggle('first-visit', !q)
	page.classList.toggle('single', !q || (!q.answer && !q.live))
	const folder = state.project.split('/').at(-1)
	$('#project').innerHTML = state.project
		? `reads <code class="wide-only" title="${esc(state.project)}">${esc(state.project)}</code><code class="narrow-only">${esc(folder)}</code>`
		: ''
	$('#menu').innerHTML = menuHtml()
	$('#thread').innerHTML = threadHtml()
	const canAsk = state.model?.kind === 'ok'
	$('#ask').hidden = !canAsk
	$('#send').disabled = state.running !== null
	$('#after').innerHTML =
		state.model?.kind === 'unset' ? noModelHtml(state.model, state.rows.length > 0) : q ? '' : emptyAfterHtml()
	$('#question').placeholder = ui.wide
		? 'What changed, why was it done that way, how does a part work now?'
		: 'Ask about this project'
	panel.innerHTML = panelHtml()
	panel.scrollTop = scroll
	for (const bar of document.querySelectorAll('[data-share]')) bar.style.width = `${Number(bar.dataset.share) * 100}%`
	const summary = $('#summary')
	if (summary && !ui.summaryOpen) $('#summary-more').hidden = summary.scrollHeight <= summary.clientHeight + 1
	if (focused) document.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
}

function tick() {
	const clock = $('#working-clock')
	if (!clock || !state.running || state.open !== state.running.q) return
	const tools = state.running.q.steps.filter((step) => step.kind === 'tool').length
	clock.textContent = `${duration((Date.now() - state.running.started) / 1000)} so far, ${count(tools, 'step', 'steps')}`
}

// ---- What the reader can do ----

function choose(key, quote) {
	const ui = state.ui
	const same = ui.chosen?.key === key && ui.chosen.quote === quote
	ui.chosen = same ? null : { key, quote }
	render()
	$('#panel').scrollTop = 0
	if (ui.chosen) $(`#panel-q${quote}`)?.scrollIntoView({ block: 'nearest' })
}

function closeChosen() {
	const chosen = state.ui.chosen
	if (!chosen) return false
	state.ui.chosen = null
	render()
	document.querySelector(`[data-key="${chosen.key}-q${chosen.quote}"]`)?.focus({ preventScroll: true })
	return true
}

function toggle(set, key) {
	if (set.has(key)) set.delete(key)
	else set.add(key)
}

function ask(text) {
	const box = $('#question')
	box.value = text
	resizeBox()
	box.focus()
}

const actions = {
	menu() {
		state.menuOpen = !state.menuOpen
		render()
	},
	async open(el) {
		state.menuOpen = false
		await openQuestion(el.dataset.id)
		render()
		$('#turn')?.scrollIntoView({ block: 'start' })
		$('#turn .q-row, #turn button')?.focus({ preventScroll: true })
	},
	'open-running'() {
		state.menuOpen = false
		state.open = state.running.q
		state.ui = freshUi()
		render()
	},
	quote(el) {
		const key = el.dataset.item
		const quote = Number(el.dataset.quote)
		if (state.ui.wide) return choose(key, quote)
		toggle(state.ui.openQuotes, `${key}-q${quote}`)
		render()
	},
	'all-quotes'() {
		const ui = state.ui
		const keys = itemsOf(state.open).flatMap(({ key, item }) => item.quotes.map((_, j) => `${key}-q${j}`))
		const allOpen = keys.every((key) => ui.openQuotes.has(key))
		ui.openQuotes = allOpen ? new Set() : new Set(keys)
		render()
	},
	step(el) {
		const items = itemsOf(state.open)
		const at = items.findIndex(({ key }) => key === state.ui.chosen.key) + Number(el.dataset.by)
		if (items[at]) choose(items[at].key, 0)
	},
	close: closeChosen,
	summary() {
		state.ui.summaryOpen = true
		render()
	},
	steps() {
		state.ui.stepsOpen = !state.ui.stepsOpen
		render()
	},
	key() {
		state.ui.keyOpen = !state.ui.keyOpen
		render()
	},
	coverage() {
		state.ui.coverageOpen = !state.ui.coverageOpen
		render()
		if (state.ui.coverageOpen) $('#coverage-list')?.scrollIntoView({ block: 'nearest' })
	},
	example: (el) => ask(el.textContent),
	'one-commit': () => ask('What did the last commit do?'),
	again: () => send(state.open.question),
	stop() {
		state.running?.controller.abort()
	},
}

document.addEventListener('click', (event) => {
	const el = event.target.closest('[data-act]')
	if (state.menuOpen && !event.target.closest('#menu')) {
		state.menuOpen = false
		render()
	}
	if (el && !el.disabled) void actions[el.dataset.act](el)
})

// A file's diff is drawn when the reader opens it.
document.addEventListener(
	'toggle',
	(event) => {
		const file = event.target.dataset?.file
		if (file === undefined) return
		const open = state.ui.openFiles
		if (event.target.open === open.has(file)) return
		toggle(open, file)
		render()
	},
	true,
)

document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape') return
	const ui = state.ui
	if (state.menuOpen) {
		state.menuOpen = false
		render()
		$('[data-key="menu"]')?.focus()
		return
	}
	if (closeChosen()) return
	if (ui.coverageOpen || ui.stepsOpen || ui.keyOpen || ui.openQuotes.size > 0) {
		ui.coverageOpen = ui.stepsOpen = ui.keyOpen = false
		ui.openQuotes = new Set()
		render()
	}
})

function resizeBox() {
	const box = $('#question')
	box.style.height = ''
	if (box.value !== '') box.style.height = `${box.scrollHeight + 2}px`
}

$('#ask').addEventListener('submit', (event) => {
	event.preventDefault()
	void send($('#question').value)
})

$('#question').addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		void send($('#question').value)
	}
})

$('#question').addEventListener('input', resizeBox)
wideQuery.addEventListener('change', render)
setInterval(tick, 1000)

try {
	const [server] = await Promise.all([getJson('/api/state'), loadRows()])
	state.project = server.project
	state.model = server.model
	const last = state.rows.at(-1)
	if (last) await openQuestion(last.id)
} catch (error) {
	state.problem = `ken did not answer at this address (${error.message}). Start it again with ken open.`
}
render()
$('#turn')?.scrollIntoView({ block: 'start' })
