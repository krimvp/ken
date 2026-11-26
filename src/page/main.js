// ken's page: one state object and one render per frame, with no framework. A rail leads to a page for each job
// (src/page/shell), and a concept pressed on any page opens its brief in a drawer (src/page/brief). A question opens
// as a thread over the pages: the words on the left, and on the right the panel with what ken checked. Under 1100
// pixels the panel goes away and the same things open in place. The page talks only to the server that sent it.

import { VIEWS_RUN } from './arch-views/switch.js'
import { archActions, freshArch } from './architecture/arch-actions.js'
import { askActions, freshAsk } from './ask/ask-actions.js'
import { openingRows, threadGaps, threadId } from './ask/thread-window.js'
import { briefActions, freshBrief } from './brief/brief-actions.js'
import { briefStore } from './brief/briefs.js'
import { partId } from './brief/concept-id.js'
import { changeActions, freshChanges } from './changes/change-actions.js'
import { fillDrawings, markPart, numberAt } from './draw-diagrams.js'
import { freshJobs, jobsActions, live } from './jobs/jobs.js'
import { readReply, replyAddress } from './level/address.js'
import { levelActions } from './level/level-actions.js'
import { freshHome } from './level/level-state.js'
import { DOING as LEVEL_RUNS } from './level/runs.js'
import { liveLook, liveViewHtml } from './live/live-view.js'
import { freshProcesses, processActions } from './processes/process-actions.js'
import { changeKey } from './project/change-card.js'
import { learnParts } from './project/part-colours.js'
import { atRest, drawPictures, lightPicture } from './project/parts-picture.js'
import { tourKey } from './project/tour-card.js'
import { partOf, stepDiffHtml, stopState, stopTopics, tourStart, walkOf } from './project/walk.js'
import { fitWords } from './shell/fit-words.js'
import { icon } from './shell/icons.js'
import { writePlace } from './shell/place.js'
import { readerPrefs } from './shell/prefs.js'
import { PAGE_NAMES } from './shell/shell.js'
import { freshShell, shellActions } from './shell/shell-actions.js'
import { checksHtml, quoteCardHtml } from './views/checks.js'
import { decisionsViewHtml } from './views/decisions.js'
import { elementKey } from './views/diagram.js'
import { count, duration, esc, focusLabel, prose, short, when } from './views/format.js'
import { changedLine, changedTopics, lensHtml } from './views/map.js'
import { changedParts, openCount, openViewHtml } from './views/open.js'
import { cardsOf, isMoved, itemsOf, knowPartHtml, LEGEND, replyHtml, stepCardsHtml } from './views/reply.js'
import { endedHtml, noChecksPanelHtml, noModelHtml, stepsHtml, workingHtml } from './views/states.js'
import { freshYou, youActions } from './you/you-actions.js'

const $ = (selector) => document.querySelector(selector)
const wideQuery = matchMedia('(min-width: 1100px)')

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
	// The turns whose whole text the reader opened, when their setting shows the start of each answer.
	wordsOpen: new Set(),
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
	// The frame, the canvas of the Architecture page and the brief's drawer: see their modules.
	shell: null,
	arch: freshArch(),
	brief: freshBrief(),
	procs: freshProcesses(),
	you: freshYou(),
	jobs: freshJobs(),
	chg: freshChanges(),
	project: null,
	model: null,
	rows: [],
	// The thread on screen, oldest question first: saved ones from the history, and the one running now. open is the
	// question in it whose checks the panel shows.
	thread: [],
	open: null,
	replyTo: undefined,
	running: null,
	lensesOpen: false,
	problem: null,
	// "home" shows the pages and "question" a thread over them. base is the one the reader was on last.
	view: 'home',
	base: 'home',
	map: null,
	decisions: null,
	decisionsKey: false,
	ui: freshUi(),
	home: freshHome(),
	ask: freshAsk(),
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
// What waits on the reader and live mode are tabs of the Changes page, each with its own open cards.
const uiNow = () =>
	state.view === 'home' && state.shell.page === 'changes'
		? ({ decisions: state.followUi, live: state.liveUi }[state.chg.tab] ?? state.ui)
		: state.ui

// What each run the page starts is doing, by its kind.
const DOING = { ...LEVEL_RUNS, views: VIEWS_RUN }

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
	view: 'Show it another way',
	explain: 'Explain it',
	answer: 'Answer a question about it',
	views: 'Draw where it runs and what it talks to',
}

// The same for the questions about one change, by what the reader wants of it.
const CHANGE_TITLES = {
	story: 'What did this change do, and why?',
	walk: 'Walk me through this change',
	decisions: 'What did this change decide, and why?',
	risks: 'What could go wrong with this change?',
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
		case 'focus':
			q.focus = event.focus
			break
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
			q.steps.push({ kind: 'text', text: 'ken is finishing another run. Your question starts when it ends.' })
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

// What the server answers, whether or not it is ok. It throws only when the server sends no answer at all, or none
// within READ_MS: a read that never ends would leave the page waiting for good.
const READ_MS = 30_000
async function read(url, signal) {
	const timeout = AbortSignal.timeout(READ_MS)
	const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
	return { ok: response.ok, body: await response.json(), status: response.status }
}

async function getJson(url, signal) {
	const { ok, body, status } = await read(url, signal)
	if (!ok) throw new Error(body.message ?? `${url} answered ${status}`)
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

// A run as the page shows it while it goes. question is what the page shows until the server sends the one it asks.
function runningQ(question, fields = {}) {
	return {
		id: null,
		question,
		askedAt: new Date().toISOString(),
		head: null,
		headNow: null,
		thread: null,
		outcome: 'working',
		steps: [],
		usage: null,
		reply: null,
		typing: '',
		topics: [],
		error: null,
		live: true,
		...fields,
	}
}

// body is a question, {question}, or a lens for ken to write the question from, {lens}. A question opens its thread.
// onHome is where a run the home started began: the reader stays on the home, which shows the run and what it made.
async function send(body, onHome = null) {
	const { lens } = body
	const question = !lens
		? body.question.trim()
		: lens.kind === 'change'
			? CHANGE_TITLES[lens.want]
			: LENS_TITLES[lens.kind]
	if (question === '' || state.running || state.model?.kind !== 'ok') return
	if (onHome === null) shell.leaveReply()
	const parent = body.after && state.rows.find((row) => row.id === body.after)
	const thread = body.after === null ? null : parent ? threadId(parent) : state.model.thread
	const q = runningQ(question, { focus: body.focus, after: body.after, thread })
	state.running = { q, started: Date.now(), onHome, key: null, stopping: false }
	await drive(q, onHome, async () => {
		if (onHome === null) {
			// Show the thread the reader chose, or an empty one for a new subject.
			if (body.after === null) {
				state.thread = []
				state.ui = freshUi()
			} else if ((state.thread[0]?.thread ?? state.thread[0]?.id) !== thread) {
				state.thread = await threadOf(thread, body.after)
				state.ui = freshUi()
			}
			state.thread = [...state.thread, q]
			state.open = picked = q
			state.replyTo = undefined
			state.ask.open = false
			state.view = state.base = 'question'
			if (!body.lens) $('#question').value = ''
			resizeBox()
			// On a phone the keyboard would cover the answer as it arrives.
			if (!state.ui.wide) $('#question').blur()
		}
		render()
		if (onHome === null) $(`#turn-${state.thread.length - 1}`)?.scrollIntoView({ block: 'start' })
		const response = await fetch('/api/questions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (response.ok) return response
		const refused = await response.json()
		// A lens ken refused, or one with nothing to explain, never reached the model.
		const unasked = body.lens && (response.status === 400 || response.status === 422)
		q.outcome = unasked ? 'unasked' : 'error'
		q.error = refused.message
		if (refused.question) q.question = refused.question
		return null
	})
}

// A page opened while the reader's own question still runs, after a reload or a closed tab, follows it. Questions in
// the reader's thread are the jobs whose key starts with "ask:". The thread opens on it unless the address names a reply.
async function followAsked(list) {
	const job = list.find((each) => each.by === 'reader' && each.key.startsWith('ask:') && live(each))
	if (!job || state.running || state.model?.kind !== 'ok') return
	const started = job.state.startedAt ?? Date.now()
	const q = runningQ(job.title, { askedAt: new Date(started).toISOString() })
	state.running = { q, started, onHome: null, key: job.key, stopping: false }
	if (!readReply(location.hash)) {
		state.thread = [q]
		state.open = picked = q
		state.ui = freshUi()
		state.view = state.base = 'question'
	}
	await drive(q, null, async () => {
		render()
		const response = await fetch(`/api/jobs/${encodeURIComponent(job.key)}`)
		if (response.ok) return response
		q.outcome = 'error'
		q.error = 'The question ended before the page could follow it. Its answer is under Earlier answers.'
		return null
	})
}

// Runs start, which shows the run and returns the stream of its lines, or null when the server said no, and reads the
// lines into q until the run ends.
async function drive(q, onHome, start) {
	let saved = null
	try {
		const response = await start()
		if (response) saved = await readRun(response, q)
		// Stop on a question that had not started yet ends it with no saved line.
		if (!saved && state.running.stopping) Object.assign(q, { outcome: 'stopped', error: null })
	} catch (error) {
		if (state.running.stopping) q.outcome = 'stopped'
		else {
			q.outcome = 'error'
			q.error = `ken stopped answering (${error.message}). Check that ken open is still running in the terminal.`
			if (!state.thread.includes(q) && onHome === null) state.problem = q.error
		}
	} finally {
		// The run stays the running one until its result is on screen, so no other run can start in between. A read
		// that fails here still lets go of the run.
		await runEnded(q, saved, onHome).catch((error) => {
			state.problem = error.message
		})
		state.running = null
		render()
	}
}

async function readRun(response, q) {
	let saved = null
	for await (const line of linesOf(response.body)) {
		const event = JSON.parse(line)
		if (event.kind === 'job') {
			state.running.key = event.key
			q.question = event.question
		} else if (event.kind === 'saved') {
			// The topics keep the states they had when the reply came, so a button pressed since does not fold the reply
			// the reader is reading.
			saved = { ...fromView(event.view), topics: q.topics }
			state.thread = state.thread.map((each) => (each === q ? saved : each))
			if (picked === q) picked = saved
			if (state.open === q) {
				state.open = saved
				if (state.view === 'question') {
					state.replyTo = saved.reply && !saved.about ? saved : null
					addressReply(saved.id)
				}
			}
		} else {
			addEvent(q, event)
		}
		schedule()
	}
	return saved
}

// What a run leaves once it is over: the lists read again, and the page or brief it started from told what it made.
async function runEnded(q, saved, onHome) {
	q.live = false
	q.typing = ''
	await Promise.all([loadRows(), loadFollowUp()])
	const made = saved ?? q
	await shell.reread()
	if (onHome?.kind === 'explain' || onHome?.kind === 'answer') await brief.ended(onHome, made)
	else if (onHome?.kind === 'draw') await procs.ended(made)
	else if (onHome?.kind === 'views') await arch.viewsEnded(made)
	else if (onHome !== null) await level.ended(onHome, made)
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

function rowsOfThread(thread) {
	return state.rows.filter((row) => threadId(row) === thread)
}

function readTurns(rows, signal) {
	return Promise.all(rows.map((row) => getJson(`/api/questions/${encodeURIComponent(row.id)}`, signal).then(fromView)))
}

function threadOf(thread, selected, signal) {
	return readTurns(openingRows(rowsOfThread(thread), selected), signal)
}

let replyRead = null
function cancelReply() {
	replyRead?.abort()
	replyRead = null
}

// A Back, Forward, or another selection can land while the chosen reply is still coming from disk.
async function openQuestion(id) {
	cancelReply()
	const reader = new AbortController()
	replyRead = reader
	const place = location.hash
	const row = state.rows.find((each) => each.id === id)
	try {
		const turns = row ? await threadOf(threadId(row), id, reader.signal) : await readTurns([{ id }], reader.signal)
		if (reader.signal.aborted || location.hash !== place) return false
		state.thread = turns
		state.open = turns.at(-1)
		state.ui = freshUi()
		return true
	} catch (error) {
		if (reader.signal.aborted) return false
		throw error
	} finally {
		if (replyRead === reader) replyRead = null
	}
}

let pageRead = null

function gapsOfThread() {
	const first = state.thread[0]
	return first ? threadGaps(rowsOfThread(threadId(first)), state.thread) : new Map()
}

async function readPage(el) {
	const shown = state.thread
	if (state.running || (pageRead?.shown === shown && !pageRead.error)) return
	const pos = Number(el.dataset.turn)
	const rows = gapsOfThread().get(pos)
	if (!rows?.length) return
	pageRead = { shown, pos, error: null }
	render()
	let read
	try {
		read = await readTurns(rows)
	} catch (error) {
		if (state.thread === shown) {
			pageRead = { shown, pos, error: error.message }
			render()
		}
		return
	}
	if (state.thread !== shown || state.view !== 'question' || state.running) {
		if (pageRead?.shown === shown) pageRead = null
		return
	}
	pageRead = null
	state.thread = [...shown.slice(0, pos), ...read, ...shown.slice(pos)]
	// A drawer or diagram key containing a turn number would name a different card after an insertion.
	if (pos < shown.length) state.ui = { ...freshUi(), changeLooks: state.ui.changeLooks }
	render()
	$(`#turn-${pos} .question`)?.focus()
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

// A lens's question is a line the reader asked and the list ken wrote under it. A question on a live note saved before
// ken gave it a title line holds the whole prompt in its first line, "Go deeper on ken's live note about X at 06:40
// UTC. ...", so its title is rewritten the way ken writes one now.
function firstLine(question) {
	const first = question.split('\n')[0]
	const old = first.match(/^Go deeper on ken's live note about (.+?) at (\d\d:\d\d) UTC\./)
	return old ? `Go deeper on the ${old[2]} UTC note about ${old[1]}` : first
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
			`<button class="link" data-act="steps" data-turn="${t}" data-key="steps-${t}" aria-expanded="${open}">${open ? 'Hide the actions' : `Show the ${count(tools, 'action', 'actions')}`}</button>`,
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
	const parent = q.after && state.thread[t - 1]?.id !== q.after && state.rows.find((row) => row.id === q.after)
	const seconds = () => (Date.now() - state.running.started) / 1000
	const working = q.live ? workingHtml(q, t, ui.openSteps.has(t), seconds()) : ''
	let body
	if (q.reply) {
		const reply = replyHtml(q, t, ui, { running: state.running !== null, inThread: true, text: state.shell.prefs.text })
		body = `${q.live ? '' : runLine(q, t, ui)}${q.outcome === 'partial' || q.outcome === 'unverified' ? endedHtml(q, t) : ''}${reply}${working}`
	} else if (q.live) body = working
	else body = runLine(q, t, ui) + endedHtml(q, t)
	return `<article class="turn" id="turn-${t}">
		<p class="asked">${q.background || q.about ? 'ken prepared this' : 'You asked'} ${when(q.askedAt)}<span class="described-note">What ken checked for this reply is on the right.</span></p>
		${parent ? `<p class="small muted">In reply to <a href="${esc(replyAddress(parent.id))}">${esc(firstLine(parent.question))}</a></p>` : ''}
		${questionHtml(q.question, ui, q.id)}
		${focusHtml(q)}
		${movedHtml(q, t)}
		${body}
	</article>`
}

function focusHtml(q) {
	if (!q.focus) return ''
	const part = q.focus.part
	const partLink = part
		? `<p><a href="${esc(writePlace({ page: 'home', brief: part.id }))}">Open ${esc(part.name)} in the project layout</a></p>`
		: ''
	const label = esc(focusLabel(q.focus))
	if (!('path' in q.focus)) return partLink || `<p class="muted">About ${label}</p>`
	const { path, commit, start } = q.focus
	const place = { page: 'home', brief: partId([path], path), on: 'source', source: { path, commit, line: start } }
	const find =
		q.outcome === 'tool-proposal' && /\.[cm]?[jt]sx?$/i.test(path)
			? writePlace({ ...place, source: { ...place.source, uses: `@${q.focus.end}` } })
			: null
	return `${partLink}<p class="muted"><a href="${esc(writePlace(place))}">Read ${label}</a></p>${find ? `<p><a href="${esc(find)}">Find uses in the source</a></p>` : ''}`
}

// A lens's question is its first line and the list ken wrote under it, each item a line that starts with "- ". Any
// other line is for the agent alone, such as where ken keeps a snapshot. The list folds to one line.
function questionHtml(question, ui, id) {
	const [, ...listed] = question.split('\n')
	const first = prose(firstLine(question))
	const heading = id && id !== state.replyTo?.id ? `<a href="${esc(replyAddress(id))}">${first}</a>` : first
	const items = listed.filter((line) => line.startsWith('- ')).map((line) => `<li>${prose(line.slice(2))}</li>`)
	const fold =
		items.length === 0
			? ''
			: `<p class="asked-fold"><button class="link small" data-act="added" data-key="added" aria-expanded="${ui.addedOpen}">${ui.addedOpen ? 'Hide what ken added' : `What ken added to your question, from git (${count(items.length, 'line', 'lines')})`}</button></p>${ui.addedOpen ? `<ul class="asked-list">${items.join('')}</ul>` : ''}`
	return `<h2 class="question" tabindex="-1" data-key="question-${esc(id ?? 'running')}">${heading}</h2>${fold}`
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
	const q = state.open
	if (state.problem && !q)
		return `<div class="notice" role="alert"><h3>ken did not answer</h3><p>${esc(state.problem)}</p></div>`
	if (!q) return ''
	const back = `<button class="k-back" data-act="back-page" data-key="back-home">${icon('left')}Back to ${PAGE_NAMES[state.shell.page]}</button>`
	const gaps = gapsOfThread()
	const page = (pos) => {
		const next = gaps.get(pos)
		if (!next) return ''
		const active = pageRead?.shown === state.thread && pageRead.pos === pos
		const label = pos === 0 ? 'Show earlier answers' : 'Show later answers'
		const busy = pageRead?.shown === state.thread && !pageRead.error
		const problem = active && pageRead.error ? `<span role="alert">${esc(pageRead.error)}</span>` : ''
		return `<p class="thread-page"><button class="link" data-act="read-page" data-turn="${pos}" data-key="read-page-${pos}" aria-controls="thread"${state.running || busy ? ' disabled' : ''}>${active && busy ? 'Reading answers...' : label}</button> ${problem}</p>`
	}
	const turns = state.thread.map((each, pos) => page(pos) + turnHtml(each, pos, state.ui)).join('')
	return `<p class="back-home">${back}</p><p class="legend">${LEGEND}</p>${turns}${page(state.thread.length)}`
}

function panelHtml() {
	const q = state.open
	const ui = state.ui
	if (!q || !ui.wide || state.view !== 'question') return ''
	const items = itemsOf(state.thread)
	if (ui.panel.kind === 'quote') return quoteCardHtml(ui, items)
	if (ui.panel.kind === 'walk') return walkPanelHtml(ui.panel.t, ui.walkAt.get(ui.panel.t))
	if (!q.reply || cardsOf(q, 0).length === 0) return noChecksPanelHtml(q.live)
	return checksHtml(q, ui, state.thread.at(-1) === q ? null : when(q.askedAt))
}

// Why no run of ken's model can start now, or null when one can. A run the home started is named for what it does.
function whyNoRun() {
	if (state.model?.kind !== 'ok') return 'ken has no model to ask.'
	if (!state.running) return null
	const kind = state.running.onHome?.kind
	return kind
		? `${DOING[kind][1]}. You can ask again when it ends.`
		: "ken's model is busy with another run. Stop it, or wait for it."
}

// What the lens forms show: the person and the span the reader picked, and what there is to pick from.
function lensPick() {
	return {
		...state.pick,
		authors: state.authors,
		asked: state.rows.length > 0,
		running: state.running !== null,
		changed: (state.followUp?.topics.length ?? 0) > 0,
	}
}

// What the page around a view is doing: whether a run of ken's model can start, the run under way, and what the
// "Ask ken" drawer needs.
function envNow() {
	return {
		off: whyNoRun(),
		running: state.running,
		seconds: state.running ? (Date.now() - state.running.started) / 1000 : 0,
		jobs: state.jobs.list,
		model: state.model,
		rows: state.rows,
		asked: state.rows.length > 0,
		lenses: { open: state.lensesOpen, pick: lensPick() },
	}
}

// What the reader typed stays where they typed it when the box they type in is drawn again.
function caretOf(box) {
	return box?.matches?.('input:not([type]), textarea') ? [box.selectionStart, box.selectionEnd] : null
}

// What a run of ken's model is doing, for a screen reader: what the run is for, and its newest action. The line is in
// index.html, outside everything render draws again, and is written only when it changes, so the clock is never read out.
function announce() {
	const status = $('#run-status')
	const run = state.running
	const doing = run?.onHome ? DOING[run.onHome.kind][1] : "ken's model is reading the project"
	const newest = run?.q.steps.findLast((step) => step.kind === 'tool')?.text.replaceAll('`', '') ?? ''
	const said = run ? `${doing}. ${newest}`.trim() : status.textContent === '' ? '' : 'The run ended.'
	if (status.textContent !== said) status.textContent = said
}

// The key of what had the keyboard when its region closed for a read, so it gets the keyboard back when it opens.
let focusLost = null

function render() {
	hideTip()
	announce()
	const ui = state.ui
	ui.wide = wideQuery.matches
	const active = document.activeElement
	if (active !== document.body) focusLost = null
	const focused = active?.dataset?.key ?? focusLost
	const pane = active?.closest('#brief, #ask-drawer, #settings')
	const caret = caretOf(active)
	// Only a focus the draw dropped is put back: one the draw moved on purpose, as into an opened brief, stays.
	const refocus = () => {
		const moved = document.activeElement !== active && document.activeElement !== document.body
		if (moved || (focused && document.activeElement?.dataset?.key === focused)) return
		const now = focused ? document.querySelector(`[data-key="${CSS.escape(focused)}"]`) : null
		now?.focus({ preventScroll: true })
		if (caret && caretOf(now)) now.setSelectionRange(...caret)
		// Starting a run can replace its button while the reader is still in the drawer.
		if (pane && !pane.hidden && !pane.inert && document.activeElement === document.body) {
			const heading = pane.querySelector('h2[tabindex="-1"]') ?? pane.querySelector('button:not(:disabled)')
			heading?.focus({ preventScroll: true })
		}
		focusLost = now?.closest('[inert]') ? focused : null
	}
	// The frame and the page under it come first. Only a view from before the pages is drawn by what follows.
	const env = envNow()
	const older = shell.draw(env)
	jobs.look()
	level.watch()
	fitWords()
	if (!older) {
		refocus()
		return tipFrom(null)
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
	const kept = keepTurnInPlace()
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
	kept()
	if (state.view === 'question') loadChangeLooks()
	const part = ui.wide && ui.panel.kind === 'quote' && ui.panel.key.match(/^g([\w-]+)n(\d+)$/)
	if (part) markPart($('#thread'), part[1], part[2])
	const canAsk = state.model?.kind === 'ok'
	$('#ask').hidden = !canAsk || state.view !== 'question'
	$('#send').disabled = state.running !== null
	const target = state.replyTo
	const label = $('#ask label')
	label.textContent = target ? `Follow up on "${firstLine(target.question)}"` : 'Your question'
	label.title = label.textContent
	$('#ask').classList.toggle('is-follow-up', Boolean(target))
	$('#new-subject').hidden = !target
	// The area box is drawn again with the rest, so what the reader typed in it is carried over.
	const typed = [...document.querySelectorAll('.area-form input')].find((input) => input.value !== '')?.value ?? ''
	const pick = lensPick()
	// Under an answer the lenses fold behind one line, so the end of an answer is not a wall of forms.
	const tucked = `<div class="lens-fold"><button class="link" data-act="lenses" data-key="lenses" aria-expanded="${state.lensesOpen}">${state.lensesOpen ? 'Hide question ideas' : 'Show question ideas'}</button>${state.lensesOpen ? lensHtml('ask', pick) : ''}</div>`
	$('#after').innerHTML =
		state.model?.kind === 'unset'
			? noModelHtml(state.model, state.rows.length > 0, q !== null)
			: state.view === 'question' && q
				? tucked
				: ''
	for (const input of document.querySelectorAll('.area-form input')) input.value = typed
	$('#question').placeholder = target
		? 'Ask a follow-up question'
		: ui.wide
			? 'Ask what changed, why, or how a part works.'
			: 'Ask what changed, and why.'
	panel.innerHTML = panelHtml()
	panel.scrollTop = scroll
	watchTurns()
	refocus()
	tipFrom(null)
}

// The thread is drawn anew on each render, which the browser's own scroll anchoring cannot follow. So the first turn
// that starts in the window, or else the one the window is inside, keeps its place when a picture or a card above it
// fills in after the reply opened.
let drawnThread = []
function keepTurnInPlace() {
	const top = $('.k-bar').offsetHeight
	const turns = [...document.querySelectorAll('#thread .turn')]
	const starts = turns.findIndex((turn) => turn.getBoundingClientRect().top >= top - 1)
	const inside = turns.findLastIndex((turn) => turn.getBoundingClientRect().top < top)
	const at = starts >= 0 && turns[starts].getBoundingClientRect().top < innerHeight ? starts : inside
	const q = drawnThread[at]
	const was = turns[at]?.getBoundingClientRect().top
	drawnThread = state.thread
	return () => {
		const now = q && document.getElementById(`turn-${state.thread.indexOf(q)}`)
		if (now) scrollBy(0, now.getBoundingClientRect().top - was)
	}
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
	const margin = `${-$('.k-bar').offsetHeight}px 0px ${-$('#ask').offsetHeight}px 0px`
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
	const top = $('.k-bar').offsetHeight
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
	for (const clock of document.querySelectorAll('.k-job-clock[data-since]')) {
		clock.textContent = `${duration((Date.now() - Number(clock.dataset.since)) / 1000)} so far`
	}
	const shown = state.view === 'home' ? state.running?.onHome : state.open === state.running?.q
	if (!state.running || !shown) return
	const tools = state.running.q.steps.filter((step) => step.kind === 'tool').length
	const said = `${duration((Date.now() - state.running.started) / 1000)} so far, ${count(tools, 'action', 'actions')}`
	for (const clock of document.querySelectorAll('#working-clock, .k-clock')) clock.textContent = said
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
	if (shown.kind === 'quote') {
		document.querySelector(`[data-key="${shown.key}-q${shown.quote}"]`)?.focus({ preventScroll: true })
	}
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
	if (box) return level.openAt(box, changeKey(change))
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

// The page as its modules see it. Each takes what it needs from here, and the modules made later are added to it.
const app = { state, render, read, post, send, stored, store, fromView, cancelReply }
app.prefs = readerPrefs(app)
state.shell = freshShell(app.prefs.prefs)
app.briefs = briefStore(app)
app.briefPaths = () => brief.readPaths()
app.reread = () => shell.reread()
app.rereadKnows = () => shell.rereadKnows()
const level = levelActions(app)
app.level = level
const ask = askActions(app)
app.ask = ask
const brief = briefActions(app)
app.brief = brief
const arch = archActions(app)
app.arch = arch
const procs = processActions(app)
app.procs = procs
const you = youActions(app)
app.you = you
const chg = changeActions(app)
app.chg = chg
// A run ken started by itself made something: the pages read what they show again, so it fills in with no reload.
const jobs = jobsActions({ ...app, linesOf, followAsked }, async (made) => {
	await Promise.all([loadRows(), shell.reread()])
	// The reader asked for nothing, so the level on screen stays while it is read again.
	await Promise.all([level.loads.loadLayout(true), made.some((job) => job.kind === 'process') ? procs.reread() : null])
	await level.loads.settle()
	render()
})

// The two tabs of the Changes page that show a view from before the pages: what waits on the reader with the
// record's decisions, and live mode.
app.older = {
	html(tab) {
		const canAsk = state.model?.kind === 'ok' && !state.running
		if (tab === 'live') {
			const seen = { seen: state.liveSeen, hideAsk: state.hideAsk }
			return liveViewHtml(state.live, state.liveUi, state.unfolded, canAsk, state.liveProblem, seen)
		}
		const parts = changedParts(state.shell.top?.look)
		const open = openViewHtml(state.followUp, state.followUi, canAsk, state.followSaid, state.followDecided, parts)
		return `${open}${decisionsViewHtml(state.decisions, state.decisionsKey)}`
	},
	async load(tab) {
		if (tab === 'live') {
			await loadLive()
			state.liveSeen = stored('ken-live-seen')
			const newest = state.live?.notes[0]?.entry.askedAt
			if (newest) store('ken-live-seen', newest)
			return
		}
		state.followSaid = ''
		await loadFollowUp()
		// Every decision shows open here: the reader came to decide.
		state.followUi = {
			...freshUi(),
			wide: false,
			openDecisions: new Set(state.followUp?.decisions.map((_, i) => `o${i}`)),
		}
		try {
			state.decisions = (await getJson('/api/decisions')).decisions
		} catch (error) {
			state.problem = error.message
			state.decisions = []
		}
	},
	waiting: () => openCount(state.followUp, changedParts(state.shell.top?.look)),
	live: () => liveLook(state.liveStatus),
}
const shell = shellActions(app)
app.shell = shell

function addressReply(id) {
	const address = replyAddress(id)
	if (location.hash !== address) history.pushState(null, '', address)
}

async function showReply(id) {
	if (!(await openQuestion(id))) return false
	state.replyTo = state.open?.reply && !state.open.about ? state.open : null
	state.ask.open = false
	state.view = state.base = 'question'
	picked = state.open
	if (!brief.close()) render()
	const turn = `#turn-${state.thread.indexOf(state.open)}`
	$(turn)?.scrollIntoView({ block: 'start' })
	$(`${turn} .question`)?.focus({ preventScroll: true })
	return true
}

const actions = {
	...level.actions,
	...ask.actions,
	...shell.actions,
	...arch.actions,
	...brief.actions,
	...procs.actions,
	...you.actions,
	...chg.actions,
	...jobs.actions,
	// What waits on the reader, the record's decisions and live mode are tabs of the Changes page now.
	'follow-up': () => shell.goTab('decisions'),
	'read-page': readPage,
	'new-subject'() {
		state.replyTo = null
		render()
		$('#question').focus()
	},
	'back-page'() {
		shell.leaveReply()
		state.view = state.base = 'home'
		render()
		$('[aria-current="page"]')?.focus()
	},
	'cc-open': (el) => openChangePart(Number(el.dataset.turn), Number(el.dataset.index)),
	'dv-key'() {
		state.decisionsKey = !state.decisionsKey
		render()
	},
	'decision-show': () => shell.goTab('decisions'),
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
	'explain-topic': (el) => send({ lens: { kind: 'topic', topic: el.dataset.topic } }),
	'know-topic': (el) =>
		followUpSaved(
			() => post('/api/map', { signal: 'know', topics: [el.dataset.topic] }),
			`Saved. Your map says you know ${el.dataset.topic}, as the code is now.`,
		),
	'map-know': (el) => postMap('know', Number(el.dataset.turn)),
	'map-too-much': (el) => postMap('too-much', Number(el.dataset.turn)),
	'map-deeper'(el) {
		const q = state.thread[Number(el.dataset.turn)]
		void send({
			lens: { kind: 'deeper', topics: q.reply.topics, question: firstLine(q.question) },
			...(q.id && { after: q.id }),
		})
	},
	// ken's server writes the question, so it names the change as every question about it does.
	chip(el) {
		const change = changeKey(state.thread[Number(el.dataset.turn)].reply.change)
		return send({ lens: { kind: 'change', change, want: el.dataset.chip } })
	},
	unfold(el) {
		toggle(state.ui.unfolded, el.dataset.topic)
		render()
	},
	'catch-up': () => send({ lens: { kind: 'catch-up' } }),
	lenses() {
		state.lensesOpen = !state.lensesOpen
		render()
	},
	// An opened reply is a new entry in the browser's history, so Back goes to where the reader was and a reload
	// opens the reply again.
	async open(el) {
		shell.leaveReply()
		if (await showReply(el.dataset.id)) addressReply(el.dataset.id)
	},
	async 'open-running'() {
		shell.leaveReply()
		state.ask.open = false
		state.view = state.base = 'question'
		const { q } = state.running
		if (!state.thread.includes(q)) state.thread = [...(await threadOf(q.thread, q.after)), q]
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
	'words-more'(el) {
		toggle(state.ui.wordsOpen, Number(el.dataset.turn))
		render()
	},
	steps(el) {
		toggle(state.ui.openSteps, Number(el.dataset.turn))
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
	again: (el) => {
		const q = state.thread[Number(el.dataset.turn)]
		return send(
			q.retry
				? { lens: q.retry }
				: { question: q.question, ...(q.after !== undefined ? { after: q.after } : { focus: q.focus }) },
		)
	},
	// The run goes on without the page, so Stop asks the server to end it. Its stream then ends with the stopped entry.
	async stop() {
		const run = state.running
		if (!run?.key || run.stopping) return
		run.stopping = true
		try {
			await post('/api/jobs', { stop: run.key })
		} catch (error) {
			run.stopping = false
			state.problem = error.message
			render()
		}
	},
}

document.addEventListener('click', (event) => {
	const el = event.target.closest('[data-act]')
	shell.pressed(event.target)
	if (el && !el.disabled) void actions[el.dataset.act](el)
	else if (state.view === 'question' && state.thread.length > 0) chooseInDrawing(event.target)
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
	if (shell.wrapTab(event)) return
	if ($('#tip').hidden && shell.key(event)) return
	if ($('#tip').hidden && ask.key(event)) return
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
	void send({ question: $('#question').value, after: state.replyTo?.id ?? state.replyTo })
})

document.addEventListener('submit', (event) => {
	if (brief.submit(event) || procs.submit(event) || chg.submit(event)) return
	if (ask.submit(event) || you.submit(event)) return
	if (level.submit(event)) {
		// A request sent from the canvas's tool closes the tool, so the canvas shows the run.
		if (event.target.id === 'redraw-form' && state.home.redraw.problem === null && state.arch.drawOpen) {
			state.arch.drawOpen = false
			render()
		}
		return
	}
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

document.addEventListener(
	'input',
	(event) => shell.input(event) || chg.input(event) || ask.input(event) || you.input(event) || level.input(event),
)
document.addEventListener('mousedown', (event) => level.press(event))
window.addEventListener('popstate', () => shell.back(showReply))

// The lens forms are drawn again with the rest, so the person and the span the reader picked are kept here.
document.addEventListener('change', (event) => {
	const form = event.target.closest('.change-form')
	if (!form) return
	state.pick = { author: form.elements.author.value, since: form.elements.since.value }
})

$('#question').addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		$('#ask').requestSubmit()
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

// The tip is for the mark pointed at, else for the one that has the keyboard: a page that scrolls under a still
// pointer, or is drawn again, must not take the tip from a reader who moved to a mark with the keyboard.
function tipFrom(target) {
	const mark = target?.closest?.('[data-tip]') ?? document.activeElement?.closest?.('[data-tip]')
	if (mark) showTip(mark)
	else hideTip()
}

for (const kind of ['mouseover', 'focusin']) document.addEventListener(kind, (event) => tipFrom(event.target))
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
window.addEventListener('resize', () => {
	drawPictures(document.body)
	fitWords()
})
document.fonts?.addEventListener('loadingdone', () => fitWords())
setInterval(tick, 1000)
setInterval(async () => {
	const onLive = state.view === 'live' || (state.shell.page === 'changes' && state.chg.tab === 'live')
	if (!onLive && state.liveStatus === 'off') return
	if (await loadLive()) render()
}, 3000)

try {
	// The saved questions come first, since a page finds its stored replies among them. The place the address names
	// is read while the rest comes, so the first page does not wait on the server's state.
	const reads = Promise.all([getJson('/api/state'), getJson('/api/authors'), loadFollowUp()])
	await loadRows()
	const started = shell.start(showReply)
	const [server, recent] = await reads
	state.project = { name: server.name, folder: server.project }
	state.home.project = server.name
	learnParts(server.parts)
	state.model = server.model
	// What ken reads by itself, on a first open the naming of the parts, which the server started.
	if (state.model.kind === 'ok') void jobs.feed()
	if (server.live === true) await loadLive()
	state.authors = recent.authors
	render()
	// An address that names a reply opens it over the pages. A reply ken no longer has leaves the Home page.
	await started
} catch (error) {
	state.home.problem = {
		message: `ken did not answer at this address (${error.message}). Run \`ken open\` again.`,
		field: null,
	}
}
render()
