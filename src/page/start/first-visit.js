// What the project is, at the top of Home on every visit: in its own words, from plain code in the first second; then
// what ken's model is doing about it and how long that takes; and, once the model has named the parts, its one line
// on the project, its parts and the main process, in the same place. For a reader who has been here before it is
// smaller: the quote shorter, fewer facts, and the model's line with the main process in place of the parts.
import { jobLineHtml, live } from '../jobs/jobs.js'
import { partClass } from '../project/part-colours.js'
import { icon } from '../shell/icons.js'
import { count, esc, prose } from '../views/format.js'

// What the run that names the parts costs the reader, said before it starts and while it runs.
const NAMING_TAKES = 'a few minutes'
// The job of the server's queue that names the parts of the top level.
const NAMING_JOB = 'parts:'

const jobLineClock = (job) => {
	const acts = job.state.actions === 1 ? '1 action' : `${job.state.actions} actions`
	return `<span class="k-job-clock k-num" data-since="${job.state.startedAt}">${Math.round((Date.now() - job.state.startedAt) / 1000)} s so far</span>, ${acts}`
}
const SHOWN_LANGUAGES = 4
const SHOWN_ENTRIES = 4
const DAY = 86_400_000

const ago = (iso, now = Date.now()) => {
	const days = Math.floor((now - Date.parse(iso)) / DAY)
	return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

const lines = (quote) =>
	quote.startLine === quote.endLine ? `line ${quote.startLine}` : `lines ${quote.startLine} to ${quote.endLine}`

function wordsHtml(first, name) {
	const said = first.name?.text ?? name
	const description = first.description
		? `<p class="k-first-desc">${esc(first.description.text)} <span class="k-first-from">${esc(first.description.file)}</span></p>`
		: ''
	const quote = first.about
		? `<figure class="k-first-quote"><blockquote>${esc(first.about.text)}</blockquote><figcaption>${icon('file')}<span>${esc(first.about.path)}, ${lines(first.about)}</span></figcaption></figure>`
		: '<p class="k-first-none">The project has no README that says what it is.</p>'
	return `<div class="k-first-words"><p class="k-eyebrow">What it is, in its own words</p><h2 id="first-title">${esc(said)}</h2>${description}${quote}</div>`
}

function languagesHtml(languages, most) {
	const total = languages.reduce((sum, each) => sum + each.lines, 0)
	if (total === 0) return ''
	const shown = languages.slice(0, most).map((each) => {
		const share = Math.max(1, Math.round((each.lines / total) * 100))
		return `<li><span class="k-lang-name">${esc(each.name)}</span><span class="k-lang-bar" style="--share:${share}%" aria-hidden="true"></span><span class="k-num">${share}%</span></li>`
	})
	return `<div><dt>Written in</dt><dd><ul class="k-langs">${shown.join('')}</ul></dd></div>`
}

function entriesHtml(entries, most) {
	if (entries.length === 0) return ''
	const said = (each) =>
		each.kind === 'script'
			? `<code>npm run ${esc(each.name)}</code>`
			: each.kind === 'main'
				? `<code>${esc(each.runs)}</code> is what other code loads`
				: `<code>${esc(each.name)}</code> runs <code>${esc(each.runs)}</code>`
	const shown = entries.slice(0, most).map((each) => `<li>${said(each)}</li>`)
	const more = entries.length > most ? `<li class="k-muted">and ${entries.length - most} more</li>` : ''
	return `<div><dt>Started by</dt><dd><ul class="k-first-list">${shown.join('')}${more}</ul></dd></div>`
}

function factsHtml(first, small) {
	const { size, activity, deploy } = first
	const deployed =
		deploy.length === 0
			? ''
			: `<div><dt>Deployed by</dt><dd><ul class="k-first-list">${deploy.map((each) => `<li><code>${esc(each.file)}</code> ${esc(each.holds)}</li>`).join('')}</ul></dd></div>`
	const lately =
		activity.commits === 0
			? `No commits in the last ${activity.days} days${activity.last ? `. The newest is from ${ago(activity.last)}` : ''}.`
			: `${count(activity.commits, 'commit', 'commits')} in the last ${activity.days} days, by ${count(activity.authors, 'person', 'people')}. The newest is from ${ago(activity.last)}.`
	return `<dl class="k-first-facts">
		<div><dt>Size</dt><dd>${count(size.files, 'file', 'files')}, ${count(size.lines, 'line', 'lines')}</dd></div>
		${languagesHtml(first.languages, small ? 2 : SHOWN_LANGUAGES)}${entriesHtml(first.entries, small ? 2 : SHOWN_ENTRIES)}${deployed}
		<div><dt>Lately</dt><dd>${lately}</dd></div>
	</dl>`
}

// Why the last run named nothing: the reader stopped it, or it failed.
const endedLine = (ended) =>
	ended.outcome === 'stopped'
		? ' You stopped the last run.'
		: ` The last run named nothing${ended.error ? `: ${esc(ended.error)}` : '.'}`

// What ken does next, by the state of the run that names the parts: one the reader pressed, or the job ken started by
// itself when the project was first opened.
function nextHtml({ look, env, home }) {
	const run = env.running?.onHome
	const reading = '<b>ken is reading the project to name its main parts and draw how it works.</b>'
	if (run?.kind === 'name') {
		const tools = env.running.q.steps.filter((step) => step.kind === 'tool').length
		return `<div class="k-first-next is-running" role="status"><span class="k-spin" aria-hidden="true"></span><p>${reading} That takes ${NAMING_TAKES}. <span class="k-clock k-num">${Math.round(env.seconds)} s so far, ${count(tools, 'action', 'actions')}</span>. You can use the pages meanwhile.</p><button class="k-btn is-quiet" data-act="stop" data-key="first-stop">Stop</button></div>`
	}
	const job = env.jobs?.find((each) => each.key === NAMING_JOB && ['waiting', 'running'].includes(each.state.kind))
	if (job) {
		const stop = `<button class="k-btn is-quiet" data-act="job-stop" data-job="${NAMING_JOB}" data-key="first-stop">Stop</button>`
		const when =
			job.state.kind === 'running'
				? `That takes ${NAMING_TAKES}. ${jobLineClock(job)}.`
				: `It starts when the run ahead of it ends.`
		return `<div class="k-first-next is-running" role="status"><span class="k-spin" aria-hidden="true"></span><p>${reading} ${when} ken started this by itself, since you opened the project for the first time. You can use the pages meanwhile.</p>${stop}</div>`
	}
	if (env.model?.kind !== 'ok') {
		const example = env.model?.example
			? ` For example, start it with <code>${esc(env.model.example)} ken open</code>.`
			: ''
		return `<div class="k-first-next"><p><b>This is what plain code found in git.</b> To have ken's model name the main parts and draw how they work, give ken a model.${example}</p></div>`
	}
	const why = env.off ? esc(env.off) : `One run of ken's model, ${NAMING_TAKES}.`
	const where = look.boxes.length > 0 ? ' Until then the Architecture page shows the folders.' : ''
	const ended = home.ended?.kind === 'nothing' ? endedLine(home.ended) : ''
	return `<div class="k-first-next"><p><b>ken's model has not named the main parts yet.</b>${ended}${where}</p><button class="k-btn" data-act="first-name" data-key="first-name"${env.off ? ' disabled' : ''}>Ask ken to name them</button><span class="k-muted">${why}</span></div>`
}

// The main process: a drawn one as a route through its parts, or else the one ken's model named, offered to draw.
function processHtml({ look, concepts, briefOf, env, routeHtml }) {
	const drawn = concepts.find((each) => each.kind === 'process')
	if (drawn) {
		const stops = (briefOf(drawn.id)?.steps ?? []).map((step) =>
			step.part ? partClass(step.part.slice(step.part.lastIndexOf(':') + 1)) : '',
		)
		return `<button class="k-first-proc" data-act="brief-open" data-concept="${esc(drawn.id)}" data-key="first-proc">${routeHtml(stops)}<span><span class="k-eyebrow">The main process</span><b>${prose(drawn.name)}</b></span></button>`
	}
	const flow = look.named.flows[0]
	if (!flow) return ''
	const drawing = env.jobs?.find((job) => job.kind === 'process' && live(job))
	if (drawing) {
		return `<div class="k-first-flow"><p>The main process, as ken's model named it: <b>${prose(flow)}</b>.</p>${jobLineHtml(drawing, 'drawing it')}</div>`
	}
	const cost = env.off ? esc(env.off) : "One run of ken's model."
	return `<p class="k-first-flow">The main process, as ken's model named it: <b>${prose(flow)}</b>. <button class="k-link" data-act="first-draw" data-key="first-draw"${env.off ? ' disabled' : ''}>Draw it</button> <span class="k-muted">${cost}</span></p>`
}

// view is the Home's view, with first as GET /api/first-look sends it and env as the page's. mapHtml draws the parts
// small, and routeHtml a process.
export function firstVisitHtml(view, { mapHtml, routeHtml }) {
	const { first, project, look, small } = view
	const line = () =>
		`<div class="k-first-line"><p class="k-eyebrow">In ken's model's words</p><p class="k-first-about">${prose(look.named.about ?? '')}${small ? ' <button class="k-link" data-act="project-brief" data-key="home-about">Open the project\'s brief</button>' : ''}</p>${processHtml({ ...view, routeHtml })}</div>`
	const said = !look
		? '<p class="k-first-next" role="status">Reading the folders from git.</p>'
		: !look.named
			? nextHtml(view)
			: small
				? `<div class="k-first-named">${line()}</div>`
				: `<div class="k-first-named"><div class="k-first-map">${mapHtml(look, { lit: [], key: 'first-map' })}</div>${line()}<button class="k-btn is-big" data-act="go-page" data-page="architecture" data-key="first-primary">See how it works${icon('right')}</button></div>`
	const read = first?.kind === 'ok'
	const facts = read ? factsHtml(first.look, small) : ''
	const words = read
		? wordsHtml(first.look, project)
		: `<div class="k-first-words"><p class="k-eyebrow">What it is, in its own words</p><h2 id="first-title">${esc(project)}</h2><p class="k-first-none">${first?.kind === 'failed' ? `ken could not read it. ${esc(first.message)}` : 'Reading the README and the manifests.'}</p></div>`
	return `<section class="k-tile k-first${small ? ' is-small' : ''}" aria-labelledby="first-title">${words}${facts}${said}</section>`
}
