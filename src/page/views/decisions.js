// The "Decisions" view: every current decision in the project record, newest first, each with its label, its facts laid
// out as in an answer, and the change it belongs to. It holds the decisions a coding agent logged with ken decide,
// which belong to no answer, as well as those answers found.
import { factsHtml } from './answer.js'
import { labelKey } from './checks.js'
import { answeredHtml, at, count, esc, LABELS, label, prose, quoteBody, quoteSource } from './format.js'

function rowHtml({ decision: d, work }) {
	const call = d.needsOwner ? '<span class="your-call">Your call</span> ' : ''
	const quotes = d.reason?.quotes ?? []
	const shown =
		quotes.length === 0
			? ''
			: `<details class="dv-quotes"><summary>Show the ${quotes.length === 1 ? 'quote' : `${quotes.length} quotes`} of the reason</summary>${quotes
					.map((quote) => quoteBody(quote, `${quoteSource(quote)}. `))
					.join('')}</details>`
	const belongs = work
		? `It belongs to the change "${esc(work.title)}".`
		: 'No answer has explained the change it belongs to yet.'
	const written = d.logged ? '' : `Written ${at(d.at)}. `
	const answered = d.answer ? `<p class="dv-answer">${answeredHtml(d.answer)}</p>` : ''
	return `<li class="dv-row" id="dv-${esc(d.id)}" tabindex="-1">
		<p class="dv-head">${call}${label(d.label)} <span class="dv-q">${prose(d.question)}</span></p>
		<p><span class="d-field">Chosen</span> ${prose(d.chosen)}</p>
		${factsHtml(d)}
		${answered}
		<p class="dv-meta">${written}${belongs}</p>
		${shown}
	</li>`
}

export function decisionsViewHtml(rows, keyOpen) {
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
		<p class="lead">${count(rows.length, 'decision', 'decisions')} saved for this project, newest first. Each label says where the reason comes from.</p>
		${used.length === 0 ? '' : `<p><button class="link small" data-act="dv-key" data-key="dv-key" aria-expanded="${keyOpen}">${keyOpen ? 'Hide what the labels mean' : 'What the labels mean'}</button></p>${keyOpen ? labelKey(used) : ''}`}
		${list}
		<p class="actions"><button class="quiet-button" data-act="decisions-close" data-key="decisions-close">Back</button></p>
	</section>`
}
