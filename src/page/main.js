// ken's page: one state object and one render per frame, with no framework. The home is the project as a picture, with
// what ken says about it beside it (src/page/home). A question opens as a thread: the words on the left, and on the
// right the panel with what ken checked. Under 1100 pixels the panel goes away and the same things open in place. The
// page talks only to the server that sent it.
import { fillDrawings, markPart, numberAt } from './draw-diagrams.js'
import { freshHome, homeActions } from './home/home-actions.js'
import { showHome } from './home/home-view.js'
import { liveLook, liveViewHtml } from './live/live-view.js'
import { changeKey } from './project/change-card.js'
import { learnParts } from './project/part-colours.js'
import { atRest, drawPictures, lightPicture } from './project/parts-picture.js'
import { tourKey } from './project/tour-card.js'
import { partOf, stepDiffHtml, stopState, stopTopics, tourStart, walkOf } from './project/walk.js'
import { allQuotesHtml, checksHtml, quoteCardHtml } from './views/checks.js'
import { decisionsViewHtml } from './views/decisions.js'
import { elementKey } from './views/diagram.js'
import { count, duration, esc, folderHtml, prose, short, when } from './views/format.js'
import { changedLine, changedTopics, lensHtml, mapViewHtml } from './views/map.js'
import { openCount, openViewHtml } from './views/open.js'
import {
	cardsOf,
	chipQuestion,
	isMoved,
	itemsOf,
	knowPartHtml,
	LEGEND,
	replyHtml,
	stepCardsHtml,
} from './views/reply.js'
import { endedHtml, noChecksPanelHtml, noModelHtml, stepsHtml, workingHtml } from './views/states.js'

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
	openElements: new Set(),
	openFiles: new Set(),
	// The turns of the thread whose steps the reader opened.
	openSteps: new Set(),
	detailsOpen: false,
	coverageOpen: false,
	addedOpen: false,
	paceOpen: false,
	openNotes: new Set(),
	// The diagrams whose drawing does not fit the column, and those of them the reader asked to see anyway.
	tooWide: new Set(),
	drawingsShown: new Set(),
	// The topics the reader knows whose cards they asked to see anyway, and the last map button they pressed: its turn
	// and its signal.
	unfolded: new Set(),
	mapSaid: null,
	// Each change a reply is about, by changeKey, with the project's top level laid over by it: null while ken reads it.
	changeLooks: new Map(),
	// The walkthrough step the reader is on, by the turn of its reply.
	walkAt: new Map(),
	wide: wideQuery.matches,
})

const state = {
	project: '',
	model: null,
	rows: [],
	// The thread on screen, oldest question first: saved ones from the history, and the one running now. open is the
	// question in it whose checks the panel shows.
	thread: [],
	open: null,
	running: null,
	menuOpen: false,
	lensesOpen: false,
	problem: null,
	// "home" shows the project as a picture and "question" a thread. "map" shows the reader's understanding map,
	// "decisions" the record's decisions, "follow-up" what is open, and "live" the notes of live mode. base is the one
	// of home and question the reader was on last, which the other views close back to.
	view: 'home',
	base: 'home',
	map: null,
	mapSaid: '',
	decisions: null,
	decisionsKey: false,
	ui: freshUi(),
	home: freshHome(stored, { ...freshUi(), wide: false }),
	// What is open, with its own open decisions and quotes, the line that says what the last button saved, and the
	// decisions the reader answered on this visit.
	followUp: null,
	followUi: freshUi(),
	followSaid: '',
	followDecided: [],
	// The authors of recent commits, and the person and span the reader picked in the lens "What changed".
	authors: [],
	pick: { author: '', since: '' },
	// Live mode as the server last told it, the quotes and decisions open in its notes, and the older notes unfolded.
	// liveSeen is when the newest note was that the reader saw on their last visit, and hideAsk keeps the last request
	// to the coding agent off the screen, for a screen someone else can see.
	live: null,
	liveStatus: 'off',
	liveProblem: null,
	liveUi: { ...freshUi(), wide: false },
	unfolded: new Set(),
	liveSeen: null,
	hideAsk: stored('ken-hide-ask') === 'yes',
}

// The page keeps a few small things in this browser: whether the reader hid their last request, the newest note they
// saw, and the way in and the detail they chose on the home. A browser that keeps nothing shows the page the same
// way, with nothing hidden, nothing marked new, and the way in ken suggests.
function stored(name) {
	try {
		return localStorage.getItem(name)
	} catch {
		return null
	}
}

function store(name, value) {
	try {
		localStorage.setItem(name, value)
	} catch {}
}

// The open decisions and quotes of the view on screen.
const uiNow = () => ({ 'follow-up': state.followUi, live: state.liveUi, home: state.home.ui })[state.view] ?? state.ui

// What the page shows as the question until ken sends the one it wrote for a lens.
const LENS_TITLES = {
	'catch-up': 'Catch me up: what differs from what I understood?',
	area: 'What do I need to know to work here today?',
	deeper: 'Go one level deeper',
	person: 'What did they change?',
	range: 'What happened?',
	topic: 'What changed since I understood it?',
	note: 'Go deeper on this note',
	parts: 'Name the main parts',
	tour: 'Show me around',
	change: 'Explain this change',
	view: 'Show it another way',
}

// A saved question as the page shows it: the history entry, and the project's HEAD now, to compare with the HEAD it
// was asked at.
function fromView(view) {
	const { entry, head, topics } = view
	return { reply: null, error: null, typing: '', ...entry, topics, headNow: head, live: false }
}

// The same fold as the server's entryFrom, for the question while it runs. The saved entry replaces it at the end. The
// model's text shows as it types; when its turn ends, ken files it as a step or as words of the reply.
function addEvent(q, event) {
	switch (event.kind) {
		case 'text':
			q.typing += event.delta
			break
		case 'tool':
			q.steps.push({ kind: 'tool', text: event.step })
			break
		case 'step':
			q.typing = ''
			q.steps.push(event.step)
			break
		case 'item':
			q.typing = ''
			q.reply ??= { items: [], change: null, topics: [] }
			q.reply.items.push(event.item)
			break
		// The saved reply's change has the checks too, so the live one waits beside it, for the change card alone.
		case 'change':
			q.reply ??= { items: [], change: null, topics: [] }
			q.liveChange = { base: event.base, head: event.head, commits: event.commits }
			break
		case 'waiting':
			q.steps.push({ kind: 'text', text: 'ken is finishing a note for Live. Your question starts when it ends.' })
			break
		case 'asked':
			q.question = event.question
			break
		case 'replied':
			q.reply = event.reply
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

// body is a question, {question}, or a lens for ken to write the question from, {lens}. A question opens its thread.
// onHome names a run the home started: the reader stays on the home, which shows the run and what it made.
async function send(body, onHome = null) {
	const question = body.lens ? LENS_TITLES[body.lens.kind] : body.question.trim()
	if (question === '' || state.running || state.model?.kind !== 'ok') return
	const { thread } = state.model
	const q = {
		id: null,
		question,
		askedAt: new Date().toISOString(),
		head: null,
		headNow: null,
		thread,
		outcome: 'working',
		steps: [],
		usage: null,
		reply: null,
		typing: '',
		topics: [],
		error: null,
		live: true,
	}
	const controller = new AbortController()
	state.running = { q, controller, started: Date.now(), onHome }
	let saved = null
	if (onHome === null) {
		// A question joins the chat ken talks in now, so the page shows that chat's thread with it at the end.
		if (state.thread[0]?.thread !== thread) {
			state.thread = await threadOf(thread)
			state.ui = freshUi()
		}
		state.thread = [...state.thread, q]
		state.open = picked = q
		state.menuOpen = false
		state.view = state.base = 'question'
		if (!body.lens) $('#question').value = ''
		resizeBox()
		// On a phone the keyboard would cover the answer as it arrives.
		if (!state.ui.wide) $('#question').blur()
	}
	render()
	if (onHome === null) $(`#turn-${state.thread.length - 1}`)?.scrollIntoView({ block: 'start' })
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
				// The topics keep the states they had when the reply came, so a button pressed since does not fold the reply
				// the reader is reading.
				saved = { ...fromView(event.view), topics: q.topics }
				state.thread = state.thread.map((each) => (each === q ? saved : each))
				if (state.open === q) state.open = saved
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
		q.typing = ''
		state.running = null
		await Promise.all([loadRows(), loadFollowUp()])
		// ken saves a stopped question a moment after the page lets go of it, so the list is read once more.
		if (controller.signal.aborted && state.rows.at(-1)?.question !== q.question) {
			await new Promise((resolve) => setTimeout(resolve, 500))
			await loadRows()
		}
		const last = state.rows.at(-1)
		// A stopped question has no saved line, so it is read back from the history.
		const stopped = controller.signal.aborted && last?.question === q.question
		if (onHome !== null) await home.ended(onHome, saved ?? (stopped ? { ...q, id: last.id } : q))
		else if (state.thread.includes(q) && stopped) await openQuestion(last.id)
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

// The saved questions of one thread, oldest first.
async function threadOf(thread) {
	const rows = state.rows.filter((row) => row.thread === thread)
	const views = await Promise.all(rows.map((row) => getJson(`/api/questions/${encodeURIComponent(row.id)}`)))
	return views.map(fromView)
}

// A question opens in its thread. One saved before ken kept threads stands alone.
async function openQuestion(id) {
	const q = fromView(await getJson(`/api/questions/${encodeURIComponent(id)}`))
	state.thread = q.thread ? await threadOf(q.thread) : [q]
	state.open = state.thread.find((each) => each.id === id) ?? q
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
		stopped: 'You stopped it',
		error: "ken's model did not reply",
		'no-answer': "ken's model gave no reply",
		'out-of-turns': "ken's model ran out of turns",
	}[row.outcome]
	if (ended) return `${when(row.askedAt)} · ${ended}`
	const parts = [row.cards === 0 ? 'a reply in words' : count(row.cards, 'checked card', 'checked cards')]
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

// A lens's question is a line the reader asked and the list ken wrote under it. A question on a live note saved before
// ken gave it a title line holds the whole prompt in its first line, "Go deeper on ken's live note about X at 06:40
// UTC. ...", so its title is rewritten the way ken writes one now.
function firstLine(question) {
	const first = question.split('\n')[0]
	const old = first.match(/^Go deeper on ken's live note about (.+?) at (\d\d:\d\d) UTC\./)
	return old ? `Go deeper on the ${old[2]} UTC note about ${old[1]}` : first
}

// The header: the views, the reader's questions in a menu, and the one button that opens the "Ask ken" drawer. The
// brand goes home. On a phone the views go into the menu too, beside the questions, and the menu button carries live
// mode's mark, so the project's name keeps its room.
function menuHtml() {
	const n = state.rows.length
	const current = (view) => (state.view === view ? ' aria-current="page"' : '')
	const waiting = openCount(state.followUp)
	const open =
		waiting === 0
			? ''
			: `<button class="link" data-act="follow-up" data-key="follow-up"${current('follow-up')}>Waiting on you (${waiting})</button>`
	const ask = `<button class="quiet-button ask-ken" data-act="ask-open" data-key="ask-open" aria-expanded="${state.view === 'home' && state.home.askOpen}">Ask ken</button>`
	const look = liveLook(state.liveStatus)
	const mark = look === 'off' ? '' : `<span class="live-mark is-${look}" aria-hidden="true"></span>`
	const said = { on: ', on', paused: ', paused', writing: ', writing a note', off: '' }[look]
	const live =
		state.model?.kind === 'ok'
			? `<button class="link" data-act="live" data-key="live"${current('live')} aria-label="Live${said}">${mark}Live</button>`
			: ''
	const views = `<button class="link" data-act="decisions" data-key="decisions"${current('decisions')}>Decisions</button><button class="link" data-act="map" data-key="map"${current('map')}>Your map</button>${live}${open}`
	const questions =
		n === 0
			? ''
			: `<button class="link top-wide" data-act="menu" data-key="menu" aria-expanded="${state.menuOpen}">Your questions (${n})</button>`
	const narrow = `<button class="link top-narrow" data-act="menu" data-key="menu-narrow" aria-expanded="${state.menuOpen}" aria-label="Menu${said ? `, live${said}` : ''}">${mark}Menu</button>`
	const bar = `<span class="top-views top-wide">${views}</span>${questions}${ask}${narrow}`
	if (!state.menuOpen) return bar
	const running = state.running
		? `<button class="row" data-act="open-running" data-key="menu-running"><span class="row-q">${esc(firstLine(state.running.q.question))}</span><span class="row-meta">Running now</span></button>`
		: ''
	const rows = [...state.rows].reverse().map((row) => rowHtml(row))
	const list =
		n === 0 && !running
			? ''
			: `<p class="menu-head">Your questions about this project, newest first. ken keeps them on this computer, outside the project.</p>${running}${rows.join('')}`
	return `${bar}<div class="menu"><div class="menu-views top-narrow">${views}</div>${list}</div>`
}

function runLine(q, t, ui) {
	const tools = q.steps.filter((step) => step.kind === 'tool').length
	const back = q.steps.filter((step) => step.kind === 'sent-back').length
	const open = ui.openSteps.has(t)
	const parts = []
	if (q.usage && q.steps.length > 0) parts.push(duration(q.usage.seconds))
	if (back > 0) parts.push(`ken sent back ${count(back, 'card', 'cards')}`)

	if (q.steps.length > 0) {
		parts.push(
			`<button class="link" data-act="steps" data-turn="${t}" data-key="steps-${t}" aria-expanded="${open}">${open ? 'Hide the steps' : `Show the ${count(tools, 'step', 'steps')}`}</button>`,
		)
	}
	const tokens = q.usage
		? `<p class="small muted">${count(q.usage.inputTokens, 'token', 'tokens')} in, ${q.usage.outputTokens.toLocaleString('en-US')} out.</p>`
		: ''
	// The dot goes with the part after it, so a wrapped line never ends on one.
	const line = parts.map((part, i) => (i === 0 ? part : `<span class="nowrap">· ${part}</span>`)).join(' ')
	return `<p class="run-line">${line}</p>${open ? stepsHtml(q.steps) + tokens : ''}`
}

function turnHtml(q, t, ui) {
	const seconds = () => (Date.now() - state.running.started) / 1000
	const working = q.live ? workingHtml(q, t, ui.openSteps.has(t), seconds()) : ''
	let body
	if (q.reply) {
		const reply = replyHtml(q, t, ui, { running: state.running !== null, inThread: true })
		body = `${q.live ? '' : runLine(q, t, ui)}${reply}${working}`
	} else if (q.live) body = working
	else body = runLine(q, t, ui) + endedHtml(q, t)
	return `<article class="turn" id="turn-${t}">
		<p class="asked">You asked ${when(q.askedAt)}<span class="described-note">What ken checked for this reply is on the right.</span></p>
		${questionHtml(q.question, ui)}
		${movedHtml(q, t)}
		${body}
	</article>`
}

// A lens's question is its first line and the list ken wrote under it, each item a line that starts with "- ". Any
// other line is for the agent alone, such as where ken keeps a snapshot. The list folds to one line.
function questionHtml(question, ui) {
	const [, ...listed] = question.split('\n')
	const first = firstLine(question)
	const items = listed.filter((line) => line.startsWith('- ')).map((line) => `<li>${prose(line.slice(2))}</li>`)
	const fold =
		items.length === 0
			? ''
			: `<p class="asked-fold"><button class="link small" data-act="added" data-key="added" aria-expanded="${ui.addedOpen}">${ui.addedOpen ? 'Hide what ken added' : `What ken added to your question, from git (${count(items.length, 'line', 'lines')})`}</button></p>${ui.addedOpen ? `<ul class="asked-list">${items.join('')}</ul>` : ''}`
	return `<h2 class="question">${prose(first)}</h2>${fold}`
}

// One notice for a reply older than HEAD. When a topic it names changed since the reader understood it, the notice
// says which lines, and the reply is out of date.
function movedHtml(q, t) {
	if (!isMoved(q)) return ''
	const again =
		state.model?.kind === 'ok' && !state.running
			? ` <button class="link" data-act="again" data-turn="${t}" data-key="moved-again-${t}">Ask again</button>`
			: ''
	const changed = q.reply ? changedTopics(q) : []
	const lines = changed.map(changedLine)
	const head = changed.length > 0 ? '<strong>Out of date.</strong> ' : '<strong>May be out of date.</strong> '
	return `<p class="moved${changed.length > 0 ? ' stale' : ''}">${head}Asked when the project was at <code>${short(q.head)}</code>. It is at <code>${short(q.headNow)}</code> now, so the code may have changed since. ${lines.join(' ')}${again}</p>`
}

function threadHtml() {
	if (state.view === 'map') return mapViewHtml(state.map, state.model?.kind === 'ok' && !state.running, state.mapSaid)
	if (state.view === 'decisions') return decisionsViewHtml(state.decisions, state.decisionsKey)
	if (state.view === 'live') {
		const canAsk = state.model?.kind === 'ok' && !state.running
		const seen = { seen: state.liveSeen, hideAsk: state.hideAsk }
		return liveViewHtml(state.live, state.liveUi, state.unfolded, canAsk, state.liveProblem, seen)
	}
	if (state.view === 'follow-up') {
		const canAsk = state.model?.kind === 'ok' && !state.running
		return openViewHtml(state.followUp, state.followUi, canAsk, state.followSaid, state.followDecided)
	}
	const q = state.open
	if (state.problem && !q)
		return `<div class="notice" role="alert"><h3>ken did not answer</h3><p>${esc(state.problem)}</p></div>`
	if (!q) return ''
	const back = '<button class="link" data-act="home" data-key="back-home">Back to the project</button>'
	return `<p class="back-home">${back}</p><p class="legend">${LEGEND}</p>${state.thread.map((each, t) => turnHtml(each, t, state.ui)).join('')}`
}

function panelHtml() {
	const q = state.open
	const ui = state.ui
	if (!q || !ui.wide || state.view !== 'question') return ''
	const items = itemsOf(state.thread)
	if (ui.panel.kind === 'quote') return quoteCardHtml(ui, items)
	if (ui.panel.kind === 'all') return allQuotesHtml(items)
	if (ui.panel.kind === 'walk') return walkPanelHtml(ui.panel.t, ui.walkAt.get(ui.panel.t))
	if (!q.reply || cardsOf(q, 0).length === 0) return noChecksPanelHtml(q.live)
	return checksHtml(q, ui, state.thread.at(-1) === q ? null : when(q.askedAt))
}

// Why no run of ken's model can start now, or null when one can.
function whyNoRun() {
	if (state.model?.kind !== 'ok') return 'ken has no model to ask.'
	return state.running ? "ken's model is busy with another run. Stop it, or wait for it." : null
}

function renderHome() {
	const env = {
		off: whyNoRun(),
		running: state.running,
		seconds: state.running ? (Date.now() - state.running.started) / 1000 : 0,
		model: state.model,
		rows: state.rows,
		asked: state.rows.length > 0,
	}
	showHome($('#home'), state.home, env, schedule)
}

// What the reader typed stays where they typed it when the box they type in is drawn again.
function caretOf(box) {
	return box?.matches?.('input:not([type]), textarea') ? [box.selectionStart, box.selectionEnd] : null
}

function render() {
	hideTip()
	const ui = state.ui
	ui.wide = wideQuery.matches
	const active = document.activeElement
	const focused = active?.dataset?.key
	const caret = caretOf(active)
	const refocus = () => {
		if (!focused || document.activeElement?.dataset?.key === focused) return
		const now = document.querySelector(`[data-key="${CSS.escape(focused)}"]`)
		now?.focus({ preventScroll: true })
		if (caret && caretOf(now)) now.setSelectionRange(...caret)
	}
	const onHome = state.view === 'home'
	$('#project').innerHTML = state.project ? `<span class="reads">reads </span>${folderHtml(state.project)}` : ''
	$('#menu').innerHTML = menuHtml()
	$('#home').hidden = !onHome
	$('#page').hidden = onHome
	if (onHome) {
		renderHome()
		return refocus()
	}
	const q = state.open
	const page = $('#page')
	const panel = $('#panel')
	const scroll = panel.scrollTop
	page.classList.toggle('single', !q || state.view !== 'question')
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
	// A drawing that does not fit gives its place to its numbered list, so no part is cut off at the edge.
	const tooWide = fillDrawings($('#thread'), schedule).filter((index) => !ui.tooWide.has(index))
	for (const index of tooWide) ui.tooWide.add(index)
	if (tooWide.length > 0) schedule()
	for (const [i, box] of document.querySelectorAll('.drawing').entries()) box.scrollLeft = across[i] ?? 0
	drawPictures($('#thread'))
	if (state.view === 'question') loadChangeLooks()
	const part = ui.wide && ui.panel.kind === 'quote' && ui.panel.key.match(/^g([\w-]+)n(\d+)$/)
	if (part) markPart($('#thread'), part[1], part[2])
	const canAsk = state.model?.kind === 'ok'
	$('#ask').hidden = !canAsk || state.view !== 'question'
	$('#send').disabled = state.running !== null
	// The area box is drawn again with the rest, so what the reader typed in it is carried over.
	const typed = [...document.querySelectorAll('.area-form input')].find((input) => input.value !== '')?.value ?? ''
	const pick = {
		...state.pick,
		authors: state.authors,
		asked: state.rows.length > 0,
		running: state.running !== null,
		changed: (state.followUp?.topics.length ?? 0) > 0,
	}
	// Under an answer the lenses fold behind one line, so the end of an answer is not a wall of forms.
	const tucked = `<div class="lens-fold"><button class="link" data-act="lenses" data-key="lenses" aria-expanded="${state.lensesOpen}">Or let ken write the question</button>${state.lensesOpen ? lensHtml('ask', pick) : ''}</div>`
	$('#after').innerHTML =
		state.model?.kind === 'unset'
			? noModelHtml(state.model, state.rows.length > 0, q !== null)
			: state.view === 'question' && q
				? tucked
				: ''
	for (const input of document.querySelectorAll('.area-form input')) input.value = typed
	$('#question').placeholder = ui.wide ? 'Ask what changed, why, or how a part works.' : 'Ask what changed, and why.'
	panel.innerHTML = panelHtml()
	panel.scrollTop = scroll
	watchTurns()
	refocus()
}

// On a wide screen the panel follows the reader down the thread: it shows the checks of the reply most in view. A reply
// the reader picked, by asking it, opening it from the menu or opening one of its quotes, keeps the panel while any of
// it is on screen, and an open quote keeps it until it closes. The turn the panel describes is marked.
let picked = null
let watcher = null
const turnsInView = new Set()

function watchTurns() {
	watcher?.disconnect()
	turnsInView.clear()
	markDescribed()
	if (!state.ui.wide || state.view !== 'question' || state.thread.length < 2) return
	const margin = `${-$('.top').offsetHeight}px 0px ${-$('#ask').offsetHeight}px 0px`
	const threshold = Array.from({ length: 101 }, (_, i) => i / 100)
	watcher = new IntersectionObserver(
		(entries) => {
			for (const { target, isIntersecting } of entries) {
				if (isIntersecting) turnsInView.add(target)
				else turnsInView.delete(target)
			}
			follow()
		},
		{ rootMargin: margin, threshold },
	)
	for (const turn of document.querySelectorAll('#thread .turn')) watcher.observe(turn)
}

function follow() {
	if (state.ui.panel.kind !== 'checks') return
	const top = $('.top').offsetHeight
	const bottom = innerHeight - $('#ask').offsetHeight
	const seen = (turn) => {
		const box = turn.getBoundingClientRect()
		return Math.min(box.bottom, bottom) - Math.max(box.top, top)
	}
	const turns = [...turnsInView]
	if (turns.some((turn) => state.thread[turnIndex(turn)] === picked)) return
	picked = null
	const most = turns.reduce((best, turn) => (best && seen(best) >= seen(turn) ? best : turn), null)
	const q = most && state.thread[turnIndex(most)]
	if (!q || q === state.open) return
	state.open = q
	$('#panel').innerHTML = panelHtml()
	$('#panel').scrollTop = 0
	markDescribed()
}

const turnIndex = (turn) => Number(turn.id.slice('turn-'.length))

function markDescribed() {
	const marked = state.ui.wide && state.view === 'question' && state.thread.length > 1
	for (const turn of document.querySelectorAll('#thread .turn')) {
		turn.classList.toggle('described', marked && state.thread[turnIndex(turn)] === state.open)
	}
}

function tick() {
	const clock = $('#working-clock')
	const shown = state.view === 'home' ? state.running?.onHome : state.open === state.running?.q
	if (!clock || !state.running || !shown) return
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

// A box or an arrow in a drawing does what the first quote row of its numbered row does.
function chooseInDrawing(target) {
	const number = numberAt(target)
	if (number === null) return
	const id = target.closest('.drawing').dataset.diagram
	const key = elementKey(id, number)
	const element = itemsOf(state.thread).find((each) => each.key === key)?.item
	if (element?.quotes.length > 0) {
		if (state.ui.wide) return choose(key, 0)
		state.ui.openParts.add(id)
		state.ui.openQuotes.add(`${key}-q0`)
		render()
	}
	$(`#item-${key}`)?.scrollIntoView({ block: 'nearest' })
}

// The panel when the reader is on a step of a walkthrough: the step's own words, the changed lines it is about as a
// diff, and the cards that prove it.
function walkPanelHtml(t, number) {
	const q = state.thread[t]
	const steps = walkOf(q?.reply)
	const k = steps.findIndex((step) => step.number === number)
	const step = steps[k]
	if (!step) return ''
	const tour = Boolean(q.reply.tour)
	const sub = tour
		? `<h3 class="walk-panel-sub">The code</h3>
		<div class="walk-cards">${stepCardsHtml(q, t, step, state.ui)}</div>
		${knowPartHtml(q, t, step)}`
		: `<h3 class="walk-panel-sub">The changed lines</h3>
		${stepDiffHtml(step, q.reply.change)}
		<h3 class="walk-panel-sub">What proves it</h3>
		<div class="walk-cards">${stepCardsHtml(q, t, step, state.ui)}</div>`
	const title = tour ? `Stop ${k + 1} of ${steps.length}: ${esc(step.part ?? '')}` : `Step ${k + 1} of ${steps.length}`
	return `<div class="panel-head"><h2>${title}</h2>
			<div class="panel-nav">
				<button class="quiet-button" data-act="walk-by" data-by="-1" data-turn="${t}" data-key="walk-panel-prev"${k === 0 ? ' disabled' : ''}>Previous</button>
				<button class="quiet-button" data-act="walk-by" data-by="1" data-turn="${t}" data-key="walk-panel-next"${k === steps.length - 1 ? ' disabled' : ''}>Next</button>
				<button class="quiet-button" data-act="close" data-key="close">Close</button>
			</div></div>
		<p class="walk-panel-text">${prose(step.text)}</p>
		${sub}`
}

// The reader moves to a step, or off it with null. On a wide screen its changed lines open in the panel; on a narrow
// one, under the step.
function walkTo(t, number) {
	const ui = state.ui
	if (number === null) ui.walkAt.delete(t)
	else ui.walkAt.set(t, number)
	if (ui.panel.kind === 'walk' || number !== null) ui.panel = number === null ? CHECKS : { kind: 'walk', t }
	render()
	if (number !== null) {
		$('#panel').scrollTop = 0
		const head = document.querySelector(`[data-key="walk-${t}-${number}"]`)
		head?.focus({ preventScroll: true })
		// On a wide screen the picture and the step's line show together; on a narrow one the step opens under its line.
		if (ui.wide) $(`#turn-${t} .change-card .pv-picture`)?.scrollIntoView({ block: 'nearest' })
		head?.scrollIntoView({ block: ui.wide ? 'nearest' : 'start' })
		void learnStop(t, number, 'toured')
	}
}

function walkBy(t, by) {
	const q = state.thread[t]
	const steps = walkOf(q?.reply)
	const k = steps.findIndex((step) => step.number === state.ui.walkAt.get(t))
	if (k < 0 && q?.reply?.tour) return walkTo(t, tourStart(steps, q.topics))
	const next = steps[k < 0 ? 0 : k + by]
	if (next) walkTo(t, next.number)
}

// The turn whose walkthrough the arrow keys move: the one the focus is in, else the one in the panel.
function walkTurn() {
	const walk = document.activeElement?.closest?.('.walk, #panel')
	if (walk?.matches('.walk')) return Number(walk.dataset.turn)
	if (walk && state.ui.panel.kind === 'walk') return state.ui.panel.t
	return null
}

function closePanel() {
	const shown = state.ui.panel
	if (shown.kind === 'checks') return false
	state.ui.panel = CHECKS
	if (shown.kind === 'walk') {
		const number = state.ui.walkAt.get(shown.t)
		state.ui.walkAt.delete(shown.t)
		render()
		document.querySelector(`[data-key="walk-${shown.t}-${number}"]`)?.focus({ preventScroll: true })
		return true
	}
	render()
	const back = shown.kind === 'quote' ? `${shown.key}-q${shown.quote}` : 'all-quotes'
	document.querySelector(`[data-key="${back}"]`)?.focus({ preventScroll: true })
	return true
}

function toggle(set, key) {
	if (set.has(key)) set.delete(key)
	else set.add(key)
}

async function postMap(signal, turn) {
	const response = await fetch('/api/map', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ signal, topics: state.thread[turn].reply.topics }),
	})
	if (!response.ok) throw new Error((await response.json()).message)
	state.ui.mapSaid = { turn, signal }
	await loadFollowUp()
	render()
}

// A button on the map's own page: it appends a line, then the map is read again and a line says what was saved.
async function mapTopic(signal, topic, said) {
	try {
		await post('/api/map', { signal, topics: [topic] })
		state.map = await getJson('/api/map')
		state.mapSaid = said
	} catch (error) {
		state.mapSaid = error.message
	}
	await loadFollowUp()
	render()
}

async function showMap() {
	state.view = 'map'
	state.menuOpen = false
	state.mapSaid = ''
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
	state.view = state.base
	render()
	$('[data-key="map"]')?.focus({ preventScroll: true })
}

// at is the id of a decision to scroll to, such as the one the reader just answered.
async function showDecisions(at) {
	state.view = 'decisions'
	state.menuOpen = false
	state.decisions = null
	render()
	try {
		state.decisions = (await getJson('/api/decisions')).decisions
	} catch (error) {
		state.problem = error.message
		state.decisions = []
	}
	render()
	const row = at && document.getElementById(`dv-${at}`)
	if (row) {
		row.scrollIntoView({ block: 'center' })
		row.focus({ preventScroll: true })
	} else window.scrollTo({ top: 0 })
}

function closeDecisions() {
	state.view = state.base
	render()
	$('[data-key="decisions"]')?.focus({ preventScroll: true })
}

// A reply about a change shows the project's top level with the change laid over it. ken reads it from git once per
// change while the page is open.
function loadChangeLooks() {
	const looks = state.ui.changeLooks
	for (const q of state.thread) {
		const change = q.reply?.change ?? q.liveChange
		const tour = q.reply?.tour
		const key = change ? changeKey(change) : tour ? tourKey(tour) : null
		if (key === null || looks.has(key)) continue
		looks.set(key, null)
		const query = new URLSearchParams(change ? { change: key } : tour.within.map((path) => ['within', path]))
		getJson(`/api/layout?${query}`)
			.then(({ look }) => looks.set(key, look))
			.catch((error) => looks.set(key, { problem: error.message }))
			.finally(render)
	}
}

// The reader reached a stop of a tour, or said they know its part: the map learns it, and the stop shows it.
async function learnStop(t, number, signal) {
	const q = state.thread[t]
	const step = walkOf(q?.reply).find((each) => each.number === number)
	if (!step || !q.reply.tour || (signal === 'toured' && stopState(step, q.topics) !== 'new')) return
	try {
		const { states } = await post('/api/map', { signal, topics: stopTopics(step) })
		q.topics = (q.topics ?? []).map((each) => states.find((state) => state.topic === each.topic) ?? each)
	} catch (error) {
		state.problem = error.message
	}
	await loadFollowUp()
	render()
	// "I know this part" goes once the map says so, so the focus moves to the stop it was on.
	if (signal === 'know') document.querySelector(`[data-key="walk-${t}-${number}"]`)?.focus({ preventScroll: true })
}

// A part on a change card opens the home at that part, with the same change laid over it.
function openChangePart(t, index) {
	const q = state.thread[t]
	const change = q?.reply?.change ?? q?.liveChange
	const box = change && state.ui.changeLooks.get(changeKey(change))?.boxes?.[index]
	if (box) return home.openAt(box, changeKey(change))
}

// The Live view reads the server every few seconds, and the header's mark follows whether live mode is on.
async function loadLive() {
	try {
		const live = await getJson('/api/live')
		const changed = JSON.stringify(live) !== JSON.stringify(state.live)
		state.live = live
		state.liveStatus = live.status
		state.liveProblem = null
		return changed
	} catch (error) {
		state.liveProblem = error.message
		return true
	}
}

async function liveAction(action) {
	try {
		const response = await fetch('/api/live', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action }),
		})
		const body = await response.json()
		if (!response.ok) throw new Error(body.message)
		state.live = body
		state.liveStatus = body.status
		state.liveProblem = null
	} catch (error) {
		state.liveProblem = error.message
	}
	render()
}

async function showLive() {
	state.view = 'live'
	state.menuOpen = false
	render()
	await loadLive()
	state.liveSeen = stored('ken-live-seen')
	const newest = state.live?.notes[0]?.entry.askedAt
	if (newest) store('ken-live-seen', newest)
	render()
	window.scrollTo({ top: 0 })
}

function closeLive() {
	state.view = state.base
	render()
	$('[data-key="live"]')?.focus({ preventScroll: true })
}

async function showFollowUp() {
	state.view = 'follow-up'
	state.menuOpen = false
	state.followSaid = ''
	state.followDecided = []
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
	state.view = state.base
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

const home = homeActions({ state, render, getJson, post, send, stored, store, fromView })

const actions = {
	...home.actions,
	map: () => (state.view === 'map' ? closeMap() : showMap()),
	decisions: () => (state.view === 'decisions' ? closeDecisions() : showDecisions()),
	'cc-open': (el) => openChangePart(Number(el.dataset.turn), Number(el.dataset.index)),
	'dv-key'() {
		state.decisionsKey = !state.decisionsKey
		render()
	},
	'decision-show': (el) => showDecisions(el.dataset.id),
	live: () => (state.view === 'live' ? closeLive() : showLive()),
	'live-on': () => liveAction('on'),
	'live-off': () => liveAction('off'),
	'live-pause': () => liveAction('pause'),
	'live-resume': () => liveAction('resume'),
	'live-note-now': () => liveAction('note-now'),
	pace() {
		state.liveUi.paceOpen = !state.liveUi.paceOpen
		render()
	},
	'note-unfold'(el) {
		toggle(state.unfolded, el.dataset.id)
		render()
	},
	'note-question': (el) => send({ lens: { kind: 'note', id: el.dataset.id } }),
	'note-more'(el) {
		toggle(state.liveUi.openNotes, el.dataset.id)
		render()
	},
	'ask-hide'() {
		state.hideAsk = !state.hideAsk
		store('ken-hide-ask', state.hideAsk ? 'yes' : 'no')
		render()
	},
	'follow-up': () => (state.view === 'follow-up' ? closeFollowUp() : showFollowUp()),
	'explain-topic': (el) => send({ lens: { kind: 'topic', topic: el.dataset.topic } }),
	'know-topic': (el) =>
		followUpSaved(
			() => post('/api/map', { signal: 'know', topics: [el.dataset.topic] }),
			`Saved. Your map says you know ${el.dataset.topic}, as the code is now.`,
		),
	'map-topic-know': (el) =>
		mapTopic('know', el.dataset.topic, `Saved. Your map says you know ${el.dataset.topic}, as the code is now.`),
	'map-topic-forgot': (el) =>
		mapTopic('forgot', el.dataset.topic, `Saved. Your map says you do not know ${el.dataset.topic} any more.`),
	'map-know': (el) => postMap('know', Number(el.dataset.turn)),
	'map-too-much': (el) => postMap('too-much', Number(el.dataset.turn)),
	'map-deeper'(el) {
		const q = state.thread[Number(el.dataset.turn)]
		void send({ lens: { kind: 'deeper', topics: q.reply.topics, question: firstLine(q.question) } })
	},
	chip: (el) => send({ question: chipQuestion(el.dataset.chip, state.thread[Number(el.dataset.turn)].reply.change) }),
	unfold(el) {
		toggle(state.ui.unfolded, el.dataset.topic)
		render()
	},
	'catch-up': () => send({ lens: { kind: 'catch-up' } }),
	lenses() {
		state.lensesOpen = !state.lensesOpen
		render()
	},
	menu() {
		state.menuOpen = !state.menuOpen
		render()
	},
	async open(el) {
		state.menuOpen = false
		state.view = state.base = 'question'
		await openQuestion(el.dataset.id)
		picked = state.open
		render()
		const turn = `#turn-${state.thread.indexOf(state.open)}`
		$(turn)?.scrollIntoView({ block: 'start' })
		$(`${turn} .q-row, ${turn} button`)?.focus({ preventScroll: true })
	},
	async 'open-running'() {
		state.menuOpen = false
		state.view = state.base = 'question'
		const { q } = state.running
		if (!state.thread.includes(q)) state.thread = [...(await threadOf(q.thread)), q]
		state.open = picked = q
		state.ui = freshUi()
		render()
	},
	quote(el) {
		const key = el.dataset.item
		const quote = Number(el.dataset.quote)
		const owner = itemsOf(state.thread).find((each) => each.key === key)?.q
		if (owner && state.view === 'question') state.open = picked = owner
		// A card of a walkthrough step in the panel opens its quote in place, so the panel keeps the step.
		if (uiNow().wide && !el.closest('#panel')) return choose(key, quote)
		toggle(uiNow().openQuotes, `${key}-q${quote}`)
		render()
		// "Show all" goes away once the lines are open, so the quote's own row takes the focus.
		if (el.matches('.q-all')) document.querySelector(`[data-key="${key}-q${quote}"]`)?.focus({ preventScroll: true })
	},
	'all-quotes'() {
		const ui = state.ui
		if (ui.wide) {
			ui.panel = ui.panel.kind === 'all' ? CHECKS : { kind: 'all' }
			render()
			$('#panel').scrollTop = 0
			return
		}
		const items = itemsOf(state.thread)
		const keys = items.flatMap(({ key, item }) => item.quotes.map((_, j) => `${key}-q${j}`))
		const allOpen = keys.every((key) => ui.openQuotes.has(key))
		ui.openQuotes = allOpen ? new Set() : new Set(keys)
		if (!allOpen) {
			for (const { key, kind } of items) if (kind === 'decision') ui.openDecisions.add(key)
			for (const { key, kind } of items) if (kind === 'element') ui.openParts.add(key.match(/^g([\w-]+)n/)[1])
		}
		render()
	},
	decision(el) {
		toggle(uiNow().openDecisions, el.dataset.item)
		render()
	},
	parts(el) {
		toggle(uiNow().openParts, el.dataset.diagram)
		render()
	},
	drawing(el) {
		uiNow().drawingsShown.add(el.dataset.diagram)
		render()
	},
	element(el) {
		uiNow().openElements.add(el.dataset.item)
		render()
	},
	step(el) {
		const items = itemsOf(state.thread)
		const at = items.findIndex(({ key }) => key === state.ui.panel.key) + Number(el.dataset.by)
		if (items[at]) choose(items[at].key, 0)
	},
	close: closePanel,
	'walk-step'(el) {
		const t = Number(el.dataset.turn)
		const number = Number(el.dataset.step)
		walkTo(t, state.ui.walkAt.get(t) === number ? null : number)
	},
	'walk-by': (el) => walkBy(Number(el.dataset.turn), Number(el.dataset.by)),
	'tour-know': (el) => learnStop(Number(el.dataset.turn), Number(el.dataset.step), 'know'),
	added() {
		state.ui.addedOpen = !state.ui.addedOpen
		render()
	},
	steps(el) {
		if (state.view === 'home') state.home.stepsOpen = !state.home.stepsOpen
		else toggle(state.ui.openSteps, Number(el.dataset.turn))
		render()
	},
	details() {
		state.ui.detailsOpen = !state.ui.detailsOpen
		render()
	},
	coverage() {
		state.ui.coverageOpen = !state.ui.coverageOpen
		render()
		if (state.ui.coverageOpen) $('#coverage-list')?.scrollIntoView({ block: 'nearest' })
	},
	again: (el) => send({ question: state.thread[Number(el.dataset.turn)].question }),
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
	else if (state.thread.length > 0) chooseInDrawing(event.target)
})

// A file's diff is drawn when the reader opens it. The home keeps whether "Another commit" is open across renders.
document.addEventListener(
	'toggle',
	(event) => {
		if (event.target.matches?.('.home-other')) state.home.formOpen = event.target.open
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
	if (state.view === 'home' && !state.menuOpen && $('#tip').hidden && home.key(event)) return
	if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && state.view === 'question') {
		const t = walkTurn()
		if (t === null) return
		event.preventDefault()
		walkBy(t, event.key === 'ArrowLeft' ? -1 : 1)
		return
	}
	if (event.key !== 'Escape') return
	if (!$('#tip').hidden) return hideTip()
	const ui = state.ui
	if (state.menuOpen) {
		state.menuOpen = false
		render()
		$('[data-key="menu"]')?.focus()
		return
	}
	if (state.view === 'map') return closeMap()
	if (state.view === 'decisions') return closeDecisions()
	if (state.view === 'live') return closeLive()
	if (state.view === 'follow-up') return closeFollowUp()
	if (closePanel()) return
	if (state.ui.walkAt.size > 0) {
		const [t, number] = [...state.ui.walkAt].at(-1)
		walkTo(t, null)
		document.querySelector(`[data-key="walk-${t}-${number}"]`)?.focus({ preventScroll: true })
		return
	}
	if (
		ui.coverageOpen ||
		ui.openSteps.size > 0 ||
		ui.detailsOpen ||
		ui.openQuotes.size > 0 ||
		ui.openDecisions.size > 0
	) {
		ui.coverageOpen = ui.detailsOpen = false
		ui.openSteps = new Set()
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
	if (home.submit(event)) return
	const form = event.target.closest('.area-form, .change-form, .decide-form')
	if (!form) return
	event.preventDefault()
	if (form.matches('.decide-form')) {
		const body = { decision: form.dataset.id, note: form.elements.note.value, outcome: event.submitter?.value }
		void followUpSaved(async () => {
			const { decided } = await post('/api/decided', body)
			state.followDecided = [decided, ...state.followDecided]
		}, '')
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

document.addEventListener('input', (event) => home.input(event))

// The lens forms are drawn again with the rest, so the person and the span the reader picked are kept here.
document.addEventListener('change', (event) => {
	if (home.change(event)) return
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

// A mark on a card says what it means when the reader points at it, moves to it with the keyboard, or taps it. The one
// tooltip is fixed to the screen, so it never widens the page, and follows its mark on scroll. It goes above the
// card's line of marks, else beside the mark, else under the card's text: the first place inside the screen that leaves
// the card's text clear. With no such place it goes above, held inside the screen.
let tipFor = null
const GAP = 6
const EDGE = 8

function showTip(mark) {
	const tip = $('#tip')
	tipFor = mark
	tip.textContent = mark.dataset.tip
	tip.hidden = false
	const box = mark.getBoundingClientRect()
	const marks = (mark.closest('.card-marks') ?? mark).getBoundingClientRect()
	const text = mark.closest('.card')?.querySelector('.card-text')?.getBoundingClientRect()
	const [width, height] = [tip.offsetWidth, tip.offsetHeight]
	const clampLeft = (left) => Math.max(EDGE, Math.min(left, innerWidth - width - EDGE))
	const places = [
		{ left: clampLeft(box.left), top: marks.top - height - GAP },
		{ left: box.right + GAP, top: box.bottom - height },
		{ left: box.left - width - GAP, top: box.bottom - height },
		{ left: clampLeft(box.left), top: Math.max(box.bottom, text?.bottom ?? 0) + GAP },
	]
	const fits = ({ left, top }) =>
		left >= EDGE && top >= EDGE && left + width <= innerWidth - EDGE && top + height <= innerHeight - EDGE
	const clear = ({ left, top }) =>
		!text || left + width <= text.left || left >= text.right || top + height <= text.top || top >= text.bottom
	const place = places.find((each) => fits(each) && clear(each)) ?? places[0]
	tip.style.left = `${place.left}px`
	tip.style.top = `${Math.max(EDGE, Math.min(place.top, innerHeight - height - EDGE))}px`
}

function hideTip() {
	tipFor = null
	$('#tip').hidden = true
}

for (const kind of ['mouseover', 'focusin']) {
	document.addEventListener(kind, (event) => {
		const mark = event.target.closest?.('[data-tip]')
		if (mark) showTip(mark)
		else hideTip()
	})
}
document.addEventListener('focusout', hideTip)
document.addEventListener('scroll', () => tipFor?.isConnected && showTip(tipFor), true)

// Pointing at a quote lights the part its file sits in, on the change or tour card of its reply. Anything else puts
// back the parts the card keeps lit, which beside a walkthrough are the parts of the step the reader is on.
let quoteLit = null
function lightQuote(event) {
	if (quoteLit) atRest(quoteLit)
	quoteLit = null
	const quote = event.target.closest?.('.q[data-path]')
	if (!quote) return
	const inPanel = quote.closest('#panel') && state.ui.panel.kind === 'walk'
	const turn = inPanel ? $(`#turn-${state.ui.panel.t}`) : quote.closest('.turn')
	const picture = turn?.querySelector('.change-card .pv-picture')
	if (!picture) return
	const q = state.thread[Number(turn.id.slice('turn-'.length))]
	const change = q?.reply?.change ?? q?.liveChange
	const tour = q?.reply?.tour
	const key = change ? changeKey(change) : tour ? tourKey(tour) : null
	const part = partOf(quote.dataset.path, state.ui.changeLooks.get(key)?.boxes ?? [])
	if (part < 0) return
	lightPicture(picture, new Set([part]))
	quoteLit = picture
}
document.addEventListener('pointerover', lightQuote)
document.addEventListener('focusin', lightQuote)

$('#question').addEventListener('input', resizeBox)
new ResizeObserver(([entry]) => {
	document.documentElement.style.setProperty('--composer', `${entry.target.offsetHeight}px`)
}).observe($('#ask'))
wideQuery.addEventListener('change', render)
window.addEventListener('resize', () => drawPictures(document.body))
// The canvas changes width with no change of the window when its scroll bar comes or goes.
new ResizeObserver(() => drawPictures($('#home-canvas'))).observe($('#home-canvas'))
darkQuery.addEventListener('change', render)
setInterval(tick, 1000)
setInterval(async () => {
	if (state.view !== 'live' && state.liveStatus === 'off') return
	if (await loadLive()) render()
}, 3000)

try {
	const [server, recent] = await Promise.all([
		getJson('/api/state'),
		getJson('/api/authors'),
		loadRows(),
		loadFollowUp(),
	])
	state.project = server.project
	learnParts(server.parts)
	state.model = server.model
	if (server.live === true) await loadLive()
	state.authors = recent.authors
	render()
	await home.start()
} catch (error) {
	state.home.problem = {
		message: `ken did not answer at this address (${error.message}). Start it again with ken open.`,
		field: null,
	}
}
render()
