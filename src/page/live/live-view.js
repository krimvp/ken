// The Live view: what ken sees now, read from git and the saved session with no model, the controls, the pace and what
// ken spent in one quiet line, then the notes ken wrote as the work moved, newest first. The newest notes show whole;
// older ones fold to their head line, so twenty notes stay calm.
import { esc, prose, short } from '../views/format.js'
import { aboutHtml, clock, noteHeadHtml, noteHtml } from './note.js'

const OPEN_NOTES = 3

function statusHtml(live) {
	switch (live.status) {
		case 'off':
			return 'Off. Turn it on and ken writes a short note each time a commit lands or the work goes quiet. Each note is a model call.'
		case 'paused':
			return 'Paused. ken still shows what changed, and writes no note until you resume.'
		case 'snapshot':
			return 'Watching. ken is copying the uncommitted work into its own store, to quote it.'
		case 'writing':
			return `Writing a note on ${live.about ? aboutHtml(live.about).replace(/^C|^U/, (c) => c.toLowerCase()) : 'the last change'}.`
		default:
			return 'Watching. A note comes when a commit lands, or when the work has been quiet for a moment.'
	}
}

function controlsHtml(live) {
	if (live.status === 'off') {
		return '<button class="primary" data-act="live-on" data-key="live-on">Turn live on</button>'
	}
	const paused = live.status === 'paused'
	const toggle = paused
		? '<button class="primary" data-act="live-resume" data-key="live-resume">Resume</button>'
		: '<button class="quiet-button" data-act="live-pause" data-key="live-pause">Pause</button>'
	const busy = live.status === 'writing' || live.status === 'snapshot'
	return `${toggle}<button class="quiet-button" data-act="live-note-now" data-key="live-note-now"${busy || paused ? ' disabled' : ''}>Write a note now</button><button class="link small" data-act="live-off" data-key="live-off">Turn off</button>`
}

function paceHtml({ pace, spent }) {
	const tokens = (spent.inputTokens + spent.outputTokens).toLocaleString('en-US')
	const rule = `A note for each commit, or after ${pace.quietMs / 1000} s without edits once ${pace.minLines} lines changed; at most one a minute and ${pace.perHour} an hour.`
	const cost =
		spent.notes === 0
			? 'No notes yet this run.'
			: `This run: ${spent.notes} ${spent.notes === 1 ? 'note' : 'notes'}, ${tokens} tokens, ${Math.round(spent.seconds)} s.`
	return `<p class="live-pace small muted">${rule} ${cost}</p>`
}

function fileHtml(file) {
	const counted =
		file.change === 'deleted'
			? 'deleted'
			: file.added === null
				? 'binary or large'
				: file.change === 'new'
					? `new, ${file.added} ${file.added === 1 ? 'line' : 'lines'}`
					: `<span class="add">+${file.added}</span> <span class="del">-${file.removed}</span>`
	return `<li class="live-item"><code>${esc(file.path)}</code> <span class="now-count">${counted}</span></li>`
}

function askHtml(ask) {
	if (ask.kind === 'off') return '<p class="now-ask muted small">ken reads no saved sessions: KEN_SESSIONS is off.</p>'
	if (ask.kind === 'none') return '<p class="now-ask muted small">No saved session of your coding agent yet.</p>'
	return `<div class="now-ask">
		<p class="small muted">You last asked your agent, at ${clock(ask.at)}. From the session:</p>
		<blockquote>${prose(ask.text)}</blockquote>
	</div>`
}

function nowHtml(now) {
	const total = now.files.length + now.moreFiles
	const files =
		total === 0
			? '<p class="small muted">No uncommitted changes.</p>'
			: `<p class="small muted">${total} ${total === 1 ? 'file' : 'files'} with uncommitted changes</p>
			<ul class="now-files">${now.files.map(fileHtml).join('')}${now.moreFiles > 0 ? `<li class="muted">and ${now.moreFiles} more</li>` : ''}</ul>`
	const commits = now.commits.map((c) => `<li><code>${short(c.hash)}</code> ${prose(c.subject)}</li>`).join('')
	return `<section class="now" aria-labelledby="now-head">
		<h2 id="now-head">Now <span class="small muted">from git, no model</span></h2>
		<p class="now-branch">${now.branch ? `On <code>${esc(now.branch)}</code>` : 'HEAD is not on a branch'}</p>
		${files}
		${commits ? `<p class="small muted">Last commits</p><ul class="now-commits">${commits}</ul>` : ''}
		${askHtml(now.ask)}
	</section>`
}

export function liveViewHtml(live, ui, unfolded, canAsk, problem) {
	if (problem)
		return `<section class="map-view live-view"><h1>Live</h1><p class="notice" role="alert">${esc(problem)}</p></section>`
	if (!live)
		return '<section class="map-view live-view"><h1>Live</h1><p class="muted">Reading the project.</p></section>'
	const notes = live.notes.map((view, i) => {
		const open = i < OPEN_NOTES || unfolded.has(view.entry.id)
		if (open) return `<li class="live-item">${noteHtml(view, `n${i}`, ui, canAsk)}</li>`
		return `<li class="live-item"><button class="ln-folded" data-act="note-unfold" data-id="${esc(view.entry.id)}" data-key="unfold-${esc(view.entry.id)}"><span class="ln-head">${noteHeadHtml(view.entry)}</span><span class="ln-gist">${view.entry.outcome === 'answered' ? prose(view.entry.answer.summary) : 'No checked note.'}</span></button></li>`
	})
	const older =
		live.notes.length > OPEN_NOTES
			? `<p class="small muted live-older">Older notes are folded. Choose one to read it.</p>`
			: ''
	return `<section class="map-view live-view">
		<h1>Live</h1>
		<p class="lead" role="status">${statusHtml(live)}</p>
		<div class="live-controls">${controlsHtml(live)}</div>
		${paceHtml(live)}
		${live.said ? `<p class="map-said" role="status">${esc(live.said)}</p>` : ''}
		${nowHtml(live.now)}
		<h2 class="o-head">Notes${live.notes.length > 0 ? ` (${live.notes.length})` : ''}</h2>
		${live.notes.length === 0 ? '<p class="t-empty">No notes yet. ken writes the first when a commit lands or the work goes quiet.</p>' : ''}
		${live.notes.length > 0 ? `<ol class="live-notes">${notes.slice(0, OPEN_NOTES).join('')}</ol>` : ''}
		${older}
		${live.notes.length > OPEN_NOTES ? `<ol class="live-notes folded">${notes.slice(OPEN_NOTES).join('')}</ol>` : ''}
		<p class="actions"><button class="quiet-button" data-act="live-close" data-key="live-close">Back</button></p>
	</section>`
}
