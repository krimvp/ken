// What the reader does on the Changes page: pick a span on the timeline, by dragging across it, by a preset or a day
// at a time, pick a change to review, ask ken's model for its story or its steps, and open a step as a brief with its
// diff. The level, its change and the runs of ken's model are the level's (src/page/level); this module lays the
// change over the top of the project and draws the page.
import { pageBrief } from '../brief/briefs.js'
import { stepFiles } from '../level/content.js'
import { WHOLE } from '../level/level-state.js'
import { stepDiffHtml, stepParts, stepWords, walkOf } from '../project/walk.js'
import { fill } from '../shell/fill.js'
import { esc } from '../views/format.js'
import { wordsHtml } from '../views/reply.js'
import { changeName, changesPageHtml, shownInPart, spanChoices, spanOf } from './changes.js'
import { dayAt, daysShown } from './timeline.js'

const DAY = 86_400_000

// What a brief made on the page says of where its words come from.
const TRUST = "ken's model wrote the words. ken found each changed line in git."

export const freshChanges = () => ({
	tab: 'changes',
	part: null,
	partDiff: null,
	// The span the reader is dragging across the timeline, { from, to } as days, or null.
	drag: null,
	// What the reader typed in "Another change" and has not sent.
	typed: '',
})

// app is the page: its state, render, the level's reads and runs, the store of briefs and the brief's drawer, and
// the views from before the pages that the tabs show.
export function changeActions(app) {
	const { state, render } = app
	const chg = state.chg
	const $ = (selector) => document.querySelector(selector)
	const page = $('#pg-changes')
	const loads = () => app.level.loads

	let readingPart = 0
	async function readPart(name, change, remember, mine) {
		let look = state.shell.top?.look
		if (!look) {
			const top = await app.read('/api/layout?change=none').catch(() => null)
			if (mine !== readingPart || state.shell.page !== 'changes') return
			look = top?.body.look
		}
		const box = look?.boxes.find((each) => each.name === name)
		if (!box) {
			chg.partDiff = { message: 'ken could not find this part in the project.' }
		} else {
			const query = new URLSearchParams({ change, part: name })
			for (const path of box.paths) query.append('within', path)
			const answer = await app
				.read(`/api/change/diff?${query}`)
				.catch((error) => ({ ok: false, body: { message: error.message } }))
			if (mine !== readingPart || chg.part !== name || state.shell.page !== 'changes') return
			chg.partDiff = { ...answer.body, within: box.paths }
			if (remember && answer.ok && !answer.body.tooLarge)
				void app.level.tell({ did: 'change', paths: box.paths, change: answer.body.range })
		}
		render()
	}

	async function show(change, part = null, remember = false) {
		const mine = ++readingPart
		chg.part = part
		chg.partDiff = null
		const home = state.home
		Object.assign(home, { trail: [WHOLE], change, at: '', selected: null, shown: null, wayIn: 'review' })
		chg.drag = null
		if (part) {
			render()
			return readPart(part, change, remember, mine)
		}
		if (!(await loads().loadLayout()) || chg.part !== part || state.shell.page !== 'changes') return
		await loads().settle()
		render()
	}

	// The span the page opens on: since the reader last looked when anything landed since, else the first span ken
	// offers.
	async function enter(change = null, remember = false) {
		const part = chg.part
		const home = state.home
		if (change && part && chg.tab === 'changes') return show(change, part, remember)
		if (!state.shell.timeline || home.changes.length === 0) await app.reread()
		if (chg.tab !== 'changes') await app.older.load(chg.tab)
		if (state.shell.page !== 'changes' || chg.part !== part) return
		if (change) return show(change, part, remember)
		const kept = home.trail.length === 1 && home.change !== 'none' && home.look?.change
		if (kept) return show(home.change, part, remember)
		const first = spanChoices(state.shell.top?.changes ?? home.changes)[0]
		await show(first?.change ?? 'since:7d', part, remember)
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
		const part = shownInPart(look, stepFiles(step)).map(
			({ path, added, removed, whole }) =>
				`<p class="k-muted">This step shows part of the change to <code>${esc(path)}</code>: +${added} &minus;${removed} of its +${whole.added} &minus;${whole.removed}.</p>`,
		)
		app.briefs.put(id, {
			...pageBrief(id, 'step', title, body || title, TRUST),
			lit: [...stepParts(step, look.boxes)].map((i) => look.boxes[i].name),
			html: `<h3 class="k-eyebrow">The changed lines</h3>${part.join('')}${stepDiffHtml(step, look.change.range)}`,
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
			...pageBrief(id, 'change', changeName(state.home), lead, TRUST),
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
		'chg-part': (el) =>
			show(state.home.change, el.dataset.name ?? null, true).then(() => $('#chg-name')?.focus({ preventScroll: true })),
		'chg-pick': (el) => show(el.dataset.change).then(() => $('#chg-name')?.focus({ preventScroll: true })),
		'chg-shift': (el) => shift(Number(el.dataset.by)),
		'chg-step': (el) => openStep(Number(el.dataset.n), el.dataset.key),
		'chg-explain-part'() {
			const { range, within } = chg.partDiff
			return app.send({
				lens: { kind: 'change', want: 'story', change: `${range.base}..${range.head}`, part: chg.part, within },
			})
		},
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
