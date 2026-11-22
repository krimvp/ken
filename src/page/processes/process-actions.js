// What the reader does on the Processes page: pick a drawn process, switch between its lanes and the map, and ask
// ken's model to draw one more, from an offer or in their own words. A drawing ken's model finished opens large.
import { fill } from '../shell/fill.js'
import { drawLaneLinks, processesPageHtml } from './processes.js'

export const freshProcesses = () => ({
	// The drawn processes as GET /api/processes sends them, newest first: null until read.
	list: null,
	offers: [],
	at: null,
	view: 'lanes',
	problem: null,
	// The ids there were when a drawing was asked for, so the new one opens when it is done.
	before: null,
})

// app is the page: its state, render, read and send.
export function processActions(app) {
	const { state, render, read, send } = app
	const procs = state.procs
	const $ = (selector) => document.querySelector(selector)
	const page = $('#pg-proc')

	async function load() {
		const answer = await read('/api/processes').catch((error) => ({ ok: false, body: { message: error.message } }))
		if (!answer.ok) {
			Object.assign(procs, {
				list: procs.list ?? [],
				problem: `ken could not read the drawn processes. ${answer.body.message}`,
			})
			return false
		}
		const { processes, offers } = answer.body
		const fresh = procs.before ? processes.find((each) => !procs.before.includes(each.id)) : null
		Object.assign(procs, { list: processes, offers, before: null })
		if (fresh) procs.at = fresh.id
		if (!processes.some((each) => each.id === procs.at)) procs.at = processes[0]?.id ?? null
		return Boolean(fresh)
	}

	async function enter() {
		await load()
		render()
	}

	function draw(env) {
		const look = state.shell.top?.look ?? null
		if (fill(page, processesPageHtml({ procs, look, home: state.home, env }))) drawLaneLinks(page)
	}

	// One run of ken's model draws what the reader asked for, at the top of the project.
	function ask(text) {
		const said = text.trim()
		if (said === '' || state.running || state.model?.kind !== 'ok') return
		Object.assign(procs, { problem: null, before: (procs.list ?? []).map((each) => each.id) })
		void send(
			{ lens: { kind: 'view', within: [], name: null, text: said } },
			{ kind: 'draw', text: said, trail: [], change: 'none', wayIn: 'learn' },
		)
	}

	// The run is over: the processes are read again, and one it drew opens. A run that drew nothing says so.
	async function ended(q) {
		if (!(await load())) {
			procs.problem =
				q.outcome === 'stopped'
					? 'You stopped the run.'
					: (q.error ?? "ken's model drew no process for that. Its reply is under Ask ken, with your earlier replies.")
		}
		render()
		$('#proc-title')?.focus({ preventScroll: true })
	}

	const actions = {
		'proc-pick'(el) {
			procs.at = el.dataset.id
			render()
			$('#proc-title')?.focus({ preventScroll: true })
		},
		'proc-view'(el) {
			procs.view = el.dataset.view
			render()
		},
		'proc-offer'(el) {
			const offers = page.querySelectorAll('.k-offer span')
			ask(offers[Number(el.dataset.index)]?.textContent ?? '')
		},
	}

	function submit(event) {
		if (event.target.id !== 'proc-draw-form') return false
		event.preventDefault()
		const box = event.target.elements.text
		if (box.value.trim() === '') {
			procs.problem = 'Say first what to draw.'
			render()
			box.focus()
			return true
		}
		ask(box.value)
		box.value = ''
		return true
	}

	window.addEventListener('resize', () => state.shell.page === 'processes' && drawLaneLinks(page))

	return { actions, enter, draw, ended, submit, reread: load }
}
