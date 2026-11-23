// What the reader does with the frame: go to a page by the rail, find a concept with the search, change a setting,
// and follow what "Start here" leads with. This module also owns the address: every page and every open brief has
// one, so the browser's Back and a reload bring the reader to the same place. A reply opens over the pages.

import { partId, readConcept } from '../brief/concept-id.js'
import { jobsLineHtml } from '../jobs/jobs.js'
import { learnParts } from '../project/part-colours.js'
import { startPageHtml } from '../start/start.js'
import { fill } from './fill.js'
import { readPlace, writePlace } from './place.js'
import { barActsHtml, barTitle, findConcepts, foundHtml, railHtml, settingsHtml } from './shell.js'

const narrow = matchMedia('(max-width: 760px)')

// What the frame holds: the page, the top level of the project for the Home page, what search can find, what the
// reader typed in it, and their settings.
export const freshShell = (prefs) => ({
	page: 'home',
	// The top level as GET /api/layout sends it, with the changes it lists: null until read.
	top: null,
	// What plain code read of the project, as GET /api/first-look sends it: { kind: 'ok', look } or { kind: 'failed',
	// message }, and null until read.
	first: null,
	// Commits by day, when the server sends them.
	timeline: null,
	concepts: [],
	search: { text: '', at: 0, list: null, open: false },
	settingsOpen: false,
	prefs,
})

// app is the page: its state, render, read, the store of briefs, the reader's settings, and the actions of the
// brief, the canvas and the views from before the pages.
export function shellActions(app) {
	const { state, render, read } = app
	const shell = state.shell
	const $ = (selector) => document.querySelector(selector)
	narrow.addEventListener('change', render)
	let settingsOpener = null

	let modal = null
	function drawModal() {
		let top = null
		if (shell.settingsOpen) top = $('#settings')
		else if (narrow.matches && state.ask.open) top = $('#ask-drawer')
		else if (narrow.matches && state.brief.id) top = $('#brief')
		if (top === modal) return
		modal = top
		for (const region of document.querySelectorAll('#rail, .k-main, #brief, #ask-drawer, #settings')) {
			region.inert = Boolean(top && region !== top)
			if (region.id === 'brief' || region.id === 'ask-drawer') {
				if (region === top) region.setAttribute('role', 'dialog')
				else region.removeAttribute('role')
			}
			if (region === top) region.setAttribute('aria-modal', 'true')
			else region.removeAttribute('aria-modal')
		}
	}

	function wrapTab(event) {
		if (event.key !== 'Tab' || !modal) return false
		const stops = [
			...modal.querySelectorAll(
				'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]',
			),
		].filter((el) => el.tabIndex >= 0 && el.getClientRects().length)
		const first = stops[0]
		const last = stops.at(-1)
		const here = document.activeElement
		const edge = event.shiftKey ? first : last
		const toward = event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING
		if (edge && modal.contains(here) && here.compareDocumentPosition(edge) & toward) return false
		event.preventDefault()
		;(event.shiftKey ? last : first)?.focus()
		return true
	}

	// A reply lies over whichever page the reader is on.
	const overlaid = () => state.view !== 'home' && state.view !== 'map'

	const placeNow = () => ({
		page: shell.page,
		trail: state.home.trail,
		layer: state.arch.layer,
		process: state.arch.process,
		change: state.home.change,
		tab: state.chg.tab,
		part: shell.page === 'changes' && state.chg.tab === 'changes' ? state.chg.part : null,
		brief: state.brief.id,
		on: state.brief.on,
		source: state.brief.on === 'source' ? state.brief.source.where : null,
	})

	// The address follows the reader once the page has read where it starts. Another page, another level or another
	// brief is a new entry in the browser's history, so Back goes to the one before. Anything finer rewrites the
	// entry it is in. A reply open over the pages keeps its own address.
	let addressed = null
	let restoringReply = false
	function leaveReply() {
		restoringReply = false
		app.cancelReply()
	}
	const coarse = (place) =>
		JSON.stringify([place.page, place.trail, place.tab, place.part, place.brief, place.on, place.source])
	function address() {
		if (addressed === null || restoringReply || overlaid()) return
		const place = placeNow()
		const hash = writePlace(place)
		if (hash !== location.hash) history[coarse(place) === addressed ? 'replaceState' : 'pushState'](null, '', hash)
		addressed = coarse(place)
	}

	// The top level, for the Home page and for a part's colour on every page. An answer to an older read is dropped.
	let topAsked = 0
	async function loadTop() {
		const mine = ++topAsked
		const [top, timeline, first] = await Promise.all([
			read('/api/layout').catch(() => null),
			read('/api/timeline?days=90').catch(() => null),
			shell.first?.kind === 'ok' ? null : loadFirst(),
		])
		if (mine !== topAsked) return
		if (first) shell.first = first
		if (top?.ok) {
			shell.top = top.body
			learnParts(top.body.look.boxes)
			if (state.home.levels.length === 0 && top.body.levels) state.home.levels = top.body.levels
		} else if (top) state.home.problem ??= { message: top.body.message, field: null }
		shell.timeline = timeline?.ok ? timeline.body : null
		// Home draws with the top level; what search can find fills the Concepts tile when it comes.
		render()
		shell.concepts = (await app.briefs.concepts()) ?? []
	}

	// What plain code says of the project comes in well under a second, so Home shows it as soon as it is here, before
	// the top level.
	async function loadFirst() {
		const answer = await read('/api/first-look').catch((error) => ({ ok: false, body: { message: error.message } }))
		const first = answer.ok ? { kind: 'ok', look: answer.body } : { kind: 'failed', message: answer.body.message }
		if (!shell.top) {
			shell.first = first
			render()
		}
		return first
	}

	// What a page reads when the reader comes to it.
	async function enter(page) {
		if (page === 'home') return loadTop()
		if (page === 'architecture') return app.arch.enter()
		if (page === 'processes') return app.procs.enter()
		if (page === 'you') return app.you.enter()
		return app.chg.enter()
	}

	async function goPage(page) {
		leaveReply()
		state.chg.part = null
		Object.assign(shell, { page, settingsOpen: false })
		// What was typed in search was for the page the reader left.
		Object.assign(shell.search, { text: '', open: false, at: 0 })
		$('#search-text').value = ''
		state.menuOpen = false
		state.view = state.base = 'home'
		render()
		await enter(page)
		render()
	}

	// A place from the address becomes where the reader is. first says the page has just opened, so everything is
	// still to read.
	async function goPlace(place, first) {
		const { home, arch, brief } = state
		Object.assign(shell, { page: place.page, settingsOpen: false })
		Object.assign(arch, { layer: place.layer, process: place.process, drawOpen: false })
		state.chg.tab = place.tab
		state.chg.part = place.part ?? null
		state.view = state.base = 'home'
		Object.assign(home, { trail: place.trail, change: place.change, selected: null, shown: null, at: '' })
		if (place.brief !== brief.id) {
			if (place.brief) app.briefs.reopen(place.brief)
			const at = brief.trail.findIndex((step) => step.id === place.brief)
			const step = { id: place.brief, name: readConcept(place.brief ?? '')?.name ?? '' }
			Object.assign(brief, {
				id: place.brief,
				trail: place.brief === null ? [] : at >= 0 ? brief.trail.slice(0, at + 1) : [step],
				fixing: false,
				openQuotes: new Set(),
				inner: undefined,
			})
		}
		brief.on = place.on
		const revisiting =
			!first || ['reload', 'back_forward'].includes(performance.getEntriesByType('navigation')[0]?.type)
		if (revisiting) brief.told = brief.id
		if (place.source) {
			addressed = coarse(place)
			void app.brief.readSource(place.source.line, place.source, !revisiting)
		} else {
			brief.source = null
			addressed = coarse(placeNow())
			render()
		}
		const { loads } = app.level
		if (first) await Promise.all([loadTop(), loads.loadNotes(), loads.loadReader(), app.prefs.load()])
		if (place.page === 'changes') await app.chg.enter(place.change === 'none' ? null : place.change)
		else if (place.page !== 'home') await enter(place.page)
		else if (!first) await loadTop()
		addressed = coarse(placeNow())
		render()
	}

	// The page opens: at the place its address names, or at Home.
	async function start(openReply) {
		const place = readPlace(location.hash)
		// Drawing Home beneath a restored reply must not rewrite that reply's history entry.
		restoringReply = Boolean(place.reply)
		try {
			await goPlace(place, true)
			if (restoringReply) await openReply(place.reply).catch(() => {})
		} finally {
			if (restoringReply) {
				restoringReply = false
				address()
			}
		}
	}

	// Back and Forward in the browser. reply is given the id of a saved reply the address names.
	function back(reply) {
		leaveReply()
		const place = readPlace(location.hash)
		return place.reply ? reply(place.reply) : goPlace(place, false)
	}

	// ken wrote a line about the reader, or its model ran: what the pages show of the project is read again.
	async function reread() {
		app.briefs.forget()
		await loadTop()
	}

	// ken wrote a line about the reader: only what ken thinks they know moves, so the top level and the briefs are
	// read again, and the commits by day and what search can find stay.
	async function rereadKnows() {
		app.briefs.forget()
		const mine = ++topAsked
		const top = await read('/api/layout').catch(() => null)
		if (mine === topAsked && top?.ok) shell.top = top.body
	}

	const briefOf = (id) => {
		const found = app.briefs.get(id, render)
		return found.kind === 'ok' ? found.brief : null
	}

	// Draws the frame and the page under it. It answers whether a reply lies over the pages, which the page then
	// draws as it did.
	function draw(env) {
		drawModal()
		const over = overlaid()
		const { home } = state
		fill(
			$('#rail'),
			railHtml({ on: over ? null : shell.page, askOpen: state.ask.open, settingsOpen: shell.settingsOpen }),
		)
		const title = barTitle({ page: shell.page, view: state.view, project: state.project?.name })
		// A narrow window has no room for the whole sentence in the box. Its label says it all the same.
		const asks = narrow.matches ? 'Find' : 'Find a part, a process or a term'
		if ($('#search-text').placeholder !== asks) $('#search-text').placeholder = asks
		if ($('#bar-title').textContent !== title) $('#bar-title').textContent = title
		const [start, canvas, procs] = [$('#pg-home'), $('#pg-arch'), $('#pg-proc')]
		start.hidden = over || shell.page !== 'home'
		canvas.hidden = over || shell.page !== 'architecture'
		procs.hidden = over || shell.page !== 'processes'
		if (procs.hidden) fill(procs, '')
		else app.procs.draw(env)
		const you = $('#pg-you')
		you.hidden = over || shell.page !== 'you'
		if (you.hidden) fill(you, '')
		else app.you.draw()
		const changes = $('#pg-changes')
		changes.hidden = over || shell.page !== 'changes'
		if (changes.hidden) fill(changes, '')
		else app.chg.draw(env)
		$('#pg-old').hidden = !over
		// A brief or Ask ken takes the right of the window, and Home makes room for it.
		start.classList.toggle('has-drawer', Boolean(state.brief.id) || state.ask.open)
		$('.k-bar').classList.toggle('has-drawer', Boolean(state.brief.id) || state.ask.open)
		if (start.hidden) fill(start, '')
		else {
			const view = { top: shell.top, home, reader: home.reader, followUp: state.followUp, concepts: shell.concepts }
			const project = state.project?.name ?? 'ken'
			fill(start, startPageHtml({ ...view, timeline: shell.timeline, project, briefOf, first: shell.first, env }))
		}
		// The canvas and the home from before the pages name some fields alike, so the one off screen is emptied.
		if (canvas.hidden) fill(canvas, '')
		else app.arch.draw(env)

		const { search } = shell
		const found = $('#found')
		const box = $('#search-text')
		fill(found, search.open ? foundHtml(search, home) : '')
		found.hidden = found.innerHTML === ''
		box.setAttribute('aria-expanded', String(!found.hidden))
		const on = found.querySelector('[aria-selected="true"]')
		if (on) box.setAttribute('aria-activedescendant', on.id)
		else box.removeAttribute('aria-activedescendant')

		const settings = $('#settings')
		settings.hidden = !shell.settingsOpen
		const own = home.reader?.file ? home.reader.file.slice(0, home.reader.file.lastIndexOf('/')) : null
		fill(settings, shell.settingsOpen ? settingsHtml(shell.prefs, { project: state.project?.folder, own }) : '')

		fill($('#bar-acts'), barActsHtml({ askOpen: state.ask.open, settingsOpen: shell.settingsOpen }))
		fill($('#jobs'), jobsLineHtml(state.jobs))
		app.ask.draw(env)

		app.brief.draw(env)
		address()
		return over
	}

	// "Start here" and its chips go where the server says: a part to read opens as a brief on the canvas, and a
	// change opens on the Changes page with that change laid over the parts.
	async function follow(item, opener) {
		leaveReply()
		if (item.kind === 'decision') return goTab('decisions')
		if (item.go.way === 'learn') {
			await goPage('architecture')
			return item.go.part ? app.brief.show(partId([], item.go.part), { opener }) : null
		}
		Object.assign(shell, { page: 'changes', settingsOpen: false })
		state.view = state.base = 'home'
		state.chg.tab = 'changes'
		state.chg.part = item.go.part ?? null
		await app.chg.enter(item.go.change ?? null, true)
		render()
	}

	// A tab of the Changes page: what waits on the reader with the decisions, or live mode.
	async function goTab(tab) {
		leaveReply()
		state.chg.tab = tab
		state.view = state.base = 'home'
		if (shell.page !== 'changes') return goPage('changes')
		render()
		await app.chg.enter()
		render()
	}

	function closeSettings() {
		if (!shell.settingsOpen) return false
		shell.settingsOpen = false
		render()
		const opener = $(`[data-key="${settingsOpener}"]`)
		const back = opener?.getClientRects().length
			? opener
			: $(narrow.matches ? '[data-key="bar-settings"]' : '[data-key="settings"]')
		back?.focus()
		return true
	}

	async function openFound(id) {
		Object.assign(shell.search, { text: '', open: false, at: 0 })
		$('#search-text').value = ''
		await app.arch.showConcept(id)
		app.brief.show(id, { opener: 'search-text' })
	}

	const actions = {
		'go-page': (el) => goPage(el.dataset.page),
		'start-go': (el) => follow(shell.top.look.next.items[Number(el.dataset.index)], el.dataset.key),
		'project-brief': (el) => app.brief.project(el.dataset.key),
		'first-name': () => app.level.nameTop(),
		// The main process ken's model named is drawn on the Processes page, where the reader sees it come.
		async 'first-draw'() {
			const flow = shell.top.look.named.flows[0]
			await goPage('processes')
			app.procs.ask(flow)
		},
		'part-changed': (el) => {
			const box = shell.top.look.boxes.find((box) => box.name === el.dataset.name)
			return follow({ go: { ...box.knows.go, part: box.name } }, el.dataset.key)
		},
		settings(el) {
			if (closeSettings()) return
			settingsOpener = el.dataset.key
			shell.settingsOpen = true
			render()
			$('#settings-title')?.focus()
		},
		'pref-text'(el) {
			app.prefs.setText(el.dataset.text)
			state.arch.format = null
			render()
		},
		'pref-theme'(el) {
			app.prefs.setTheme(el.dataset.theme)
			render()
		},
		'found-open': (el) => openFound(el.dataset.concept),
	}

	// The search box: what the reader types is kept as typed, and the list of what there is to find is read once.
	function input(event) {
		if (event.target.id !== 'search-text') return false
		const { search } = shell
		Object.assign(search, { text: event.target.value, at: 0, open: true })
		if (search.list === null || search.list === false) {
			search.list = null
			void app.briefs.concepts().then((list) => {
				search.list = list ?? false
				render()
			})
		}
		render()
		return true
	}

	// A press outside the search or the settings closes them.
	function pressed(target) {
		const { search } = shell
		if (search.open && !target.closest('#search')) {
			search.open = false
			render()
		}
		if (shell.settingsOpen && !target.closest('#settings, [data-act="settings"]')) closeSettings()
		if (state.jobs.open && !target.closest('#jobs')) {
			state.jobs.open = false
			render()
		}
	}

	function searchKey(event) {
		const { search } = shell
		const found = search.list ? findConcepts(search.list, search.text) : []
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (found.length === 0) return false
			search.at = (search.at + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length
			search.open = true
		} else if (event.key === 'Enter' && !event.isComposing) {
			if (!found[search.at]) return false
			void openFound(found[search.at].id)
		} else if (event.key === 'Escape') {
			if (!search.open || search.text === '') return false
			search.open = false
		} else return false
		event.preventDefault()
		render()
		return true
	}

	// Escape closes what is open, the nearest first: the search, the settings, a correction on You, the "Ask ken"
	// drawer, a correction in the brief, the draw tool, the key or a sheet over the drawing, the brief, and then the
	// level of the canvas, which goes up one.
	function key(event) {
		if (event.target.id === 'search-text' && searchKey(event)) return true
		if (event.key !== 'Escape') return false
		const typing = event.target.matches?.('input, textarea, select')
		const { brief, home } = state
		if (closeSettings()) return true
		if (state.jobs.open) {
			state.jobs.open = false
			render()
			;($('[data-key="jobs-open"]') ?? $('#search-text')).focus()
			return true
		}
		if (shell.page === 'you' && app.you.closeFix()) return true
		if (app.ask.close()) return true
		if (brief.fixing) return Boolean(app.brief.actions['brief-fix']()) || true
		if (app.arch.closeDraw() || app.arch.closeKey() || app.arch.closeSheet()) return true
		if (app.brief.close()) return true
		if (!overlaid() && shell.page === 'architecture' && home.trail.length > 1 && !typing) {
			void app.arch.moveTo(home.trail.slice(0, -1))
			return true
		}
		return false
	}

	$('#search-text').addEventListener('focus', () => {
		if (shell.search.text.trim() === '' || shell.search.open) return
		shell.search.open = true
		render()
	})

	return {
		leaveReply,
		actions,
		start,
		back,
		goPage,
		goTab,
		draw,
		reread,
		rereadKnows,
		input,
		key,
		pressed,
		wrapTab,
		overlaid,
	}
}
