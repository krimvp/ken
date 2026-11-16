// The Live view. One status line with its controls and one quiet line for the pace and the spend come first, so the
// newest note leads. Under it, what ken sees now, read from git and the saved session with no model, then every older
// note folded to one line, so twenty notes stay calm.
import { at, esc, prose, short, when } from '../views/format.js'
import { noteHeadHtml, noteHtml } from './note.js'

// The look of each status, here and in the header: on, paused, off, or writing a note.
export function liveLook(status) {
	if (status === 'snapshot' || status === 'watching') return 'on'
	return status
}

function statusText(live) {
	switch (live.status) {
		case 'off':
			return '<strong>Off.</strong> Turn it on and ken writes a note each time a commit lands or the work goes quiet. Each note is a model call.'
		case 'paused':
			return '<strong>Paused.</strong> ken still shows what changed, and writes no note until you resume.'
		case 'snapshot':
			return '<strong>On.</strong> ken is copying your uncommitted work, to quote it.'
		case 'writing': {
			const about = live.about
			if (!about) return '<strong>Writing a note</strong> on the last change.'
			if (about.kind === 'uncommitted')
				return `<strong>Writing a note</strong> on your uncommitted work, ${when(about.at)}.`
			return `<strong>Writing a note</strong> on the commits up to <code>${short(about.head)}</code>.`
		}
		default:
			return '<strong>On.</strong> ken watches for commits and for edits that go quiet.'
	}
}

function controlsHtml(live) {
	if (live.status === 'off') {
		return '<button class="primary" data-act="live-on" data-key="live-on">Turn live on</button>'
	}
	const paused = live.status === 'paused'
	const toggle = paused
		? '<button class="primary" data-act="live-resume" data-key="live-resume">Resume</button>'
		: '<button class="quiet-button" data-act="live-pause" data-key="live-pause">Pause notes</button>'
	const busy = live.status === 'writing' || live.status === 'snapshot'
	return `${toggle}<button class="quiet-button" data-act="live-note-now" data-key="live-note-now"${busy ? ' disabled' : ''}>Write a note now</button><button class="link small" data-act="live-off" data-key="live-off">Turn off</button>`
}

function paceHtml({ pace, spent, since }) {
	const tokens = (spent.inputTokens + spent.outputTokens).toLocaleString('en-US')
	const notes = `${spent.notes} ${spent.notes === 1 ? 'note' : 'notes'}`
	return `<p class="live-pace">ken writes a note after each commit, and when you stop editing for ${pace.quietMs / 1000} seconds with at least ${pace.minLines} lines changed. At most 1 a minute and ${pace.perHour} an hour. Each note is a model call.${since ? ` Since ${when(since)}: ${notes}, ${tokens} tokens.` : ''}</p>`
}

function fileHtml(file) {
	const lines = [
		file.added > 0 ? `<span class="add">+${file.added}</span>` : '',
		file.removed > 0 ? `<span class="del">-${file.removed}</span>` : '',
	]
	const counted =
		file.change === 'deleted'
			? 'deleted'
			: file.added === null
				? 'binary or large'
				: file.change === 'new'
					? `new, ${file.added} ${file.added === 1 ? 'line' : 'lines'}`
					: lines.filter(Boolean).join(' ')
	return `<li class="live-item"><code>${esc(file.path)}</code> <span class="now-count">${counted}</span></li>`
}

function askHtml(ask, hidden) {
	if (ask.kind === 'off') return '<p class="now-ask">ken reads no saved sessions: KEN_SESSIONS is off.</p>'
	if (ask.kind === 'none') return '<p class="now-ask">No saved session of your coding agent yet.</p>'
	const toggle = `<button class="link small" data-act="ask-hide" data-key="ask-hide" aria-expanded="${!hidden}">${hidden ? 'Show it' : 'Hide it'}</button>`
	if (hidden) return `<p class="now-ask">Your last request to Claude Code is hidden. ${toggle}</p>`
	return `<div class="now-ask">
		<p>You last asked Claude Code ${at(ask.at)}: ${toggle}</p>
		<blockquote>${prose(ask.text)}</blockquote>
	</div>`
}

function nowHtml(now, hideAsk) {
	const total = now.files.length + now.moreFiles
	const files =
		total === 0
			? '<p>No uncommitted changes.</p>'
			: `<ul class="now-files">${now.files.map(fileHtml).join('')}${now.moreFiles > 0 ? `<li class="muted">and ${now.moreFiles} more</li>` : ''}</ul>`
	const commits = now.commits
		.map(
			(c) =>
				`<li><code>${short(c.hash)}</code> ${prose(c.subject)} <span class="now-when">· ${when(c.date)}</span></li>`,
		)
		.join('')
	return `<section class="now" aria-labelledby="now-head">
		<h2 id="now-head">Now</h2>
		<p class="now-from">Read from git and your agent's saved session on this machine. No model call.</p>
		${total > 0 ? `<p class="now-sub">${total} ${total === 1 ? 'file' : 'files'} with uncommitted changes</p>` : ''}
		${files}
		<p class="now-sub">${now.branch ? `On <code>${esc(now.branch)}</code>` : 'HEAD is not on a branch'}${commits ? ', last commits:' : ''}</p>
		${commits ? `<ul class="now-commits">${commits}</ul>` : ''}
		${askHtml(now.ask, hideAsk)}
	</section>`
}

// A note about uncommitted work whose work a later note on commits took in: that note starts where its HEAD was.
function committedIn(view, notes) {
	const about = view.entry.about
	if (about.kind !== 'uncommitted') return null
	const later = notes.find(
		(other) =>
			other.entry.askedAt > view.entry.askedAt &&
			other.entry.about.kind === 'commits' &&
			other.entry.about.base === about.head,
	)
	return later?.entry.about.head ?? null
}

// seen is when the newest note was that the reader saw on their last visit, so the notes after it are marked new.
export function liveViewHtml(live, ui, unfolded, canAsk, problem, { seen, hideAsk }) {
	if (problem)
		return `<section class="map-view live-view"><h1>Live</h1><p class="notice" role="alert">${esc(problem)}</p></section>`
	if (!live)
		return '<section class="map-view live-view"><h1>Live</h1><p class="muted">Reading the project.</p></section>'
	const tagsOf = (view) => ({
		isNew: seen !== null && view.entry.askedAt > seen,
		committedIn: committedIn(view, live.notes),
	})
	const [newest, ...older] = live.notes
	const folded = older.map((view, i) => {
		const tags = tagsOf(view)
		const id = esc(view.entry.id)
		if (unfolded.has(view.entry.id)) {
			return `<li class="live-item">${noteHtml(view, `n${i + 1}`, ui, canAsk, tags)}<button class="link small ln-fold" data-act="note-unfold" data-id="${id}" data-key="unfold-${id}">Fold it</button></li>`
		}
		const gist = view.entry.outcome === 'answered' ? prose(view.entry.answer.summary) : 'No checked note.'
		return `<li class="live-item"><button class="ln-folded" data-act="note-unfold" data-id="${id}" data-key="unfold-${id}" aria-expanded="false"><span class="ln-line">${noteHeadHtml(view.entry, tags)} <span class="ln-gist">${gist}</span></span></button></li>`
	})
	const look = liveLook(live.status)
	return `<section class="live-view">
		<h1 class="visually-hidden">Live</h1>
		<div class="live-top">
			<p class="live-status is-${look}" role="status"><span class="live-mark" aria-hidden="true"></span><span>${statusText(live)}</span></p>
			<div class="live-controls">${controlsHtml(live)}</div>
		</div>
		${live.status === 'off' ? '' : paceHtml(live)}
		${live.said ? `<p class="map-said" role="status">${esc(live.said)}</p>` : ''}
		${live.notes.length > 0 ? `<h2 class="ln-count">Notes (${live.notes.length}), newest first</h2>` : ''}
		${newest ? noteHtml(newest, 'n0', ui, canAsk, tagsOf(newest)) : '<p class="t-empty">No notes yet. ken writes the first when a commit lands or the work goes quiet.</p>'}
		${nowHtml(live.now, hideAsk)}
		${folded.length > 0 ? `<h2 class="ln-count">Earlier notes</h2><ol class="live-notes folded">${folded.join('')}</ol>` : ''}
		${live.notes.length > 0 ? '<p class="live-foot">The agent wrote each note; ken checked that each quote is in its file. Notes stay in your history on this machine. A note on commits also adds its decisions to the project record; a note on uncommitted work adds nothing.</p>' : ''}
		<p class="actions"><button class="quiet-button" data-act="live-close" data-key="live-close">Back</button></p>
	</section>`
}
