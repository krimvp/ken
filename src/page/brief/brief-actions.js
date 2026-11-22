// What the reader can do with a brief: open one from a page or from inside another, go back along the trail, take
// one of the three ways on, open the quoted lines a thing to know rests on, correct what ken thinks they know, ask
// ken's model to explain the concept or to answer a question about it, and close the drawer. Opening a part's brief
// tells ken the reader opened the part, and a quoted line opened tells it they opened code.
import { fill } from '../shell/fill.js'
import { briefHtml, partRowHtml, pathsOf } from './brief.js'
import { pageBrief } from './briefs.js'
import { partId, readConcept } from './concept-id.js'

// What the drawer holds while no brief is open.
export const freshBrief = () => ({
	id: null,
	// The way on that shows in place of the brief: "sideways", "questions", "deeper", or null.
	on: null,
	// The briefs the reader came through, the open one last: [{ id, name }].
	trail: [],
	fixing: false,
	// The things to know whose quoted lines are open, by their place.
	openQuotes: new Set(),
	problem: null,
	saveProblem: null,
	// What ken wrote after the reader said what they know of the open concept, as ken recorded it.
	said: null,
	// The key of what the reader pressed to open the drawer, which gets the keyboard back when it closes.
	opener: null,
	// The id of the brief ken was last told the reader opened.
	told: null,
	// The keyboard goes to the brief's name once the brief is here: it may still be on its way from the server.
	focusName: false,
	// The level inside the open part, for "Deeper": undefined before it is asked for, null while the page reads it.
	inner: undefined,
})

// app is the page: its state, render, post, send, the store of briefs, and home, the actions of the views from
// before the pages, which read the level again and tell ken what the reader looked at.
export function briefActions(app) {
	const { state, render, post, send, briefs } = app
	const ui = state.brief
	const $ = (selector) => document.querySelector(selector)

	const found = () => (ui.id ? briefs.get(ui.id, render) : null)
	const open = () => {
		const now = found()
		return now?.kind === 'ok' ? now.brief : null
	}

	// A brief opened from a page starts a new trail. One opened from inside a brief adds a step to it, and one that is
	// already on the trail cuts the trail back to it.
	function show(id, { inside = false, opener = null } = {}) {
		const at = ui.trail.findIndex((step) => step.id === id)
		const step = { id, name: readConcept(id)?.name ?? id }
		if (id !== ui.id) briefs.reopen(id)
		app.ask.remember(id)
		state.ask.open = false
		if (!inside || ui.id === null) Object.assign(ui, { trail: [step], opener: opener ?? ui.opener })
		else ui.trail = at >= 0 ? ui.trail.slice(0, at + 1) : [...ui.trail, step]
		Object.assign(ui, {
			id,
			on: null,
			fixing: false,
			openQuotes: new Set(),
			problem: null,
			saveProblem: null,
			said: null,
			inner: undefined,
			source: null,
			focusName: true,
		})
		render()
	}

	// The drawer closes, and the keyboard goes back to what opened it.
	function close() {
		if (ui.id === null) return false
		const opener = ui.opener
		Object.assign(ui, { id: null, on: null, trail: [], fixing: false, opener: null, told: null })
		render()
		const back = opener ? document.querySelector(`[data-key="${CSS.escape(opener)}"]`) : null
		;(back ?? $('[aria-current="page"]'))?.focus({ preventScroll: true })
		return true
	}

	// The level the open concept stands in, when the page has it: the one on the canvas, or the top one.
	function lookOf(id) {
		const concept = readConcept(id)
		if (open()?.lit) return state.shell.top?.look ?? null
		if (concept?.kind !== 'part') return null
		const same = (look) => look && look.within.join(',') === concept.within.join(',')
		return [state.home.look, state.shell.top?.look].find(same) ?? null
	}

	// The level inside the open part, read once, for Deeper and for a part ken's model has not explained.
	function readInner(brief) {
		if (!brief?.deeper || ui.inner !== undefined) return
		ui.inner = null
		void briefs.lookAt(brief.deeper.within.split(',')).then((look) => {
			if (ui.id !== brief.id) return
			ui.inner = look ?? { boxes: [] }
			render()
		})
	}

	// Draws the drawer. Called on every render of the page.
	function draw(env) {
		const drawer = $('#brief')
		const now = found()
		drawer.hidden = now === null || state.ask.open
		if (state.ask.open) return
		if (now === null) return fill(drawer, '')
		if (now.kind === 'ok') {
			const { brief } = now
			ui.trail = ui.trail.map((step) => (step.id === brief.id ? { ...step, name: brief.name } : step))
			if (brief.kind === 'part' && !brief.explained) readInner(brief)
			if (ui.told !== ui.id && (brief.kind === 'part' || brief.kind === 'file')) {
				ui.told = ui.id
				const paths = pathsOf(brief)
				if (paths.length > 0) void app.level.tell({ did: 'opened', paths })
			}
		}
		const scroll = drawer.querySelector('#brief-scroll')?.scrollTop ?? 0
		const typed = drawer.querySelector('#brief-ask-text')?.value ?? ''
		const changed = fill(
			drawer,
			briefHtml(ui, now, {
				home: state.home,
				prefs: state.shell.prefs,
				env,
				look: lookOf(ui.id),
				inner: ui.inner ?? null,
				views: state.shell.top?.look?.views ?? null,
				runtime: state.shell.page === 'architecture' && state.arch.shown === 'runtime',
			}),
		)
		const name = drawer.querySelector('#brief-name')
		if (ui.focusName && name) {
			ui.focusName = false
			name.focus({ preventScroll: true })
		}
		if (!changed) return
		const body = drawer.querySelector('#brief-scroll')
		if (body && drawer.dataset.shown === `${ui.id} ${ui.on}`) body.scrollTop = scroll
		drawer.dataset.shown = `${ui.id} ${ui.on}`
		const box = drawer.querySelector('#brief-ask-text')
		if (box) box.value = typed
	}

	// The files of the open brief, for the ten seconds after which ken counts it as read.
	const readPaths = () => {
		const brief = open()
		return brief ? pathsOf(brief) : null
	}

	async function saved(change) {
		ui.saveProblem = null
		try {
			await change()
		} catch (error) {
			ui.saveProblem = `ken could not save that. ${error.message}`
		}
		await app.level.recorded()
		render()
	}

	// Asks ken's model a question about the open concept. Its answer comes back as a brief of its own.
	function ask(text, typed = false) {
		const said = text.trim()
		if (!ui.id || said === '') return
		ui.problem = null
		const started = { trail: state.home.trail, change: state.home.change, wayIn: state.home.wayIn, concept: ui.id }
		return send(
			{ lens: { kind: 'answer', concept: ui.id, text: said, typed } },
			{ ...started, kind: 'answer', text: said },
		)
	}

	// A run this drawer started is over: the brief is read again, and an answer opens as its own brief.
	async function ended(started, q) {
		briefs.forget()
		await app.level.recorded()
		const answered = q.outcome === 'answered'
		const answer = q.brief ?? state.rows.find((row) => row.id === q.id)?.brief ?? null
		if (ui.id !== started.concept) return render()
		if (started.kind === 'answer' && answered && answer) return show(answer, { inside: true })
		if (!answered) {
			const why =
				{
					incomplete: "ken's model did not give a brief with a checked point. You can ask again.",
					stopped: 'You stopped the run.',
					unasked: q.error,
				}[q.outcome] ?? q.error
			ui.problem = why ?? "ken's model gave no reply."
		}
		render()
	}

	async function readSource(start, ref, record = true) {
		if (!ref) return
		const { path, commit } = ref
		const where = { path, commit, line: Number(start) }
		const reading = { kind: 'reading', where }
		ui.on = 'source'
		ui.source = reading
		render()
		const query = new URLSearchParams({ path, at: commit, start })
		const result = await app
			.read(`/api/source?${query}`)
			.catch((error) => ({ ok: false, body: { message: error.message } }))
		if (ui.source !== reading || ui.on !== 'source') return
		ui.source = result.ok ? { ...result.body, where } : { kind: 'error', where, message: result.body.message }
		render()
		$('#brief-scroll').scrollTop = 0
		$('#brief-name')?.focus({ preventScroll: true })
		if (record && result.ok && result.body.lines.length) void app.level.tell({ did: 'code', paths: [path] })
	}

	const actions = {
		'brief-source': (el) => readSource(el.dataset.start, el.dataset.path ? el.dataset : ui.source?.where),
		'brief-open': (el) => show(el.dataset.concept, { inside: Boolean(el.closest('#brief')), opener: el.dataset.key }),
		'brief-close': close,
		'brief-trail': (el) => show(ui.trail[Number(el.dataset.index)].id, { inside: true }),
		async 'brief-way'(el) {
			const way = el.dataset.way || null
			ui.on = ui.on === way ? null : way
			ui.fixing = false
			if (ui.on === 'source') return readSource(1, open()?.source)
			if (ui.on === 'deeper') readInner(open())
			render()
			$('#brief-scroll').scrollTop = 0
			$('#brief-name')?.focus({ preventScroll: true })
		},
		'brief-inside'() {
			const brief = open()
			const concept = readConcept(ui.id)
			if (!brief?.deeper || concept?.kind !== 'part') return
			return app.arch.goInside(concept, brief.deeper.within.split(','))
		},
		'brief-quote'(el) {
			const i = Number(el.dataset.index)
			const opening = !ui.openQuotes.has(i)
			if (opening) ui.openQuotes.add(i)
			else ui.openQuotes.delete(i)
			render()
			const paths = opening ? (open()?.points[i]?.quotes.map((quote) => quote.path) ?? []) : []
			if (paths.length > 0) void app.level.tell({ did: 'code', paths: [...new Set(paths)] })
		},
		'brief-fix'() {
			ui.fixing = !ui.fixing
			ui.said = null
			render()
			$(ui.fixing ? '.k-rung[aria-pressed="true"]' : '[data-key="brief-fix"]')?.focus()
		},
		// The reader says what they know of the part. "You said you know it" is theirs to say, so ken writes it as said.
		async 'brief-set'(el) {
			const brief = open()
			const paths = brief ? pathsOf(brief) : []
			const { level } = el.dataset
			ui.fixing = false
			if (paths.length === 0) return render()
			// The reader said it, so the brief and its block show it now. The reads after the save bring ken's own words.
			const box = lookOf(ui.id)?.boxes.find((each) => each.name === brief.name)
			for (const has of [brief, box]) if (has?.knows) has.knows = { ...has.knows, level }
			render()
			await saved(() => post('/api/seen', level === 'said' ? { did: 'said', paths } : { did: 'set', level, paths }))
			if (!ui.saveProblem) ui.said = state.home.reader?.learned[0]?.text ?? null
			render()
			$('[data-key="brief-fix"]')?.focus()
		},
		'brief-explain'() {
			const brief = open()
			if (!brief?.explain) return
			ui.problem = null
			const { trail, change, wayIn } = state.home
			return send({ lens: brief.explain.lens }, { kind: 'explain', concept: ui.id, trail, change, wayIn })
		},
		'brief-answer': (el) => ask(open()?.questions[Number(el.dataset.index)]?.text ?? ''),
	}

	function submit(event) {
		if (event.target.id !== 'brief-ask-form') return false
		event.preventDefault()
		const box = event.target.elements.text
		const text = box.value
		if (text.trim() === '') {
			ui.problem = 'Write your question first.'
			render()
			return true
		}
		if (state.running || state.model?.kind !== 'ok') return true
		box.value = ''
		void ask(text, true)
		return true
	}

	// The project's own brief, made from the top level: what it is in two sentences, and its parts.
	function project(opener) {
		const look = state.shell.top?.look
		if (!look?.named) return
		const name = state.project?.name ?? 'The project'
		const id = `project:${name}`
		const parts = look.boxes.map((box, i) => ({ id: partId([], box.name), name: box.name, note: box.job, i }))
		app.briefs.put(id, {
			...pageBrief(id, 'project', name, look.named.about, "ken's model named the parts. ken found their files in git."),
			lit: look.boxes.map((box) => box.name),
			html: `<h3 class="k-eyebrow">${look.boxes.length} parts</h3><ul class="k-rows">${parts.map(partRowHtml).join('')}</ul>`,
		})
		show(id, { opener })
	}

	return { actions, show, close, draw, ended, submit, readPaths, open, project, ask, readSource }
}
