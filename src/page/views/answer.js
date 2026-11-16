// The answered question in the thread: the agent's summary, one line that counts what needs the reader, the diagrams,
// the decisions, the risks and the statements with their quote rows, and the agent's closing note. The agent wrote the
// words; ken checked only that each quote is in its file.
import { checkStrip, checksHtml } from './checks.js'
import { diagramHtml, elementKey } from './diagram.js'
import { count, esc, LABELS, label, prose, quoteRows } from './format.js'

const UNDO = { easy: 'Easy to undo.', 'some-work': 'Some work to undo.', hard: 'Hard to undo.' }

// The summary and the closing note show whole sentences up to about three lines, wide or narrow; the rest opens on
// request.
const SHOWN_CHARS = { wide: 240, narrow: 150 }

export function decisionsOf(q) {
	return q.recorded.filter((entry) => entry.kind === 'decision')
}

// Every item that carries quotes, in the order the page shows them, by the key the page uses for it: "g0n3" for
// element 3 of the first diagram, "d0" for a decision, "r0" for a risk, "s3" for a statement.
export function itemsOf(q) {
	return [
		...q.answer.diagrams.flatMap((diagram, i) =>
			diagram.elements
				.filter((element) => element.quotes.length > 0)
				.map((element) => ({ key: elementKey(i, element.number), kind: 'element', item: element, diagram })),
		),
		...decisionsOf(q).map((d, i) => ({ key: `d${i}`, kind: 'decision', item: d, n: i + 1 })),
		...(q.answer.risks ?? []).map((r, i) => ({ key: `r${i}`, kind: 'risk', item: r, n: i + 1 })),
		...q.answer.statements.map((s, i) => ({ key: `s${i}`, kind: 'statement', item: s, n: i + 1 })),
	]
}

// When the quotes of one answer come from more than one commit, each quote row names its commit.
function manyCommits(q) {
	return new Set(itemsOf(q).flatMap(({ item }) => item.quotes.map((quote) => quote.commit))).size > 1
}

export function answerHtml(q, ui) {
	const a = q.answer
	const quotes = a.statements.reduce((n, s) => n + s.quotes.length, 0)
	const allOpen = ui.wide
		? ui.panel.kind === 'all'
		: itemsOf(q).every(({ key, item }) => item.quotes.every((_, j) => ui.openQuotes.has(`${key}-q${j}`)))
	const rows = { ui, commits: manyCommits(q) }
	const marked = markedLabels(a.statements)
	return `
		<p class="caption">The agent's summary. Not checked.</p>
		<p class="summary">${folded(a.summary, ui.summaryOpen, ui, 'summary', 'Show the rest of the summary')}</p>
		${needsHtml(q)}
		<a class="strip narrow-only" href="#checks-inline" title="See what ken checked">${checkStrip(q)}</a>
		${a.diagrams.map((diagram, i) => diagramHtml(diagram, i, rows)).join('')}
		${decisionsHtml(decisionsOf(q), rows)}
		${risksHtml(a.risks, a.change !== null, rows)}
		<div class="list-head">
			<h3>${count(a.statements.length, 'statement', 'statements')}, ${count(quotes, 'quote', 'quotes')}</h3>
			<button class="link small" data-act="all-quotes" data-key="all-quotes">${allOpen ? 'Close all quotes' : 'Open all quotes'}</button>
			<p class="list-note">${labelLine(a.statements)}</p>
		</div>
		<ol>${a.statements.map((s, i) => claimHtml(s, `s${i}`, i, rows, marked)).join('')}</ol>
		${noteHtml(q, ui)}
		<section class="checks-inline narrow-only" id="checks-inline" aria-label="What ken checked">${ui.wide ? '' : checksHtml(q, ui)}</section>`
}

// Whole sentences, so a cut never ends mid-word or hides half of a caveat.
function folded(text, open, ui, act, more) {
	const sentences = text.trim().split(/(?<=[.!?])\s+(?=\S)/)
	let shown = 1
	const most = ui.wide ? SHOWN_CHARS.wide : SHOWN_CHARS.narrow
	while (shown < sentences.length && sentences.slice(0, shown + 1).join(' ').length <= most) shown++
	const rest = open ? 0 : sentences.length - shown
	const button = rest === 0 ? '' : ` <button class="link" data-act="${act}" data-key="${act}">${more}</button>`
	return `${prose(sentences.slice(0, sentences.length - rest).join(' '))}${button}`
}

// One line under the summary that counts what needs the reader, each count a link down to its group. Nothing to count
// means no line.
function needsHtml(q) {
	const calls = decisionsOf(q).filter((d) => d.needsOwner).length
	const risks = q.answer.risks?.length ?? 0
	const parts = []
	if (calls > 0) {
		parts.push(
			`<a href="#decisions-head">${calls === 1 ? '1 decision needs your call' : `${calls} decisions need your call`}</a>`,
		)
	}
	if (risks > 0) parts.push(`<a href="#risks-head">${count(risks, 'risk', 'risks')} to watch</a>`)
	return parts.length === 0 ? '' : `<p class="needs">${parts.join(' · ')}</p>`
}

// A statement or a risk: its number, its text with its label when the label is marked, and its quote rows.
function claimHtml(claim, key, i, rows, marked) {
	return `<li class="st" id="item-${key}">
		<span class="st-n">${i + 1}</span>
		<div>
			<p class="st-text">${marked.has(claim.label) ? label(claim.label) : ''}${prose(claim.text)}</p>
			${quoteRows(claim.quotes, key, rows)}
		</div>
	</li>`
}

// The risks follow the decisions, built like the statements and set apart from them. An answer about a change always
// says something here, even that the agent found none. An answer about a change with no word on risks (null) was saved
// before ken asked for them.
function risksHtml(risks, aboutChange, rows) {
	if (risks === null) {
		return aboutChange ? '<p class="caption">This answer was written before ken asked for risks.</p>' : ''
	}
	if (risks.length === 0) {
		return `<div class="list-head"><h3>The agent found no risks</h3><p class="list-note">The agent says it looked for what could go wrong and found nothing to watch.</p></div>`
	}
	return `<section class="risks" aria-labelledby="risks-head">
		<div class="list-head">
			<h3 id="risks-head">${risks.length === 1 ? 'A risk to watch' : `${risks.length} risks to watch`}</h3>
			<p class="list-note">A risk is something the agent thinks could go wrong. ken checked the quotes, not the sentences. ${labelLine(risks)}</p>
		</div>
		<ol>${risks.map((r, i) => claimHtml(r, `r${i}`, i, rows, markedLabels(risks))).join('')}</ol>
	</section>`
}

// Each decision folds to its question and the option the code took. The row opens the decision in place.
function decisionsHtml(decisions, rows) {
	if (decisions.length === 0) return ''
	const calls = decisions.filter((d) => d.needsOwner).length
	const head = decisions.length === 1 ? 'A decision in this change' : `${decisions.length} decisions in this change`
	const needs =
		calls === 0
			? ''
			: decisions.length === 1
				? ', and it needs your call'
				: `, ${calls} ${calls === 1 ? 'needs' : 'need'} your call`
	return `<section class="decisions" aria-labelledby="decisions-head">
		<div class="list-head">
			<h3 id="decisions-head">${head}${needs}</h3>
			<p class="list-note">${labelLine(decisions)}</p>
		</div>
		<ul>${decisions.map((d, i) => decisionHtml(d, `d${i}`, rows)).join('')}</ul>
	</section>`
}

function decisionHtml(d, key, { ui, commits }) {
	const open = ui.openDecisions.has(key)
	const call = d.needsOwner ? '<span class="your-call">Your call</span> ' : ''
	const row = `<button class="d-row" data-act="decision" data-item="${key}" data-key="${key}-row" aria-expanded="${open}">
		<span class="d-line">${call}<span class="d-q">${prose(d.question)}</span> <span class="d-chosen">Chosen: ${prose(d.chosen)}</span></span></button>`
	if (!open) return `<li class="decision" id="item-${key}">${row}</li>`
	const others =
		d.rejected.length === 0
			? '<dd class="muted">none found in the code or history</dd>'
			: d.rejected
					.map((r) => `<dd>${prose(r.option)}<span class="why">Why not: ${prose(r.reason)}</span></dd>`)
					.join('')
	return `<li class="decision open" id="item-${key}">${row}
		<div class="d-card">
			${d.needsOwner ? `<p class="d-call">You decide: ${prose(d.question)}</p>` : ''}
			<dl class="facts">
				<div><dt>Chosen</dt><dd>${prose(d.chosen)}</dd></div>
				<div><dt>Other options</dt>${others}</div>
			</dl>
			<p class="d-undo">${UNDO[d.undo] ?? esc(d.undo)}</p>
			${quoteRows(d.quotes, key, { ui, commits })}
		</div>
	</li>`
}

// What each label means, said of one statement and of several.
const MEANS = {
	inferred: [
		'the agent worked it out from the code and the diff',
		'the agent worked them out from the code and the diff',
	],
	'found-by-search': [
		'the agent found the connection by searching and did not prove it',
		'the agent found the connections by searching and did not prove them',
	],
}

function labelCounts(statements) {
	const counts = new Map()
	for (const s of statements) counts.set(s.label, (counts.get(s.label) ?? 0) + 1)
	return [...counts].sort((a, b) => b[1] - a[1])
}

// The most common label goes without a mark, since the line above the statements names it. The others are marked.
function markedLabels(statements) {
	return new Set(
		labelCounts(statements)
			.slice(1)
			.map(([name]) => name),
	)
}

function sentence(text) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

function labelLine(statements) {
	const [common, ...marked] = labelCounts(statements)
	if (!common) return ''
	const name = (each) => LABELS[each]?.name ?? each
	const means = ([each, n]) => MEANS[each]?.[n === 1 ? 0 : 1] ?? ''
	if (marked.length === 0) {
		const n = statements.length
		const all = n === 1 ? 'It is' : n === 2 ? 'Both are' : `All ${n} are`
		return `${all} ${name(common[0]).toLowerCase()}: ${means(common)}.`
	}
	const rest = marked.map(
		(each) => `${each[1]} ${each[1] === 1 ? 'is' : 'are'} marked ${name(each[0])}. ${sentence(means(each))}.`,
	)
	return [`${common[1]} ${name(common[0]).toLowerCase()}: ${means(common)}.`, ...rest].join(' ')
}

// A note saved before ken kept only what the agent wrote after its answer can hold all its working text, so a long
// one folds like the summary.
function noteHtml(q, ui) {
	if (q.note === '') return ''
	const caret = q.live ? '<span class="caret" aria-hidden="true"></span>' : ''
	const text = q.live ? prose(q.note) : folded(q.note, ui.noteOpen, ui, 'note', 'Show the whole note')
	return `<div class="note"><span class="who">The agent's closing note. Not checked.</span><p>${text}${caret}</p></div>`
}
