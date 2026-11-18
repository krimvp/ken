// The Live view. One status line with its controls and one quiet line for the spend come first, so the newest note
// leads; how ken paces notes opens from that line. On a phone one line of what ken sees now comes before the note. Under
// the note, what ken sees now in full, read from git and the saved session with no model, then every older note folded
// to one line, so twenty notes stay calm.
import { at, count, esc, prose, short, when, withCost } from '../views/format.js'
import { gistOf, noteHeadHtml, noteHtml } from './note.js'

// The look of each status, here and in the header: on, paused, off, or writing a note.
export function liveLook(status) {
	if (status === 'snapshot' || status === 'watching') return 'on'
	return status
}

function statusText(live) {
	switch (live.status) {
		case 'off':
			return '<strong>Off.</strong> Turn it on and ken writes a note each time a commit lands or the work goes quiet. Each note is a model run.'
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
		return '<button class="primary" data-act="live-on" data-key="live-on">Turn Live on</button>'
	}
	const paused = live.status === 'paused'
	const toggle = paused
		? '<button class="primary" data-act="live-resume" data-key="live-resume">Resume</button>'
		: '<button class="quiet-button" data-act="live-pause" data-key="live-pause">Pause notes</button>'
	const busy = live.status === 'writing' || live.status === 'snapshot'
	const now = `<button class="quiet-button" data-act="live-note-now" data-key="live-note-now"${busy ? ' disabled' : ''}>Write a note now</button>`
	return `${toggle}${withCost(now)}<button class="link small" data-act="live-off" data-key="live-off">Turn off</button>`
}

// While paused ken writes no note, so the line leaves out how it paces them.
function paceHtml({ status, pace, spent, since }, open) {
	const tokens = (spent.inputTokens + spent.outputTokens).toLocaleString('en-US')
	// Each note is one model run, the unit the rest of the page counts in.
	const notes = `${count(spent.notes, 'note', 'notes')}, ${count(spent.notes, 'model run', 'model runs')}`
	const spend = since ? `Since you turned Live on ${at(since)}: ${notes}, ${tokens} tokens. ` : ''
	if (status === 'paused') return spend ? `<p class="live-pace">${spend}</p>` : ''
	const toggle = `<button class="link small" data-act="pace" data-key="pace" aria-expanded="${open}">${open ? 'Hide how ken paces notes' : 'How ken paces notes'}</button>`
	const how = open
		? `<p class="live-pace">ken writes a note after each commit, and when the files go quiet for ${pace.quietMs / 1000} seconds with at least ${pace.minLines} lines changed. At most 1 a minute and ${pace.perHour} an hour. Each note is a model run.</p>`
		: ''
	return `<p class="live-pace">${spend}${toggle}</p>${how}`
}

// The Now block in one line, for a phone, where the full block comes after the newest note.
function nowLineHtml(now) {
	const total = now.files.length + now.moreFiles
	const branch = now.branch ? `on <code>${esc(now.branch)}</code>` : 'HEAD is not on a branch'
	const files = total === 0 ? 'nothing uncommitted' : `${total} ${total === 1 ? 'file' : 'files'} uncommitted`
	const more = total === 0 ? 'See the last commits' : 'See the files'
	return `<p class="now-line narrow-only">Now: ${branch}, ${files}. <a class="link" href="#now-head">${more}</a></p>`
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
	if (ask.kind === 'none')
		return '<p class="now-ask">ken finds no saved session of your coding agent for this folder.</p>'
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
		<p class="now-from">Read from git and your coding agent's saved session on this machine. No model run.</p>
		${total > 0 ? `<p class="now-sub">${total} ${total === 1 ? 'file' : 'files'} with uncommitted changes</p>` : ''}
		${files}
		<p class="now-sub">${now.branch ? `On <code>${esc(now.branch)}</code>` : 'HEAD is not on a branch'}${commits ? ', last commits:' : ''}</p>
		${commits ? `<ul class="now-commits">${commits}</ul>` : ''}
		${askHtml(now.ask, hideAsk)}
	</section>`
}

// A note about uncommitted work whose work a later note on commits took in: that note starts where its HEAD was. With no
// such note, as for the newest, the Now block tells: HEAD moved on from its HEAD and nothing is left uncommitted.
function committedIn(view, notes, now) {
	const about = view.entry.about
	if (about.kind !== 'uncommitted') return null
	const later = notes.find(
		(other) =>
			other.entry.askedAt > view.entry.askedAt &&
			other.entry.about.kind === 'commits' &&
			other.entry.about.base === about.head,
	)
	if (later) return later.entry.about.head
	const movedOn = now.commits.findIndex((c) => c.hash === about.head) > 0
	return movedOn && now.files.length + now.moreFiles === 0 ? now.commits[0].hash : null
}

// seen is when the newest note was that the reader saw on their last visit, so the notes after it are marked new.
export function liveViewHtml(live, ui, unfolded, canAsk, problem, { seen, hideAsk }) {
	if (problem)
		return `<section class="map-view live-view"><h1>Live</h1><p class="notice" role="alert">${esc(problem)}</p></section>`
	if (!live)
		return '<section class="map-view live-view"><h1>Live</h1><p class="muted">Reading the project.</p></section>'
	const tagsOf = (view) => ({
		isNew: seen !== null && view.entry.askedAt > seen,
		committedIn: committedIn(view, live.notes, live.now),
	})
	const [newest, ...older] = live.notes
	const folded = older.map((view, i) => {
		const tags = tagsOf(view)
		const id = esc(view.entry.id)
		if (unfolded.has(view.entry.id)) {
			return `<li class="live-item">${noteHtml(view, `n${i + 1}`, ui, canAsk, tags)}<button class="link small ln-fold" data-act="note-unfold" data-id="${id}" data-key="unfold-${id}">Fold it</button></li>`
		}
		const gist = view.entry.outcome === 'answered' ? prose(gistOf(view.entry)) : 'No note.'
		return `<li class="live-item"><button class="ln-folded" data-act="note-unfold" data-id="${id}" data-key="unfold-${id}" aria-expanded="false"><span class="ln-line">${noteHeadHtml(view.entry, tags)} <span class="ln-gist">${gist}</span></span></button></li>`
	})
	const look = liveLook(live.status)
	const empty = `<div class="live-empty">
		<h2>No notes yet</h2>
		<p class="live-empty-text">ken writes the first note ${live.status === 'off' ? 'after you turn Live on, ' : ''}when a commit lands or the work goes quiet. Each note says what changed and why, with the code it rests on.</p>
	</div>`
	return `<section class="live-view">
		<h1 class="live-title">Live</h1>
		<p class="live-lead">Notes on the work as it happens, written by ken while your coding agent works here.</p>
		<div class="live-top">
			<p class="live-status is-${look}" role="status"><span class="live-mark" aria-hidden="true"></span><span>${statusText(live)}</span></p>
			<div class="live-controls">${controlsHtml(live)}</div>
		</div>
		${live.status === 'off' ? '' : paceHtml(live, ui.paceOpen)}
		${live.said ? `<p class="map-said" role="status">${esc(live.said)}</p>` : ''}
		${nowLineHtml(live.now)}
		${live.notes.length > 0 ? `<h2 class="ln-count">Notes (${live.notes.length}), newest first</h2>` : ''}
		${newest ? noteHtml(newest, 'n0', ui, canAsk, tagsOf(newest)) : empty}
		${nowHtml(live.now, hideAsk)}
		${folded.length > 0 ? `<h2 class="ln-count">Earlier notes</h2><ol class="live-notes folded">${folded.join('')}</ol>` : ''}
		${live.notes.length > 0 ? '<p class="live-foot">Notes stay in your history on this machine. A note on commits also adds its decisions to the project record; a note on uncommitted work adds nothing.</p>' : ''}
	</section>`
}
