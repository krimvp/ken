// ken's page: one state object and one render per frame, with no framework. The thread on the left holds the words;
// the panel on the right holds what ken checked. Under 1100 pixels the panel goes away and the same things open in
// place. The page talks only to the server that sent it.
import { fillDrawings } from './draw-diagrams.js'
import { answerHtml, itemsOf } from './views/answer.js'
import { allQuotesHtml, checksHtml, quoteCardHtml } from './views/checks.js'
import { elementKey } from './views/diagram.js'
import { count, duration, esc, folderHtml, prose, short, when } from './views/format.js'
import {
	emptyAfterHtml,
	emptyHtml,
	endedHtml,
	endedPanelHtml,
	noModelHtml,
	stepsHtml,
	workingHtml,
	workingPanelHtml,
} from './views/states.js'

const $ = (selector) => document.querySelector(selector)
const wideQuery = matchMedia('(min-width: 1100px)')
const darkQuery = matchMedia('(prefers-color-scheme: dark)')

// panel is what the right column shows on a wide screen: what ken checked, the quotes of one item, or all quotes.
const CHECKS = { kind: 'checks' }

const freshUi = () => ({
	panel: CHECKS,
	openQuotes: new Set(),
	openDecisions: new Set(),
	openParts: new Set(),
	openFiles: new Set(),
	stepsOpen: false,
	keyOpen: false,
	coverageOpen: false,
	summaryOpen: false,
	noteOpen: false,
	// The diagrams whose numbered list the page opened by itself, once, because the drawing did not fit.
	partsShown: new Set(),
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

// A saved question as the page shows it: the history entry with its project record entries in place of their ids, and
// the project's HEAD now, to compare with the HEAD it was asked at.
function fromView(view) {
	const { entry, recorded, head } = view
	return { answer: null, note: '', error: null, ...entry, recorded, headNow: head, live: false }
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
		head: null,
		headNow: null,
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
	// On a phone the keyboard would cover the answer as it arrives.
	if (!state.ui.wide) $('#question').blur()
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
		rejected: 'No answer: the quotes did not match the code',
		stopped: 'You stopped it',
		error: 'The model did not answer',
		'no-answer': 'The agent sent no answer',
		'out-of-turns': 'The agent ran out of turns',
	}[row.outcome]
	if (ended) return `${when(row.askedAt)} · ${ended}`
	const parts = [count(row.statements, 'statement', 'statements')]
	if (row.decisions > 0) parts.push(count(row.decisions, 'decision', 'decisions'))
	if (row.calls > 0) parts.push(`${row.calls} ${row.calls === 1 ? 'needs' : 'need'} your call`)
	if (row.risks > 0) parts.push(count(row.risks, 'risk', 'risks'))
	if (row.hunks) parts.push(`${row.hunks.total - row.hunks.uncovered} of ${row.hunks.total} changed blocks quoted`)
	return `${when(row.askedAt)} · ${parts.join(', ')}`
}

function rowHtml(row) {
	const current = state.open?.id === row.id
	return `<button class="row" data-act="open" data-id="${esc(row.id)}" data-key="menu-${esc(row.id)}"${current ? ' aria-current="true"' : ''}>
		<span class="row-q">${esc(row.question)}</span><span class="row-meta">${current ? 'Open now · ' : ''}${rowMeta(row)}</span></button>`
}

function menuHtml() {
	const n = state.rows.length
	if (n === 0) return ''
	const button = `<button class="link" data-act="menu" data-key="menu" aria-expanded="${state.menuOpen}">Your questions (${n})</button>`
	if (!state.menuOpen) return button
	const running = state.running
		? `<button class="row" data-act="open-running" data-key="menu-running"><span class="row-q">${esc(state.running.q.question)}</span><span class="row-meta">Running now</span></button>`
		: ''
	const rows = [...state.rows].reverse().map((row) => rowHtml(row))
	return `${button}<div class="menu"><p class="menu-head">Your questions about this project, newest first. ken keeps them on this computer, outside the project.</p>${running}${rows.join('')}</div>`
}

function runLine(q, ui) {
	const tools = q.steps.filter((step) => step.kind === 'tool').length
	const back = q.steps.filter((step) => step.kind === 'rejected').length
	const parts = []
	if (q.live) parts.push('The agent is writing a closing note')
	if (q.usage && q.steps.length > 0) parts.push(duration(q.usage.seconds))
	if (back > 0 && q.answer) parts.push(`ken rejected ${count(back, 'earlier draft', 'earlier drafts')}`)
	else if (back > 0) parts.push(`${count(back, 'answer', 'answers')} sent back`)
	if (tools + back > 0) {
		parts.push(
			`<button class="link" data-act="steps" data-key="steps" aria-expanded="${ui.stepsOpen}">${ui.stepsOpen ? 'Hide the steps' : `Show the ${count(tools, 'step', 'steps')}`}</button>`,
		)
	}
	const tokens = q.usage
		? `<p class="small muted">${count(q.usage.inputTokens, 'token', 'tokens')} in, ${q.usage.outputTokens.toLocaleString('en-US')} out.</p>`
		: ''
	// The dot goes with the part after it, so a wrapped line never ends on one.
	const line = parts.map((part, i) => (i === 0 ? part : `<span class="nowrap">· ${part}</span>`)).join(' ')
	return `<p class="run-line">${line}</p>${ui.stepsOpen ? stepsHtml(q.steps) + tokens : ''}`
}

function turnHtml(q, ui) {
	let body
	if (q.answer) body = runLine(q, ui) + answerHtml(q, ui)
	else if (q.live) body = workingHtml(q, ui, (Date.now() - state.running.started) / 1000)
	else body = runLine(q, ui) + endedHtml(q)
	return `<article class="turn" id="turn">
		<p class="asked">You asked ${when(q.askedAt)}</p>
		<h2 class="question">${prose(q.question)}</h2>
		${movedHtml(q)}
		${body}
	</article>`
}

function movedHtml(q) {
	if (!q.head || !q.headNow || q.head === q.headNow) return ''
	const again =
		state.model?.kind === 'ok' && !state.running
			? ' <button class="link" data-act="again" data-key="moved-again">Ask again</button>'
			: ''
	return `<p class="moved">Asked when the project was at <code>${short(q.head)}</code>. It is at <code>${short(q.headNow)}</code> now, so the code may have changed since.${again}</p>`
}

function threadHtml() {
	const q = state.open
	if (state.problem && !q)
		return `<div class="notice" role="alert"><h3>ken did not answer</h3><p>${esc(state.problem)}</p></div>`
	if (!q) return emptyHtml(state.project, state.model?.kind === 'ok')
	return turnHtml(q, state.ui)
}

function panelHtml() {
	const q = state.open
	const ui = state.ui
	if (!q || !ui.wide) return ''
	if (!q.answer) return q.live ? workingPanelHtml() : endedPanelHtml()
	if (ui.panel.kind === 'quote') return quoteCardHtml(q, ui, itemsOf(q))
	if (ui.panel.kind === 'all') return allQuotesHtml(q, itemsOf(q))
	return checksHtml(q, ui)
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
	page.classList.toggle('single', !q)
	$('#project').innerHTML = state.project ? `reads ${folderHtml(state.project)}` : ''
	$('#menu').innerHTML = menuHtml()
	const across = [...document.querySelectorAll('.drawing')].map((box) => box.scrollLeft)
	$('#thread').innerHTML = threadHtml()
	const tooWide = fillDrawings($('#thread'), schedule)
	// A drawing that does not fit opens its numbered list once, so the parts cut off at the edge can be read in words.
	const unseen = tooWide.filter((index) => !ui.partsShown.has(index))
	for (const index of unseen) {
		ui.partsShown.add(index)
		ui.openParts.add(index)
	}
	if (unseen.length > 0) schedule()
	for (const [i, box] of document.querySelectorAll('.drawing').entries()) box.scrollLeft = across[i] ?? 0
	const canAsk = state.model?.kind === 'ok'
	$('#ask').hidden = !canAsk
	$('#send').disabled = state.running !== null
	$('#after').innerHTML =
		state.model?.kind === 'unset'
			? noModelHtml(state.model, state.rows.length > 0, q !== null)
			: q
				? ''
				: emptyAfterHtml()
	$('#question').placeholder = ui.wide ? 'Ask what changed, why, or how a part works.' : 'Ask what changed, and why.'
	panel.innerHTML = panelHtml()
	panel.scrollTop = scroll
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
	const same = ui.panel.kind === 'quote' && ui.panel.key === key && ui.panel.quote === quote
	ui.panel = same ? CHECKS : { kind: 'quote', key, quote }
	render()
	$('#panel').scrollTop = 0
	if (!same) $(`#panel-q${quote}`)?.scrollIntoView({ block: 'nearest' })
}

// A box or an arrow in a drawing does what the first quote row of its numbered row does. Every label in a drawing
// starts with its element's number, so the smallest part of the drawing around the click that holds one label names it.
function chooseInDrawing(target) {
	const box = target.closest('.drawing')
	for (let el = target; box && el !== box; el = el.parentElement) {
		if ((el.textContent.match(/\d+\. /g) ?? []).length > 1) return
		const number = Number(el.textContent.trim().match(/^(\d+)\. /)?.[1])
		if (!number) continue
		const index = Number(box.dataset.diagram)
		const key = elementKey(index, number)
		const element = state.open.answer.diagrams[index]?.elements.find((each) => each.number === number)
		if (element?.quotes.length > 0) {
			if (state.ui.wide) return choose(key, 0)
			state.ui.openParts.add(index)
			state.ui.openQuotes.add(`${key}-q0`)
			render()
		}
		return $(`#item-${key}`)?.scrollIntoView({ block: 'nearest' })
	}
}

function closePanel() {
	const shown = state.ui.panel
	if (shown.kind === 'checks') return false
	state.ui.panel = CHECKS
	render()
	const back = shown.kind === 'quote' ? `${shown.key}-q${shown.quote}` : 'all-quotes'
	document.querySelector(`[data-key="${back}"]`)?.focus({ preventScroll: true })
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
		if (ui.wide) {
			ui.panel = ui.panel.kind === 'all' ? CHECKS : { kind: 'all' }
			render()
			$('#panel').scrollTop = 0
			return
		}
		const keys = itemsOf(state.open).flatMap(({ key, item }) => item.quotes.map((_, j) => `${key}-q${j}`))
		const allOpen = keys.every((key) => ui.openQuotes.has(key))
		ui.openQuotes = allOpen ? new Set() : new Set(keys)
		if (!allOpen) for (const key of keys.filter((each) => each.startsWith('d'))) ui.openDecisions.add(key.split('-')[0])
		render()
	},
	decision(el) {
		toggle(state.ui.openDecisions, el.dataset.item)
		render()
	},
	parts(el) {
		toggle(state.ui.openParts, Number(el.dataset.diagram))
		render()
	},
	step(el) {
		const items = itemsOf(state.open)
		const at = items.findIndex(({ key }) => key === state.ui.panel.key) + Number(el.dataset.by)
		if (items[at]) choose(items[at].key, 0)
	},
	close: closePanel,
	summary() {
		state.ui.summaryOpen = true
		render()
	},
	note() {
		state.ui.noteOpen = true
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
	else if (state.open?.answer) chooseInDrawing(event.target)
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
	if (closePanel()) return
	if (ui.coverageOpen || ui.stepsOpen || ui.keyOpen || ui.openQuotes.size > 0 || ui.openDecisions.size > 0) {
		ui.coverageOpen = ui.stepsOpen = ui.keyOpen = false
		ui.openQuotes = new Set()
		ui.openDecisions = new Set()
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
darkQuery.addEventListener('change', render)
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
