// The "Decisions" view: every current decision in the project record, newest first, each with its label, where its
// reason comes from and the piece of work it belongs to. It holds the decisions a coding agent logged with ken decide,
// which belong to no answer, as well as those answers found.
import { sourceLine } from './answer.js'
import { labelKey } from './checks.js'
import { answeredHtml, at, count, esc, LABELS, label, prose, quoteBody, quoteSource } from './format.js'

function rowHtml({ decision: d, work }) {
	const call = d.needsOwner ? '<span class="your-call">Your call</span> ' : ''
	const source = sourceLine(d)
	const quotes = d.reason?.quotes ?? []
	const shown =
		quotes.length === 0
			? ''
			: `<details class="dv-quotes"><summary>Show the ${quotes.length === 1 ? 'quoted lines' : `${quotes.length} quotes`} of the reason</summary>${quotes
					.map((quote) => quoteBody(quote, `${quoteSource(quote)}. `))
					.join('')}</details>`
	const belongs = work
		? `Part of "${esc(work.title)}", a piece of work: the commits one answer explained.`
		: 'Not part of a piece of work yet: no answer has explained the commits that came after it.'
	const written = d.logged ? '' : `Written ${at(d.at)}. `
	const answered = d.answer ? `<p class="dv-answer">${answeredHtml(d.answer)}</p>` : ''
	return `<li class="dv-row" id="dv-${esc(d.id)}" tabindex="-1">
		<p class="dv-head">${call}${label(d.label)} <span class="dv-q">${prose(d.question)}</span></p>
		<p><span class="d-field">Chosen</span> ${prose(d.chosen)}</p>
		${d.reason ? `<p><span class="d-field">Why</span> ${prose(d.reason.text)}</p>` : ''}
		${answered}
		<p class="dv-meta">${source ? `${source} ` : ''}${written}${belongs}</p>
		${shown}
	</li>`
}

export function decisionsViewHtml(rows) {
	if (!rows) {
		return '<section class="decisions-view"><h1>Decisions</h1><p class="muted">Reading the project record.</p></section>'
	}
	const used = Object.keys(LABELS).filter((name) => rows.some((row) => row.decision.label === name))
	const list =
		rows.length === 0
			? '<p class="t-empty">The project record holds no decision yet. An answer about a change adds the decisions it finds, and a coding agent can log one with <code>ken decide</code>.</p>'
			: `<ul class="dv-list">${rows.map(rowHtml).join('')}</ul>`
	return `<section class="decisions-view">
		<h1>Decisions</h1>
		<p class="lead">${count(rows.length, 'decision', 'decisions')} saved for this project, newest first. ken sets each label from where the reason comes from.</p>
		${used.length === 0 ? '' : labelKey(used)}
		${list}
		<p class="actions"><button class="quiet-button" data-act="decisions-close" data-key="decisions-close">Back</button></p>
	</section>`
}
