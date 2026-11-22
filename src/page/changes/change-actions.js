// What the reader does on the Changes page: pick a span on the timeline, by dragging across it, by a preset or a day
// at a time, pick a change to review, ask ken's model for its story or its steps, and open a step as a brief with its
// diff. The level, its change and the runs of ken's model are the level's (src/page/level); this module lays the
// change over the top of the project and draws the page.
import { stepFiles } from '../level/content.js'
import { WHOLE } from '../level/level-state.js'
import { stepDiffHtml, stepParts, stepWords, walkOf } from '../project/walk.js'
import { fill } from '../shell/fill.js'
import { wordsHtml } from '../views/reply.js'
import { changesPageHtml, spanChoices, spanOf } from './changes.js'
import { dayAt, daysShown } from './timeline.js'

const DAY = 86_400_000

export const freshChanges = () => ({
	tab: 'changes',
	// The span the reader is dragging across the timeline, { from, to } as days, or null.
	drag: null,
	// What the reader typed in "Another change" and has not sent.
	typed: '',
})

// What a brief made on the page says of where its words come from.
const TRUST = "ken's model wrote the words. ken found each changed line in git."

const blank = (id, kind, name, line) => ({
	id,
	kind,
	name,
	line,
	local: true,
	minutes: Math.max(1, Math.round(line.split(/\s+/).length / 120)),
	explained: true,
	explain: null,
	points: [],
	terms: [],
	questions: [],
	decisions: [],
	sideways: { uses: [], usedBy: [], processes: [] },
	deeper: null,
	steps: null,
	knows: null,
	trust: TRUST,
})

// app is the page: its state, render, the level's reads and runs, the store of briefs and the brief's drawer, and
// the views from before the pages that the tabs show.
export function changeActions(app) {
	const { state, render } = app
	const chg = state.chg
	const $ = (selector) => document.querySelector(selector)
	const page = $('#pg-changes')
	const loads = () => app.level.loads

	async function show(change) {
		const home = state.home
		Object.assign(home, { trail: [WHOLE], change, at: '', selected: null, shown: null, wayIn: 'review' })
		chg.drag = null
		await loads().loadLayout()
		await loads().settle()
		render()
	}

	// The span the page opens on: since the reader last looked when anything landed since, else the first span ken
	// offers.
	async function enter(change = null) {
		const home = state.home
		if (!state.shell.timeline || home.changes.length === 0) await app.reread()
		if (chg.tab !== 'changes') await app.older.load(chg.tab)
		if (change) return show(change)
		const kept = home.trail.length === 1 && home.change !== 'none' && home.look?.change
		if (kept) return show(home.change)
		const first = spanChoices(state.shell.top?.changes ?? home.changes)[0]
		await show(first?.change ?? 'since:7d')
	}

	function draw(env) {
		const older = chg.tab === 'changes' ? '' : app.older.html(chg.tab)
		const waiting = app.older.waiting()
		const live = app.older.live()
		const drawn = fill(
			page,
			changesPageHtml({ home: state.home, chg, env, timeline: state.shell.timeline, waiting, live, older }),
		)
		// A timeline wider than the screen opens at its newest days, where the span ends.
		const wrap = page.querySelector('#chg-timeline')
		if (drawn && wrap && !chg.drag) wrap.scrollLeft = wrap.scrollWidth
	}

	const lookNow = () => state.home.look
	const walk = () => (state.home.content.walk?.q ? walkOf(state.home.content.walk.q.reply) : [])

	// A step of the walkthrough as a brief: its words, the parts it is in, and its changed lines.
	function openStep(n, opener) {
		const look = lookNow()
		const q = state.home.content.walk.q
		const step = walk().find((each) => each.number === n)
		if (!step || !look?.change) return
		const { title, body } = stepWords(step)
		const id = `change-step:${q.id}:${n}`
		app.briefs.put(id, {
			...blank(id, 'step', title, body || title),
			lit: [...stepParts(step, look.boxes)].map((i) => look.boxes[i].name),
			html: `<h3 class="k-eyebrow">The changed lines</h3>${stepDiffHtml(step, look.change.range)}`,
		})
		app.brief.show(id, { opener })
		const paths = stepFiles(step).map((file) => file.path)
		const { base, head } = look.change.range
		if (paths.length > 0) void app.level.tell({ did: 'change', paths, change: { base, head } })
	}

	function openStory(opener) {
		const look = lookNow()
		const q = state.home.content.story?.q
		if (!q || !look?.change) return
		const words = q.reply.items.filter((item) => item.kind === 'words').map((item) => item.text.trim())
		const [lead = '', ...rest] = words.join('\n\n').split(/\n\s*\n/)
		const id = `change-story:${q.id}`
		app.briefs.put(id, {
			...blank(id, 'change', look.change.name, lead),
			lit: look.boxes.filter((box) => box.touched).map((box) => box.name),
			html: rest.length > 0 ? `<div class="k-story">${wordsHtml(rest.join('\n\n'))}</div>` : '',
		})
		app.brief.show(id, { opener })
	}

	// The span starts a day earlier or later, and runs to today.
	function shift(by) {
		const span = spanOf(state.home)
		const days = daysShown(state.shell.timeline)
		const from = span ? Date.parse(span.from) + by * DAY : Date.parse(days.at(-8))
		const day = new Date(Math.min(Math.max(from, Date.parse(days[0])), Date.parse(days.at(-1)))).toISOString()
		return show(`since:${day.slice(0, 10)}`)
	}

	const actions = {
		'chg-pick': (el) => show(el.dataset.change).then(() => $('#chg-name')?.focus({ preventScroll: true })),
		'chg-shift': (el) => shift(Number(el.dataset.by)),
		'chg-step': (el) => openStep(Number(el.dataset.n), el.dataset.key),
		'chg-story': (el) => openStory(el.dataset.key),
		async 'chg-tab'(el) {
			chg.tab = el.dataset.tab
			render()
			if (chg.tab !== 'changes') await app.older.load(chg.tab)
			else if (!lookNow()?.change) await enter()
			render()
			$(`[data-key="chg-tab-${chg.tab}"]`)?.focus()
		},
	}

	// Dragging across the timeline picks where the span starts. It runs to today, as the server takes a span of time.
	let dragFrom = null
	function dayUnder(event) {
		const svg = $('#chg-timeline svg')
		const box = svg.getBoundingClientRect()
		return dayAt(daysShown(state.shell.timeline), (event.clientX - box.left) / box.width)
	}
	page.addEventListener('pointerdown', (event) => {
		if (!event.target.closest('#chg-timeline') || event.button !== 0) return
		event.preventDefault()
		page.setPointerCapture(event.pointerId)
		dragFrom = dayUnder(event)
		chg.drag = { from: dragFrom, to: daysShown(state.shell.timeline).at(-1) }
		render()
	})
	page.addEventListener('pointermove', (event) => {
		if (dragFrom === null) return
		const day = dayUnder(event)
		const from = day < dragFrom ? day : dragFrom
		if (chg.drag.from !== from) {
			chg.drag = { ...chg.drag, from }
			render()
		}
	})
	page.addEventListener('pointerup', () => {
		if (dragFrom === null) return
		dragFrom = null
		void show(`since:${chg.drag.from}`)
	})
	// A swipe the browser takes over, or capture lost another way, ends the drag with nothing picked.
	const drop = () => {
		if (dragFrom === null) return
		dragFrom = null
		chg.drag = null
		render()
	}
	page.addEventListener('pointercancel', drop)
	page.addEventListener('lostpointercapture', drop)

	function submit(event) {
		if (event.target.id !== 'chg-another') return false
		event.preventDefault()
		const text = chg.typed.trim()
		if (text !== '') void show(text).then(() => $('#chg-name')?.focus({ preventScroll: true }))
		return true
	}

	function input(event) {
		if (event.target.id !== 'chg-another-text') return false
		chg.typed = event.target.value
		return true
	}

	return { actions, enter, draw, submit, input }
}
