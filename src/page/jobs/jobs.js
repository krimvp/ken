// What ken is doing by itself, as GET /api/jobs streams it: a quiet line in the bar with how many runs wait, the list it
// opens, the line a brief shows while ken is reading its part, and what the reader looks at, sent back so that it goes
// first. When a run ends, the pages read what it made, so a brief fills in with no reload.
import { esc, prose } from '../views/format.js'

// list is the jobs as the server sent them last. open says the list is unfolded. sent is what the page last said the
// reader looks at.
export const freshJobs = () => ({ list: [], open: false, sent: null })

const RETRY_MS = 3000

export const live = (job) => job.state.kind === 'waiting' || job.state.kind === 'running'

export function inLine(n) {
	const teen = n % 100 >= 11 && n % 100 <= 13
	const end = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
	return `${n}${end} in line`
}

// "Explaining Core" as it reads after "ken is".
const doing = (title) => `${title.charAt(0).toLowerCase()}${title.slice(1)}`

// The clock of a running job; the page's tick moves it every second.
function clockHtml(job) {
	const since = job.state.startedAt
	const seconds = Math.round((Date.now() - since) / 1000)
	return `<span class="k-job-clock k-num" data-since="${since}">${seconds} s so far</span>`
}

function stateHtml(job) {
	const { state } = job
	if (state.kind === 'running') {
		const acts = state.actions === 1 ? '1 action' : `${state.actions} actions`
		return `${clockHtml(job)}, ${acts}`
	}
	if (state.kind === 'waiting') return inLine(job.place)
	if (state.kind === 'done') return state.skipped ? 'Already known' : 'Done'
	return `Stopped: ${esc(state.why)}`
}

// The jobs ken holds now, for the page: the one the reader looks at, any that wait, and the runs that ended.
export function jobOf(jobs, concept) {
	return jobs.find((job) => job.concept === concept && live(job)) ?? null
}

// The quiet line in the bar, and the list under it when the reader opened it. Nothing shows while ken has nothing to do.
export function jobsLineHtml(jobs) {
	const running = jobs.list.filter((job) => job.state.kind === 'running')
	const waiting = jobs.list.filter((job) => job.state.kind === 'waiting').length
	const ended = jobs.list.filter((job) => !live(job))
	if (running.length === 0 && waiting === 0 && !jobs.open) return ''
	const now =
		running.length === 0
			? waiting
				? 'ken is about to read more'
				: 'No work in the queue'
			: `ken is ${doing(running[0].title)}${running.length > 1 ? ` and ${running.length - 1} more` : ''}`
	const label = `${now}${waiting > 0 ? `, ${waiting} waiting` : ''}`
	const line = `<button class="k-jobs-line" data-act="jobs-open" data-key="jobs-open" aria-label="Queue: ${esc(label)}" aria-expanded="${jobs.open}" aria-controls="jobs-list"><span class="k-jobs-dot" aria-hidden="true"></span><span class="k-jobs-short">Queue</span><span class="k-jobs-now">${prose(now)}</span>${waiting > 0 ? `<span class="k-jobs-wait k-num">${waiting} waiting</span>` : ''}</button>`
	if (!jobs.open) return line
	const row = (job) => {
		const stop = live(job)
			? `<button class="k-link" data-act="job-stop" aria-label="Stop ${esc(doing(job.title))}" data-job="${esc(job.key)}" data-key="job-stop-${esc(job.key)}">Stop</button>`
			: ''
		const by = job.by === 'reader' ? '<span class="k-job-by">You asked</span>' : ''
		return `<li class="k-job is-${job.state.kind}"><span class="k-job-title">${prose(job.title)}</span>${by}<span class="k-job-state">${stateHtml(job)}</span>${stop}</li>`
	}
	const shown = [...jobs.list.filter(live), ...ended.slice(-5).reverse()]
	const list = shown.length
		? `<ol class="k-jobs-rows">${shown.map(row).join('')}</ol>`
		: '<p class="k-muted">ken has nothing left to read.</p>'
	return `${line}<div class="k-jobs-list" id="jobs-list"><p class="k-eyebrow">What ken reads by itself</p>${list}<p class="k-muted k-jobs-note">What you ask goes first. Each is one run of ken's model.</p></div>`
}

// What a brief, or a page, says while ken reads its part, answers its question or draws it by itself.
export function jobLineHtml(job, what, tag = 'p') {
	if (job.state.kind === 'running') {
		return `<${tag} class="k-job-says" role="status"><span class="k-spin" aria-hidden="true"></span> ken is ${what} now. ${clockHtml(job)}.</${tag}>`
	}
	return `<${tag} class="k-job-says" role="status">ken is ${what}: ${inLine(job.place)}.</${tag}>`
}

// app is the page: its state, render, post and linesOf; made is told the jobs that just made something.
export function jobsActions(app, made) {
	const { state, render, post, linesOf } = app

	function take(jobs) {
		const before = new Map(state.jobs.list.map((job) => [job.key, job.state.kind]))
		const focused = document.activeElement
		const inQueue = focused?.closest('#jobs')
		state.jobs.list = jobs
		const ended = jobs.filter(
			(job) => job.state.kind === 'done' && !job.state.skipped && live({ state: { kind: before.get(job.key) } }),
		)
		if (ended.length > 0) void made(ended)
		render()
		if (inQueue && document.activeElement === document.body) {
			;(document.querySelector('[data-key="jobs-open"]') ?? document.querySelector('#search-text')).focus()
		}
	}

	// Reads the stream for as long as the page is open, and again a moment after the server goes away.
	async function feed() {
		for (;;) {
			try {
				const response = await fetch('/api/jobs')
				for await (const line of linesOf(response.body)) take(JSON.parse(line).jobs)
			} catch {
				// The server stopped or restarted: the page asks again.
			}
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
		}
	}

	// Called on each render: tells ken what the reader looks at when it changes.
	function look() {
		const onCanvas = state.shell.page === 'architecture' && state.view !== 'question'
		const looking = { brief: state.brief.id, within: onCanvas ? (state.home.trail.at(-1)?.within ?? []) : null }
		const said = JSON.stringify(looking)
		if (said === state.jobs.sent) return
		state.jobs.sent = said
		post('/api/jobs', { looking }).catch(() => {
			state.jobs.sent = null
		})
	}

	const actions = {
		'jobs-open'() {
			state.jobs.open = !state.jobs.open
			render()
		},
		async 'job-stop'(el) {
			await post('/api/jobs', { stop: el.dataset.job }).catch(() => {})
		},
	}

	return { feed, look, actions }
}
