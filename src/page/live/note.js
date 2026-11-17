// One live note: what it is about, then the model's words and the cards it showed, as a reply in the thread shows
// them. What it cost opens on request. Every older note folds to one line. ken checked each card, at the commit or in
// its own snapshot of uncommitted work.
import { count, duration, esc, prose, short, when, withCost } from '../views/format.js'
import { replyHtml } from '../views/reply.js'

// What a note explains: "Commit 7c7d8f5" with its subject, or "Uncommitted work, 06:40". A note that failed has no
// commits to name, so it names the range.
export function aboutHtml(about, commits = []) {
	if (about.kind === 'uncommitted') return `Uncommitted work, ${when(about.at)}`
	const newest = commits.find((c) => c.hash === about.head) ?? commits[0]
	const subject = newest ? ` <q class="subject">${esc(newest.subject)}</q>` : ''
	if (commits.length === 1) return `Commit <code>${short(about.head)}</code>${subject}`
	if (commits.length > 1) return `${commits.length} commits, up to <code>${short(about.head)}</code>${subject}`
	return `Commits after <code>${short(about.base)}</code>, up to <code>${short(about.head)}</code>`
}

function commitsOf(entry) {
	return entry.outcome === 'answered' ? (entry.reply.change?.commits ?? []) : []
}

// The first words of a note, for its folded line.
export function gistOf(entry) {
	const words = entry.reply.items.find((item) => item.kind === 'words')
	return words ? words.text.split(/(?<=[.!?])\s/)[0] : 'A note with cards only.'
}

// The head line of a note, used for a folded note too. tags holds "New" and "Committed since".
export function noteHeadHtml(entry, tags) {
	const time = entry.about.kind === 'commits' ? ` <span class="ln-time">· ${when(entry.askedAt)}</span>` : ''
	const isNew = tags.isNew ? '<span class="ln-new">New</span> ' : ''
	const committed = tags.committedIn
		? ` <span class="ln-tag">Committed since, in <code>${short(tags.committedIn)}</code></span>`
		: ''
	return `${isNew}<span class="ln-about">${aboutHtml(entry.about, commitsOf(entry))}</span>${time}${committed}`
}

function costHtml(entry) {
	const parts = []
	if (entry.usage) {
		const tokens = entry.usage.inputTokens + entry.usage.outputTokens
		parts.push(`This note took ${duration(entry.usage.seconds)} and ${tokens.toLocaleString('en-US')} tokens.`)
	}
	const sent = entry.steps.filter((step) => step.kind === 'sent-back').length
	if (sent > 0) parts.push(`ken sent ${count(sent, 'card', 'cards')} back to its model first.`)
	return parts.length === 0 ? '' : `<p class="ln-cost">${parts.join(' ')}</p>`
}

// key tells one note apart from another, so opening a quote opens it in this note alone.
export function noteHtml(view, key, ui, canAsk, tags) {
	const { entry } = view
	if (entry.outcome !== 'answered') {
		return `<article class="live-note failed"><p class="ln-head">${noteHeadHtml(entry, tags)}</p>
			<p class="muted small">${prose(view.noNote ?? '')}</p></article>`
	}
	const open = ui.openNotes.has(entry.id)
	const more = entry.usage
		? `<button class="link small" data-act="note-more" data-id="${esc(entry.id)}" data-key="more-${key}" aria-expanded="${open}">${open ? 'Hide' : 'What it cost'}</button>`
		: ''
	const ask = canAsk
		? withCost(
				`<button class="quiet-button" data-act="note-question" data-id="${esc(entry.id)}" data-key="ask-${key}">Open as a question</button>`,
				'One more model run.',
			)
		: ''
	const q = { ...entry, topics: [] }
	return `<article class="live-note">
		<p class="ln-head">${noteHeadHtml(entry, tags)}</p>
		${replyHtml(q, key, ui, { running: false, inThread: false })}
		${open ? costHtml(entry) : ''}
		<p class="ln-foot">${more}${ask}</p>
	</article>`
}
