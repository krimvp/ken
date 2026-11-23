// What ken is doing by itself, as GET /api/jobs streams it: a quiet line in the bar with how many runs wait, the list it
// opens, the line a brief shows while ken is reading its part, and what the reader looks at, sent back so that it goes
// first. When a run ends, the pages read what it made, so a brief fills in with no reload.
import { count, duration, esc, prose } from '../views/format.js'

// list is the jobs as the server sent them last, and left what is left to do by its count, { jobs, seconds }, when
// the server says. open says the list is unfolded. sent is what the page last said the reader looks at.
export const freshJobs = () => ({ list: [], left: null, open: false, sent: null })

const RETRY_MS = 3000

export const live = (job) => job.state.kind === 'waiting' || job.state.kind === 'running'

export function inLine(n) {
	const teen = n % 100 >= 11 && n % 100 <= 13
	const end = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
	return `${n}${end} in line`
}

// A wait in words: "under a minute", "about 3 minutes".
export function aboutTime(seconds) {
	if (seconds < 50) return 'under a minute'
	const minutes = Math.round(seconds / 60)
	return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`
}

// What a job does, as a whole sentence. The server sends one, such as "ken is explaining Core."; an older server sent
// what ken does, such as "Explaining Core", which reads after "ken is".
export function sentenceOf(job) {
	const { title } = job
	return /^ken\b/.test(title) ? title : `ken is ${title.charAt(0).toLowerCase()}${title.slice(1)}.`
}

// The clock of a running job; the page's tick moves it every second.
function clockHtml(job) {
	const since = job.state.startedAt
	return `<span class="k-job-clock k-num" data-since="${since}">${duration((Date.now() - since) / 1000)} so far</span>`
}

// Where a waiting job stands: its place, and when it starts once the server says.
const waitWords = (job) => `${inLine(job.place)}${job.startsIn == null ? '' : `, starts in ${aboutTime(job.startsIn)}`}`

// Why a job failed, and when ken tries it again, once the server says; else why it stopped.
function failedWords(job) {
	if (!job.reason) return `Stopped: ${esc(job.state.why)}`
	const reason = `${job.reason.charAt(0).toUpperCase()}${job.reason.slice(1)}${/[.!?]$/.test(job.reason) ? '' : '.'}`
	return `${esc(reason)}${job.retryIn == null ? '' : ` ken tries again in ${aboutTime(job.retryIn)}.`}`
}

function stateHtml(job) {
	const { state } = job
	if (state.kind === 'running') return `${clockHtml(job)}, ${count(state.actions, 'action', 'actions')}`
	if (state.kind === 'waiting') return waitWords(job)
	if (state.kind === 'done') return state.skipped ? 'Already known' : 'Done'
	return failedWords(job)
}

// A job ken started by itself that the reader stopped, or that ended with nothing, and that ken will not try again by
// itself: the reader can start it again.
export const canStartAgain = (job) => job.by === 'ken' && job.state.kind === 'failed' && job.retryIn == null

// Whether a job that ended is the last of its thing: no later job for the same thing waits, runs or ended.
export const latest = (list, job) =>
	!list.some((other) => other.key === job.key && live(other)) && list.findLast((other) => other.key === job.key) === job

// The jobs ken holds now, for the page: the one the reader looks at, any that wait, and the runs that ended.
export function jobOf(jobs, concept) {
	return jobs.find((job) => job.concept === concept && live(job)) ?? null
}

// The quiet line in the bar, and the list under it when the reader opened it: what ken does now as a sentence, cut at
// a word to fit, how many runs are left with the one under way and about how long they take, and "done" once
// nothing waits. Nothing shows before ken had anything to do.
export function jobsLineHtml(jobs) {
	const running = jobs.list.filter((job) => job.state.kind === 'running')
	const waiting = jobs.list.filter((job) => job.state.kind === 'waiting').length
	const ended = jobs.list.filter((job) => !live(job))
	if (jobs.list.length === 0 && !jobs.open) return ''
	const busy = running.length + waiting > 0
	const retry = Math.min(...ended.map((job) => job.retryIn ?? Number.POSITIVE_INFINITY))
	const now =
		running.length > 0
			? sentenceOf(running[0])
			: busy
				? 'ken is about to read more.'
				: Number.isFinite(retry)
					? `ken is done for now. It tries again in ${aboutTime(retry)}.`
					: 'ken is done.'
	// The runs left count the one under way, as the canvas counts the parts ken is explaining.
	const seconds = busy ? jobs.left?.seconds : null
	const rest = busy
		? [count(running.length + waiting, 'run left', 'runs left'), seconds ? aboutTime(seconds) : ''].filter(Boolean)
		: []
	const label = rest.length > 0 ? `${now} ${rest.join(', ')}.` : now
	const line = `<button class="k-jobs-line${busy ? '' : ' is-done'}" data-act="jobs-open" data-key="jobs-open" title="${esc(label)}" aria-label="Queue: ${esc(label)}" aria-expanded="${jobs.open}" aria-controls="jobs-list"><span class="k-jobs-dot" aria-hidden="true"></span><span class="k-jobs-short">Queue</span><span class="k-jobs-now" data-fit="${esc(now)}">${esc(now)}</span>${rest.length > 0 ? `<span class="k-jobs-wait k-num" data-fit="${rest.join(', ')}">${rest.join(', ')}</span>` : ''}</button>`
	if (!jobs.open) return line
	const row = (job) => {
		const stop = live(job)
			? `<button class="k-link" data-act="job-stop" aria-label="Stop: ${esc(sentenceOf(job))}" data-job="${esc(job.key)}" data-key="job-stop-${esc(job.key)}">Stop</button>`
			: canStartAgain(job) && latest(jobs.list, job)
				? `<button class="k-link" data-act="job-again" aria-label="Start again: ${esc(sentenceOf(job))}" data-jobs="${esc(JSON.stringify([job.key]))}" data-key="job-again-${esc(job.key)}">Start again</button>`
				: ''
		const by = job.by === 'reader' ? '<span class="k-job-by">You asked</span>' : ''
		return `<li class="k-job is-${job.state.kind}"><span class="k-job-title">${prose(sentenceOf(job))}</span>${by}<span class="k-job-state">${stateHtml(job)}</span>${stop}</li>`
	}
	const shown = [...jobs.list.filter(live), ...ended.slice(-5).reverse()]
	const list = shown.length
		? `<ol class="k-jobs-rows">${shown.map(row).join('')}</ol>`
		: '<p class="k-muted">ken has nothing left to read.</p>'
	return `${line}<div class="k-jobs-list" id="jobs-list"><p class="k-eyebrow">What ken reads by itself</p>${list}<p class="k-muted k-jobs-note">What you ask goes first. Each is one run of ken's model.</p></div>`
}

// What a brief, or a page, says while ken reads its part, answers its question or draws it by itself: "ken is
// reading this part now, 40 s so far." or "ken is reading this part: 3rd in line, starts in about 2 minutes."
export function jobLineHtml(job, what, tag = 'p') {
	const said =
		job.state.kind === 'running'
			? `<span class="k-spin" aria-hidden="true"></span><span>ken is ${what} now, ${clockHtml(job)}.</span>`
			: `<span>ken is ${what}: ${waitWords(job)}.</span>`
	return `<${tag} class="k-job-says" role="status">${said}</${tag}>`
}

// app is the page: its state, render, post, linesOf, and followAsked, which is given the first list the page reads;
// made is told the jobs that just made something.
export function jobsActions(app, made) {
	const { state, render, post, linesOf, followAsked } = app
	let first = true

	function take({ jobs, left }) {
		if (first) void followAsked(jobs)
		first = false
		const before = new Map(state.jobs.list.map((job) => [job.key, job.state.kind]))
		const focused = document.activeElement
		const inQueue = focused?.closest('#jobs')
		state.jobs.list = jobs
		state.jobs.left = left ?? null
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
				for await (const line of linesOf(response.body)) take(JSON.parse(line))
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
		async 'job-again'(el) {
			for (const key of JSON.parse(el.dataset.jobs)) await post('/api/jobs', { again: key }).catch(() => {})
		},
	}

	return { feed, look, actions }
}
