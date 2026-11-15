// The answered question in the thread: the agent's diagrams, its summary, the decisions, the statements with their quote
// rows, and the agent's closing note. The agent wrote the words; ken checked only that each quote is in its file.
import { checkStrip, checksHtml } from './checks.js'
import { diagramHtml, elementKey } from './diagram.js'
import { count, esc, label, prose, quoteRows } from './format.js'

const UNDO = {
	easy: 'Easy to undo.',
	'some-work': 'Some work to undo.',
	hard: 'Hard to undo.',
}

export function decisionsOf(q) {
	return q.recorded.filter((entry) => entry.kind === 'decision')
}

// Every item that carries quotes, in the order the page shows them, by the key the page uses for it: "g0n3" for
// element 3 of the first diagram, "d0" for a decision, "s3" for a statement.
export function itemsOf(q) {
	return [
		...q.answer.diagrams.flatMap((diagram, i) =>
			diagram.elements
				.filter((element) => element.quotes.length > 0)
				.map((element) => ({ key: elementKey(i, element.number), kind: 'element', item: element })),
		),
		...decisionsOf(q).map((d, i) => ({ key: `d${i}`, kind: 'decision', item: d })),
		...q.answer.statements.map((s, i) => ({ key: `s${i}`, kind: 'statement', item: s, n: i + 1 })),
	]
}

export function answerHtml(q, ui) {
	const a = q.answer
	const quotes = a.statements.reduce((n, s) => n + s.quotes.length, 0)
	const allOpen = itemsOf(q).every(({ key, item }) => item.quotes.every((_, j) => ui.openQuotes.has(`${key}-q${j}`)))
	return `
		${a.diagrams.map((diagram, i) => diagramHtml(diagram, i, ui)).join('')}
		<p class="caption">The agent's summary. Not checked.</p>
		<p class="summary${ui.summaryOpen ? '' : ' capped'}" id="summary">${prose(a.summary)}</p>
		<p hidden id="summary-more"><button class="link small" data-act="summary" data-key="summary">Show all of the summary</button></p>
		<p class="strip narrow-only">${checkStrip(q)}</p>
		${decisionsOf(q)
			.map((d, i) => decisionHtml(d, `d${i}`, ui))
			.join('')}
		<div class="list-head">
			<h3>${count(a.statements.length, 'statement', 'statements')}, ${count(quotes, 'quote', 'quotes')}</h3>
			<button class="link small" data-act="all-quotes" data-key="all-quotes">${allOpen ? 'Close all quotes' : 'Open all quotes'}</button>
			<p class="list-note">${labelLine(a.statements)}</p>
		</div>
		<ol>${a.statements.map((s, i) => statementHtml(s, i, ui)).join('')}</ol>
		${noteHtml(q)}
		<section class="checks-inline narrow-only" aria-label="What ken checked">${ui.wide ? '' : checksHtml(q, ui)}</section>`
}

function statementHtml(s, i, ui) {
	return `<li class="st" id="item-s${i}">
		<span class="st-n">${i + 1}</span>
		<div>
			<p class="st-text">${label(s.label)}${prose(s.text)}</p>
			${quoteRows(s.quotes, `s${i}`, ui)}
		</div>
	</li>`
}

function decisionHtml(d, key, ui) {
	const rejected =
		d.rejected.length === 0
			? '<div><dt>Rejected</dt><dd class="muted">The code and the history show no other option.</dd></div>'
			: d.rejected
					.map(
						(r) =>
							`<div><dt>Rejected</dt><dd>${prose(r.option)}<span class="why">Why: ${prose(r.reason)}</span></dd></div>`,
					)
					.join('')
	const owner = d.needsOwner
		? 'The agent says this one needs your opinion.'
		: 'The agent says this one does not need your opinion.'
	return `<article class="decision" id="item-${key}">
		<p class="kind">Decision ${label(d.label)}</p>
		<h3 class="decision-q">${prose(d.question)}</h3>
		<dl class="facts">
			<div><dt>Chosen</dt><dd>${prose(d.chosen)}</dd></div>
			${rejected}
			<div><dt>To undo</dt><dd>${UNDO[d.undo] ?? esc(d.undo)}</dd></div>
			<div><dt>Your opinion</dt><dd>${owner}</dd></div>
		</dl>
		${quoteRows(d.quotes, key, ui)}
	</article>`
}

function labelLine(statements) {
	const names = [...new Set(statements.map((s) => s.label))]
	if (names.length === 1 && names[0] === 'inferred') {
		const all =
			statements.length === 1 ? 'It is' : statements.length === 2 ? 'Both are' : `All ${statements.length} are`
		return `${all} inferred: the agent worked ${statements.length === 1 ? 'it' : 'them'} out from the code and the diff.`
	}
	const counts = names.map((name) => `${statements.filter((s) => s.label === name).length} ${name.replace(/-/g, ' ')}`)
	return `${counts.join(', ')}.`
}

function noteHtml(q) {
	if (q.note === '') return ''
	const caret = q.live ? '<span class="caret" aria-hidden="true"></span>' : ''
	return `<div class="note"><span class="who">The agent's closing note. Not checked.</span><p>${prose(q.note)}${caret}</p></div>`
}
