// ken's page: one state object and one render per frame, with no framework. The thread on the left holds the words;
// the panel on the right holds what ken checked. Under 1100 pixels the panel goes away and the same things open in
// place. The page talks only to the server that sent it.
import { fillDrawings } from './draw-diagrams.js'
import { answerHtml, itemsOf } from './views/answer.js'
import { allQuotesHtml, checksHtml, quoteCardHtml } from './views/checks.js'
import { elementKey } from './views/diagram.js'
import { count, duration, esc, folderHtml, prose, short, when } from './views/format.js'
import { lensHtml, mapViewHtml } from './views/map.js'
import { openCount, openViewHtml } from './views/open.js'
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
	// The topics the reader knows whose entries they asked to see anyway, and the last map button they pressed.
	unfolded: new Set(),
	mapSaid: null,
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
	// "map" shows the reader's understanding map in place of the question, and "follow-up" what is open.
	view: 'question',
	map: null,
	ui: freshUi(),
	// What is open, with its own open decisions and quotes, and the line that says what the last button saved.
	followUp: null,
	followUi: freshUi(),
	followSaid: '',
	// The authors of recent commits, and the person and span the reader picked in the lens "What changed".
	authors: [],
	pick: { author: '', since: '' },
}

// The open decisions and quotes of the view on screen.
const uiNow = () => (state.view === 'follow-up' ? state.followUi : state.ui)

// What the page shows as the question until ken sends the one it wrote for a lens.
const LENS_TITLES = {
	'catch-up': 'Catch me up: what differs from what I understood?',
	area: 'What do I need to know to work here today?',
	deeper: 'Go one level deeper',
	person: 'What did they change?',
	range: 'What happened?',
	topic: 'What changed since I understood it?',
}

// A saved question as the page shows it: the history entry with its project record entries in place of their ids, and
// the project's HEAD now, to compare with the HEAD it was asked at.
function fromView(view) {
	const { entry, recorded, head, topics } = view
	return { answer: null, note: '', error: null, ...entry, recorded, topics, headNow: head, live: false }
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
		case 'asked':
			q.question = event.question
			break
		case 'accepted':
			q.answer = event.answer
			q.recorded = event.recorded
			q.topics = event.topics
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

// body is a question, {question}, or a lens for ken to write the question from, {lens}.
async function send(body) {
	const question = body.lens ? LENS_TITLES[body.lens.kind] : body.question.trim()
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
		topics: [],
		note: '',
		error: null,
		live: true,
	}
	const controller = new AbortController()
	state.running = { q, controller, started: Date.now() }
	state.open = q
	state.ui = freshUi()
	state.menuOpen = false
	state.view = 'question'
	if (!body.lens) $('#question').value = ''
	resizeBox()
	// On a phone the keyboard would cover the answer as it arrives.
	if (!state.ui.wide) $('#question').blur()
	render()
	$('#turn')?.scrollIntoView({ block: 'start' })
	try {
		const response = await fetch('/api/questions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal,
		})
		if (!response.ok) {
			const refused = await response.json()
			// A lens ken refused, or one with nothing to explain, never reached the model.
			const unasked = body.lens && (response.status === 400 || response.status === 422)
			q.outcome = unasked ? 'unasked' : 'error'
			q.error = refused.message
			if (refused.question) q.question = refused.question
			return
		}
		for await (const line of linesOf(response.body)) {
			const event = JSON.parse(line)
			if (event.kind === 'saved') {
				// The topics keep the states they had when the answer came, so a button pressed while the note was still
				// coming does not fold the answer the reader is reading.
				if (state.open === q) state.open = { ...fromView(event.view), topics: q.topics }
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
		await Promise.all([loadRows(), loadFollowUp()])
		const saved = state.rows.at(-1)
		// A stopped question has no saved line, so it is read back from the history.
		if (state.open === q && controller.signal.aborted && saved?.question === q.question) await openQuestion(saved.id)
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

async function loadFollowUp() {
	try {
		state.followUp = await getJson('/api/open')
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
		<span class="row-q">${esc(firstLine(row.question))}</span><span class="row-meta">${current ? 'Open now · ' : ''}${rowMeta(row)}</span></button>`
}

// A lens's question is a line the reader asked and the list ken wrote under it.
function firstLine(question) {
	return question.split('\n')[0]
}

function menuHtml() {
	const n = state.rows.length
	const waiting = openCount(state.followUp)
	const open =
		waiting === 0
			? ''
			: `<button class="link" data-act="follow-up" data-key="follow-up"${state.view === 'follow-up' ? ' aria-current="page"' : ''}>Open (${waiting})</button>`
	const map = `${open}<button class="link" data-act="map" data-key="map"${state.view === 'map' ? ' aria-current="page"' : ''}>Your map</button>`
	if (n === 0) return map
	const button = `${map}<button class="link" data-act="menu" data-key="menu" aria-expanded="${state.menuOpen}">Your questions (${n})</button>`
	if (!state.menuOpen) return button
	const running = state.running
		? `<button class="row" data-act="open-running" data-key="menu-running"><span class="row-q">${esc(firstLine(state.running.q.question))}</span><span class="row-meta">Running now</span></button>`
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
	if (q.answer) body = runLine(q, ui) + answerHtml(q, ui, state.running !== null)
	else if (q.live) body = workingHtml(q, ui, (Date.now() - state.running.started) / 1000)
	else body = runLine(q, ui) + endedHtml(q)
	return `<article class="turn" id="turn">
		<p class="asked">You asked ${when(q.askedAt)}</p>
		${questionHtml(q.question)}
		${movedHtml(q)}
		${body}
	</article>`
}

function questionHtml(question) {
	const [first, ...listed] = question.split('\n')
	const items = listed.map((line) => `<li>${prose(line.replace(/^- /, ''))}</li>`).join('')
	return `<h2 class="question">${prose(first)}</h2>${items ? `<ul class="asked-list">${items}</ul>` : ''}`
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
	if (state.view === 'map') return mapViewHtml(state.map)
	if (state.view === 'follow-up') {
		return openViewHtml(state.followUp, state.followUi, state.model?.kind === 'ok' && !state.running, state.followSaid)
	}
	const q = state.open
	if (state.problem && !q)
		return `<div class="notice" role="alert"><h3>ken did not answer</h3><p>${esc(state.problem)}</p></div>`
	if (!q) return emptyHtml(state.project, state.model?.kind === 'ok')
	return turnHtml(q, state.ui)
}

function panelHtml() {
	const q = state.open
	const ui = state.ui
	if (!q || !ui.wide || state.view !== 'question') return ''
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
	page.classList.toggle('first-visit', !q && state.view === 'question')
	page.classList.toggle('single', !q || state.view !== 'question')
	$('#project').innerHTML = state.project ? `reads ${folderHtml(state.project)}` : ''
	$('#menu').innerHTML = menuHtml()
	const across = [...document.querySelectorAll('.drawing')].map((box) => box.scrollLeft)
	const notes = [...document.querySelectorAll('.decide-form')].map((form) => [
		form.dataset.id,
		form.elements.note.value,
	])
	$('#thread').innerHTML = threadHtml()
	for (const [id, note] of notes) {
		const box = document.querySelector(`.decide-form[data-id="${CSS.escape(id)}"] textarea`)
		if (box) box.value = note
	}
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
	$('#ask').hidden = !canAsk || state.view !== 'question'
	$('#send').disabled = state.running !== null
	// The area box is drawn again with the rest, so what the reader typed in it is carried over.
	const typed = [...document.querySelectorAll('.area-form input')].find((input) => input.value !== '')?.value ?? ''
	const pick = { ...state.pick, authors: state.authors, asked: state.rows.length > 0 }
	$('#after').innerHTML =
		state.model?.kind === 'unset'
			? noModelHtml(state.model, state.rows.length > 0, q !== null)
			: state.view !== 'question'
				? ''
				: q
					? lensHtml('ask', pick)
					: emptyAfterHtml(lensHtml('start', pick))
	for (const input of document.querySelectorAll('.area-form input')) input.value = typed
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

async function postMap(signal) {
	const response = await fetch('/api/map', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ signal, topics: state.open.answer.topics }),
	})
	if (!response.ok) throw new Error((await response.json()).message)
	state.ui.mapSaid = signal
	await loadFollowUp()
	render()
}

async function showMap() {
	state.view = 'map'
	state.menuOpen = false
	state.map = null
	render()
	try {
		state.map = await getJson('/api/map')
	} catch (error) {
		state.map = { file: '', states: [], problems: [error.message] }
	}
	render()
	window.scrollTo({ top: 0 })
}

function closeMap() {
	state.view = 'question'
	render()
	$('[data-key="map"]')?.focus({ preventScroll: true })
}

async function showFollowUp() {
	state.view = 'follow-up'
	state.menuOpen = false
	state.followSaid = ''
	await loadFollowUp()
	// Every decision shows open here: the reader came to decide.
	state.followUi = {
		...freshUi(),
		wide: false,
		openDecisions: new Set(state.followUp?.decisions.map((_, i) => `o${i}`)),
	}
	render()
	window.scrollTo({ top: 0 })
}

function closeFollowUp() {
	state.view = 'question'
	render()
	$('[data-key="follow-up"], [data-key="map"]')?.focus({ preventScroll: true })
}

async function post(url, body) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
	const answer = await response.json()
	if (!response.ok) throw new Error(answer.message)
	return answer
}

// A button in the open list: it saves, then the list is read again and a line says what was saved.
async function followUpSaved(save, said) {
	try {
		await save()
		state.followSaid = said
	} catch (error) {
		state.followSaid = error.message
	}
	await loadFollowUp()
	render()
}

const actions = {
	map: () => (state.view === 'map' ? closeMap() : showMap()),
	'follow-up': () => (state.view === 'follow-up' ? closeFollowUp() : showFollowUp()),
	'open-close': closeFollowUp,
	'explain-topic': (el) => send({ lens: { kind: 'topic', topic: el.dataset.topic } }),
	'know-topic': (el) =>
		followUpSaved(
			() => post('/api/map', { signal: 'know', topics: [el.dataset.topic] }),
			`Saved. Your map says you know ${el.dataset.topic}, as the code is now.`,
		),
	'map-close': closeMap,
	'map-know': () => postMap('know'),
	'map-too-much': () => postMap('too-much'),
	'map-deeper'() {
		const q = state.open
		void send({ lens: { kind: 'deeper', topics: q.answer.topics, question: firstLine(q.question) } })
	},
	unfold(el) {
		toggle(state.ui.unfolded, el.dataset.topic)
		render()
	},
	'catch-up': () => send({ lens: { kind: 'catch-up' } }),
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
		if (uiNow().wide) return choose(key, quote)
		toggle(uiNow().openQuotes, `${key}-q${quote}`)
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
		toggle(uiNow().openDecisions, el.dataset.item)
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
	again: () => send({ question: state.open.question }),
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
	if (state.view === 'map') return closeMap()
	if (state.view === 'follow-up') return closeFollowUp()
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
	void send({ question: $('#question').value })
})

document.addEventListener('submit', (event) => {
	const form = event.target.closest('.area-form, .change-form, .decide-form')
	if (!form) return
	event.preventDefault()
	if (form.matches('.decide-form')) {
		const body = { decision: form.dataset.id, note: form.elements.note.value }
		void followUpSaved(
			() => post('/api/decided', body),
			'Saved. The record keeps your answer and the decision as it was.',
		)
		return
	}
	if (form.matches('.change-form')) {
		const { author, since } = form.elements
		const lens = author.value === '' ? { kind: 'range' } : { kind: 'person', author: author.value }
		void send({ lens: { ...lens, since: since.value } })
		return
	}
	const path = form.elements.path.value.trim()
	if (path !== '') void send({ lens: { kind: 'area', path } })
})

// The lens forms are drawn again with the rest, so the person and the span the reader picked are kept here.
document.addEventListener('change', (event) => {
	const form = event.target.closest('.change-form')
	if (!form) return
	state.pick = { author: form.elements.author.value, since: form.elements.since.value }
})

$('#question').addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		void send({ question: $('#question').value })
	}
})

$('#question').addEventListener('input', resizeBox)
wideQuery.addEventListener('change', render)
darkQuery.addEventListener('change', render)
setInterval(tick, 1000)

try {
	const [server, recent] = await Promise.all([
		getJson('/api/state'),
		getJson('/api/authors'),
		loadRows(),
		loadFollowUp(),
	])
	state.project = server.project
	state.model = server.model
	state.authors = recent.authors
	const last = state.rows.at(-1)
	if (last) await openQuestion(last.id)
} catch (error) {
	state.problem = `ken did not answer at this address (${error.message}). Start it again with ken open.`
}
render()
$('#turn')?.scrollIntoView({ block: 'start' })
