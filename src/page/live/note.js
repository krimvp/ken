// One live note in the compact form of an answer: what it is about and when, the agent's summary, its few entries with
// their quote rows, the label line, what it cost, and "Open as a question". The agent wrote the words; ken checked only
// that each quote is in its file, at the commit or in its own snapshot of uncommitted work.
import { decisionHtml, labelLine, markedLabels } from '../views/answer.js'
import { count, esc, label, prose, quoteRows, short } from '../views/format.js'

export function aboutHtml(about) {
	if (about.kind === 'commits') {
		return `Commits <code>${short(about.base)}</code> to <code>${short(about.head)}</code>`
	}
	return `Uncommitted work as it stood at ${clock(about.at)}`
}

export function clock(iso) {
	const at = new Date(iso)
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function costHtml(entry) {
	const parts = []
	if (entry.usage) {
		const tokens = entry.usage.inputTokens + entry.usage.outputTokens
		parts.push(`${entry.usage.seconds} s`, `${tokens.toLocaleString('en-US')} tokens`)
	}
	const sent = entry.steps.filter((step) => step.kind === 'rejected').length
	if (entry.outcome === 'answered') {
		parts.push(sent === 0 ? 'quotes passed first time' : `ken sent back ${count(sent, 'try', 'tries')} first`)
	}
	return parts.join(' · ')
}

// The head line of a note, used for a folded note too.
export function noteHeadHtml(entry) {
	const draft = entry.about.kind === 'uncommitted' ? ' <span class="ln-draft">Draft, on this machine only</span>' : ''
	return `<span class="ln-time">${clock(entry.askedAt)}</span> <span class="ln-about">${aboutHtml(entry.about)}</span>${draft}`
}

function claimItems(claims, prefix, rows) {
	const marked = markedLabels(claims)
	return claims
		.map(
			(claim, i) => `<li class="st" id="item-${prefix}${i}">
			<span class="st-n">${i + 1}</span>
			<div>
				<p class="st-text">${marked.has(claim.label) ? label(claim.label) : ''}${prose(claim.text)}</p>
				${quoteRows(claim.quotes, `${prefix}${i}`, rows)}
			</div>
		</li>`,
		)
		.join('')
}

// key tells the entries of one note apart from another's, so opening a quote opens it in this note alone.
export function noteHtml(view, key, ui, canAsk) {
	const { entry, recorded } = view
	if (entry.outcome !== 'answered') {
		return `<article class="live-note failed"><p class="ln-head">${noteHeadHtml(entry)}</p>
			<p class="muted small">ken could not write a checked note on this change. It shows nothing it did not check.</p></article>`
	}
	const a = entry.answer
	const rows = { ui, commits: false }
	const decisions = [...recorded.filter((stored) => stored.kind === 'decision'), ...(entry.draft ?? [])]
	const risks = a.risks ?? []
	const claims = [...a.statements, ...risks, ...decisions]
	const ask = canAsk
		? `<button class="quiet-button" data-act="note-question" data-id="${esc(entry.id)}" data-key="ask-${key}">Open as a question</button>`
		: ''
	return `<article class="live-note">
		<p class="ln-head">${noteHeadHtml(entry)}</p>
		<p class="summary">${prose(a.summary)}</p>
		${a.statements.length > 0 ? `<ol class="ln-list">${claimItems(a.statements, `${key}s`, rows)}</ol>` : ''}
		${risks.length > 0 ? `<h3 class="ln-sub">${risks.length === 1 ? 'A risk to watch' : `${risks.length} risks to watch`}</h3><ol class="ln-list">${claimItems(risks, `${key}r`, rows)}</ol>` : ''}
		${decisions.length > 0 ? `<ul class="ln-decisions">${decisions.map((d, i) => decisionHtml(d, `${key}d${i}`, rows, markedLabels(decisions))).join('')}</ul>` : ''}
		<p class="list-note">${labelLine(claims)} The agent wrote the words; ken checked that each quote is there.</p>
		<p class="ln-foot"><span class="ln-cost">${costHtml(entry)}</span>${ask}</p>
	</article>`
}
