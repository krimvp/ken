// One live note. At a glance it shows what it is about, the agent's lead, its risks and its decisions; its statements
// and what it cost open on request. Every older note folds to one line. The agent wrote the words; ken checked only
// that each quote is in its file, at the commit or in its own snapshot of uncommitted work.
import { decisionHtml } from '../views/answer.js'
import { copiesOf, count, duration, esc, label, prose, quoteRows, short, when, withCost } from '../views/format.js'

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
	return entry.outcome === 'answered' ? (entry.answer.change?.commits ?? []) : []
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
	const sent = entry.steps.filter((step) => step.kind === 'rejected').length
	if (sent > 0) parts.push(`ken rejected ${count(sent, 'draft', 'drafts')} first, because a quote did not match.`)
	return parts.length === 0 ? '' : `<p class="ln-cost">${parts.join(' ')}</p>`
}

// Each item shows its own label: a note is read alone, with no line above it to say what an unmarked one means.
function claimItems(claims, prefix, rows) {
	const numbered = claims.length > 1
	return claims
		.map(
			(claim, i) => `<li class="st${numbered ? '' : ' alone'}" id="item-${prefix}${i}">
			${numbered ? `<span class="st-n">${i + 1}</span>` : ''}
			<div>
				<p class="st-text">${label(claim.label)}${prose(claim.text)}</p>
				${quoteRows(claim.quotes, `${prefix}${i}`, rows)}
			</div>
		</li>`,
		)
		.join('')
}

// key tells the entries of one note apart from another's, so opening a quote opens it in this note alone.
export function noteHtml(view, key, ui, canAsk, tags) {
	const { entry, recorded } = view
	if (entry.outcome !== 'answered') {
		return `<article class="live-note failed"><p class="ln-head">${noteHeadHtml(entry, tags)}</p>
			<p class="muted small">ken could not write a checked note on this change. It shows nothing it did not check.</p></article>`
	}
	const a = entry.answer
	const rows = { ui, commits: false, copies: copiesOf(entry) }
	const decisions = [...recorded.filter((stored) => stored.kind === 'decision'), ...(entry.draft ?? [])]
	const risks = a.risks ?? []
	const open = ui.openNotes.has(entry.id)
	const all = new Set(decisions.map((d) => d.label))
	const statements = a.statements.length
	const more =
		statements === 0 && !entry.usage
			? ''
			: `<button class="link small" data-act="note-more" data-id="${esc(entry.id)}" data-key="more-${key}" aria-expanded="${open}">${open ? 'Hide' : statements === 0 ? 'What it cost' : statements === 1 ? 'Show the statement' : `Show the ${statements} statements`}</button>`
	const rest = open
		? `${statements > 0 ? `<ol class="ln-list">${claimItems(a.statements, `${key}s`, rows)}</ol>` : ''}${costHtml(entry)}`
		: ''
	const ask = canAsk
		? withCost(
				`<button class="quiet-button" data-act="note-question" data-id="${esc(entry.id)}" data-key="ask-${key}">Open as a question</button>`,
				'One more model run.',
			)
		: ''
	return `<article class="live-note">
		<p class="ln-head">${noteHeadHtml(entry, tags)}</p>
		<p class="small muted">The note from ken's model. ken checked its quotes.</p>
		<p class="summary">${prose(a.summary)}</p>
		${risks.length > 0 ? `<h3 class="ln-sub">${risks.length === 1 ? 'A risk to watch' : `${risks.length} risks to watch`}</h3><ol class="ln-list">${claimItems(risks, `${key}r`, rows)}</ol>` : ''}
		${decisions.length > 0 ? `<ul class="ln-decisions">${decisions.map((d, i) => decisionHtml(d, `${key}d${i}`, rows, all)).join('')}</ul>` : ''}
		${rest}
		<p class="ln-foot">${more}${ask}</p>
	</article>`
}
