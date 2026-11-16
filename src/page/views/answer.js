// The answered question in the thread: the agent's summary, one line that counts what needs the reader, the diagrams,
// the decisions, the risks and the statements with their quote rows, and the agent's closing note. The agent wrote the
// words; ken checked only that each quote is in its file. An answer about a change opens on what a tired owner needs
// first, as a chat would: the story, the first risks, heaviest first, and the decisions that need their call. The rest
// folds behind one line each, with its count, and opens in place.
import { checkStrip, checksHtml } from './checks.js'
import { diagramHtml, elementKey } from './diagram.js'
import {
	at,
	copiesOf,
	count,
	decisionQuotes,
	esc,
	isSession,
	label,
	list,
	prose,
	quoteRows,
	RISK_MARKS,
	short,
	when,
} from './format.js'
import { foldedTopics, knownHtml, mapBarHtml } from './map.js'

// The answer was asked at a HEAD the project has moved on from.
export function isMoved(q) {
	return Boolean(q.head && q.headNow && q.head !== q.headNow)
}

const UNDO = { easy: 'Easy', 'some-work': 'Some work', hard: 'Hard' }

// The summary and the closing note show whole sentences up to about three lines, wide or narrow; the rest opens on
// request.
const SHOWN_CHARS = { wide: 240, narrow: 150 }

// A draft answer, one that cites ken's snapshot of uncommitted work, keeps its decisions with it: the record has none.
export function decisionsOf(q) {
	return [...q.recorded.filter((entry) => entry.kind === 'decision'), ...(q.draft ?? [])]
}

// The risks with the keys the page knows them by, in the answer's order, which the second look sets heaviest first, each
// numbered as the page shows it. The weight on a risk is the model's. An answer saved before ken asked for it has none.
export function risksOf(q) {
	const risks = (q.answer.risks ?? []).map((item, i) => ({ item, key: `r${i}`, n: i + 1 }))
	return { weighed: risks.some(({ item }) => item.weight !== undefined), risks }
}

// How many risks an answer about a change shows open. The rest wait in one fold, so the first view never depends on
// the model's weight alone: a model can weigh every risk minor.
const FIRST_RISKS = 3

// Every item that carries quotes, in the order the page shows them, by the key the page uses for it: "g0n3" for
// element 3 of the first diagram, "d0" for a decision, "r0" for a risk, "s3" for a statement.
export function itemsOf(q) {
	const decisions = decisionsOf(q).map((d, i) => ({
		key: `d${i}`,
		kind: 'decision',
		item: { ...d, quotes: decisionQuotes(d) },
		n: i + 1,
	}))
	const risks = risksOf(q).risks.map((each) => ({ ...each, kind: 'risk' }))
	const calls = decisions.filter(({ item }) => item.needsOwner)
	const others = decisions.filter(({ item }) => !item.needsOwner)
	const withdrawn = (q.answer.withdrawn ?? []).map(({ risk, proof }, i) => ({
		key: `w${i}`,
		kind: 'withdrawn',
		item: { text: risk.text, quotes: proof },
		n: i + 1,
	}))
	return [
		...q.answer.diagrams.flatMap((diagram, i) =>
			diagram.elements
				.filter((element) => element.quotes.length > 0)
				.map((element) => ({ key: elementKey(i, element.number), kind: 'element', item: element, diagram })),
		),
		...(q.answer.change ? [...risks, ...calls, ...others] : [...decisions, ...risks]),
		...q.answer.statements.map((s, i) => ({ key: `s${i}`, kind: 'statement', item: s, n: i + 1 })),
		...withdrawn,
	]
}

// When the quotes of one answer come from more than one commit, each quote row of git names its commit.
function manyCommits(q) {
	const commits = itemsOf(q).flatMap(({ item }) => item.quotes.filter((quote) => !isSession(quote)))
	return new Set(commits.map((quote) => quote.commit)).size > 1
}

// Each entry with the key the page knows it by, which keeps its place in the answer when entries of a topic the reader
// knows are folded away.
function shownOf(entries, prefix, hidden) {
	return entries.map((item, i) => ({ item, key: `${prefix}${i}` })).filter(({ item }) => !hidden.has(item.topic))
}

export function answerHtml(q, ui, running) {
	const a = q.answer
	const hidden = foldedTopics(q, ui)
	const statements = shownOf(a.statements, 's', hidden)
	const quotes = statements.reduce((n, { item }) => n + item.quotes.length, 0)
	const counted = `${count(statements.length, 'statement', 'statements')}, ${count(quotes, 'quote', 'quotes')}`
	const allOpen = ui.wide
		? ui.panel.kind === 'all'
		: itemsOf(q).every(({ key, item }) => item.quotes.every((_, j) => ui.openQuotes.has(`${key}-q${j}`)))
	const rows = { ui, commits: manyCommits(q), head: q.head, copies: copiesOf(q), change: a.change }
	const known = ({ item }) => !hidden.has(item.topic)
	const { weighed, risks: all } = risksOf(q)
	const risks = all.filter(known)
	const claims = [...statements, ...risks].map(({ item }) => item)
	const marked = markedLabels(claims)
	const named = new Set([...a.statements, ...(a.risks ?? []), ...decisionsOf(q)].map((each) => each.topic))
	const statementsList =
		statements.length === 0
			? ''
			: `<div class="list-head">
			<h3>${a.change ? 'What the change did' : counted}</h3>
			<button class="link small" data-act="all-quotes" data-key="all-quotes">${allOpen ? 'Close all quotes' : 'Open all quotes'}</button>
			<p class="list-note">${a.change ? `${sentence(counted)}. ` : ''}${labelLine(statements.map(({ item }) => item))}</p>
		</div>
		<ol>${statements.map(({ item, key }, i) => claimHtml(item, key, i, rows, marked)).join('')}</ol>`
	const decisions = shownOf(decisionsOf(q), 'd', hidden)
	const body = a.change
		? changeBody({
				ui,
				rows,
				marked,
				decisions,
				risks,
				weighed,
				statements,
				statementsList,
				claims,
				all: a.risks,
			})
		: `${decisionsHtml(decisions, rows)}
		${risksHtml(a.risks, risks, false, rows, marked, statements.length === 0 ? labelLine(claims) : '')}
		${statementsList}`
	const summary = a.change
		? prose(a.summary)
		: folded(a.summary, ui.summaryOpen, ui, 'summary', 'Show the rest of the summary')
	return `
		<p class="caption">The summary from ken's model. Not checked.</p>
		<p class="summary">${summary}</p>
		${needsHtml(q)}
		${leftOutHtml(a)}
		${withdrawnHtml(a, ui, rows)}
		${knownHtml(q, ui, named, isMoved(q))}
		<a class="strip narrow-only" href="#checks-inline" title="See what ken checked">${checkStrip(q)}</a>
		${a.diagrams.map((diagram, i) => diagramHtml(diagram, i, rows)).join('')}
		${body}
		${noteHtml(q, ui)}
		${mapBarHtml(q, ui, running)}
		<section class="checks-inline narrow-only" id="checks-inline" aria-label="What ken checked">${ui.wide ? '' : checksHtml(q, ui)}</section>`
}

// An answer about a change: the first risks and the decisions that need the reader's call are open. The other
// decisions and what the change did each fold behind one line with its count.
function changeBody({ ui, rows, marked, decisions, risks, weighed, statements, statementsList, claims, all }) {
	const calls = decisions.filter(({ item }) => item.needsOwner)
	const others = decisions.filter(({ item }) => !item.needsOwner)
	const labels = labelLine(claims)
	const risksPart = weighed
		? weighedHtml(risks, ui, rows, marked, labels)
		: risksHtml(all, risks, true, rows, marked, labels)
	const otherHead =
		calls.length === 0
			? count(others.length, 'decision in this change', 'decisions in this change')
			: count(others.length, 'other decision', 'other decisions')
	const folds = [
		others.length === 0 ? '' : foldHtml('decisions', otherHead, ui, decisionsHtml(others, rows, false)),
		statements.length === 0
			? ''
			: foldHtml(
					'statements',
					`What the change did (${count(statements.length, 'statement', 'statements')})`,
					ui,
					statementsList,
				),
	].join('')
	return `${risksPart}${decisionsHtml(calls, rows, true)}${folds ? `<div class="folds">${folds}</div>` : ''}`
}

// One folded group: a line with its count that opens the group in place.
function foldHtml(group, head, ui, body) {
	const open = ui.openGroups.has(group)
	return `<section class="fold" id="fold-${group}">
		<button class="fold-head" data-act="group" data-group="${group}" data-key="fold-${group}" aria-expanded="${open}">${head}</button>
		${open ? `<div class="fold-body">${body}</div>` : ''}
	</section>`
}

// Risks the model weighed, in the answer's order: the first FIRST_RISKS open, each with its weight beside ken's mark,
// and the rest in one fold under them.
function weighedHtml(risks, ui, rows, marked, labels) {
	if (risks.length === 0) {
		return `<div class="list-head"><h3>ken's model found no risks</h3><p class="list-note">ken's model says it looked for what could go wrong and found nothing to watch.</p></div>`
	}
	const note = `A risk is something ken's model thinks could go wrong. ken's model weighs each one. Serious: someone who uses the code in the normal way loses work, gets a wrong result or a failure, or finds refused what worked before. Minor: it needs a rare case or costs little. ${RISK_MARKS.means}${labels ? ` ${labels}` : ''}`
	const list = (each) => each.map(({ item, key, n }) => claimHtml(item, key, n - 1, rows, marked)).join('')
	const rest = risks.slice(FIRST_RISKS)
	const more =
		rest.length === 0
			? ''
			: foldHtml('risks', count(rest.length, 'more risk', 'more risks'), ui, `<ol>${list(rest)}</ol>`)
	return `<section class="risks" aria-labelledby="risks-head">
		<div class="list-head">
			<h3 id="risks-head">Risks, heaviest first (${risks.length})</h3>
			<p class="list-note">${note}</p>
		</div>
		<ol>${list(risks.slice(0, FIRST_RISKS))}</ol>
		${more}
	</section>`
}

// How many points of the model's draft it found no line to quote for. An answer not made from a draft has no count.
function leftOutHtml(a) {
	const n = a.leftOut ?? 0
	if (n === 0) return ''
	const said =
		n === 1
			? '1 point of the draft had no line to quote and was'
			: `${n} points of the draft had no line to quote and were`
	return `<p class="caption">${said} left out. The draft is in the steps.</p>`
}

// The risks the second look took out: one line with the count, which opens to each risk, why it was withdrawn and the
// lines that rule it out. ken checked those lines; the reason is the model's.
function withdrawnHtml(a, ui, rows) {
	const all = a.withdrawn ?? []
	if (all.length === 0) return ''
	const head =
		all.length === 1
			? '1 risk withdrawn by the second look, with the line that rules it out'
			: `${all.length} risks withdrawn by the second look, each with the line that rules it out`
	const items = all
		.map(
			({ risk, reason, proof }, i) => `<li class="st" id="item-w${i}">
				<span class="st-n">${i + 1}</span>
				<div>
					<p class="st-text">${weightHtml(risk)}${prose(risk.text)}</p>
					<p class="small"><span class="d-field">Ruled out</span> ${prose(reason)}</p>
					${quoteRows(proof, `w${i}`, rows)}
				</div>
			</li>`,
		)
		.join('')
	return `<div class="folds withdrawn">${foldHtml('withdrawn', head, ui, `<ol>${items}</ol>`)}</div>`
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
	const { weighed, risks } = risksOf(q)
	const serious = risks.filter(({ item }) => item.weight === 'serious').length
	const parts = []
	if (calls > 0) {
		parts.push(
			`<a href="#decisions-head">${calls === 1 ? '1 decision needs your call' : `${calls} decisions need your call`}</a>`,
		)
	}
	if (!weighed && risks.length > 0)
		parts.push(`<a href="#risks-head">${count(risks.length, 'risk', 'risks')} to watch</a>`)
	if (weighed && risks.length > 0) {
		const of = serious === 0 ? '' : `, ${serious} of them serious`
		parts.push(`<a href="#risks-head">${count(risks.length, 'risk', 'risks')}${of}</a>`)
	}
	// Fewer than half the changed blocks quoted means most of the change is not explained here, so it is said up front.
	const change = q.answer.change
	const total = change ? change.covered.length + change.uncovered.length : 0
	if (total > 0 && change.covered.length * 2 < total) {
		parts.push(
			`<a href="#check-coverage">Only ${change.covered.length} of ${count(total, 'changed block', 'changed blocks')} quoted</a>`,
		)
	}
	return parts.length === 0 ? '' : `<p class="needs">${parts.join(' · ')}</p>`
}

// A statement or a risk: its number, its text with its label when the label is marked, and its quote rows.
function claimHtml(claim, key, i, rows, marked) {
	return `<li class="st" id="item-${key}">
		<span class="st-n">${i + 1}</span>
		<div>
			<p class="st-text">${marked.has(claim.label) ? label(claim.label) : ''}${checkedHtml(claim)}${weightHtml(claim)}${prose(claim.text)}</p>
			${quoteRows(claim.quotes, key, rows)}
		</div>
	</li>`
}

// ken's own mark on a risk, from git, in the label styles: solid when a quote lies outside the change, dashed when not.
// A statement, and a risk saved before ken set it, has none.
function checkedHtml({ checked }) {
	if (checked === undefined) return ''
	const [style, name] = checked ? ['recorded', RISK_MARKS.outside] : ['inferred', RISK_MARKS.inside]
	return `<span class="label label-${style}">${name}</span>`
}

// The model's weight on a risk, in the style of the label for what the model worked out itself. A statement, and a risk
// saved before ken asked for the weight, has none.
function weightHtml({ weight }) {
	if (weight === undefined) return ''
	return `<span class="label label-inferred" title="The weight ken's model gave this risk. ken does not judge it.">${weight === 'serious' ? 'Serious' : 'Minor'}</span>`
}

// The risks follow the decisions, built like the statements and set apart from them. An answer about a change always
// says something here, even that the agent found none. An answer about a change with no word on risks (null) was saved
// before ken asked for them. shown leaves out the risks of a topic the reader knows.
function risksHtml(all, shown, aboutChange, rows, marked, labels) {
	if (all === null) {
		return aboutChange
			? '<p class="caption">This answer was saved before ken listed risks. Ask again to see them.</p>'
			: ''
	}
	if (all.length === 0) {
		return `<div class="list-head"><h3>ken's model found no risks</h3><p class="list-note">ken's model says it looked for what could go wrong and found nothing to watch.</p></div>`
	}
	if (shown.length === 0) return ''
	return `<section class="risks" aria-labelledby="risks-head">
		<div class="list-head">
			<h3 id="risks-head">${shown.length === 1 ? 'A risk to watch' : `${shown.length} risks to watch`}</h3>
			<p class="list-note">A risk is something ken's model thinks could go wrong.${shown.some(({ item }) => item.checked !== undefined) ? ` ${RISK_MARKS.means}` : ''}${labels ? ` ${labels}` : ''}</p>
		</div>
		<ol>${shown.map(({ item, key }, i) => claimHtml(item, key, i, rows, marked)).join('')}</ol>
	</section>`
}

// Each decision folds to its question and the option the code took. The row opens the decision in place. An answer
// about a change shows the decisions that need the reader's call under their own head (calls true), and the others in a
// fold that has its own head (calls false).
function decisionsHtml(shown, rows, calls = null) {
	if (shown.length === 0) return ''
	const decisions = shown.map(({ item }) => item)
	// Every decision carries its own label, so no missing mark has to mean one of them.
	const all = new Set(decisions.map((d) => d.label))
	const list = `<ul>${shown.map(({ item, key }) => decisionHtml(item, key, rows, all)).join('')}</ul>`
	if (calls === false) return `<section class="decisions">${list}</section>`
	const asks = decisions.filter((d) => d.needsOwner).length
	const head =
		calls === true
			? decisions.length === 1
				? 'A decision needs your call'
				: `${decisions.length} decisions need your call`
			: `${decisions.length === 1 ? 'A decision in this change' : `${decisions.length} decisions in this change`}${
					asks === 0
						? ''
						: decisions.length === 1
							? ', and it needs your call'
							: `, ${asks} ${asks === 1 ? 'needs' : 'need'} your call`
				}`
	return `<section class="decisions" aria-labelledby="decisions-head">
		<div class="list-head"><h3 id="decisions-head">${head}</h3></div>
		${list}
	</section>`
}

export function decisionHtml(d, key, rows, marked) {
	const open = rows.ui.openDecisions.has(key)
	const call = d.needsOwner ? '<span class="your-call">Your call</span> ' : ''
	const mark = marked.has(d.label) ? `${label(d.label)} ` : ''
	const row = `<button class="d-row" data-act="decision" data-item="${key}" data-key="${key}-row" aria-expanded="${open}">
		<span class="d-line">${call}${mark}<span class="d-q">${prose(d.question)}</span> <span class="d-chosen"><span class="d-field">Chosen</span> ${prose(d.chosen)}</span></span></button>`
	if (!open) return `<li class="decision" id="item-${key}">${row}</li>`
	const answerIt = d.needsOwner && !d.answer && !rows.waiting ? `<p class="small">${answerItLink(key)}</p>` : ''
	return `<li class="decision open" id="item-${key}">${row}
		<div class="d-card">
			${factsHtml(d)}
			${answerIt}
			${quoteRows(decisionQuotes(d), key, rows)}
		</div>
	</li>`
}

// A decision that needs the reader's call is answered in "Waiting on you"; this opens it.
export function answerItLink(key) {
	return `<button class="link" data-act="follow-up" data-key="answer-it-${esc(key)}">Answer it in Waiting on you</button>`
}

// A decision's facts under what was chosen, the same in an answer, in "Waiting on you" and in Decisions: why, the
// other options when there are any, and how hard it is to reverse.
export function factsHtml(d) {
	const others = d.rejected
		.map((r) => `<dd>${prose(r.option)}<span class="why">Why not: ${prose(r.reason)}</span></dd>`)
		.join('')
	return `<dl class="facts">
		${d.reason ? `<div><dt>Why</dt><dd>${prose(d.reason.text)}${fromHtml(d)}</dd></div>` : ''}
		${others ? `<div><dt>Other options</dt>${others}</div>` : ''}
		<div><dt>Reversing it later</dt><dd>${UNDO[d.undo] ?? esc(d.undo)}</dd></div>
	</dl>`
}

// Where a decision's reason comes from, by its label: who logged it with ken decide, the commit messages its reason
// quotes, or the saved session it quotes.
function fromHtml(d) {
	return d.reason || d.logged ? `<span class="why">${sourceLine(d)}</span>` : ''
}

function sourceLine(d) {
	if (d.logged) {
		const by = d.logged.by ? ` (${esc(d.logged.by)})` : ''
		const head = d.logged.head ? `, at commit <code>${short(d.logged.head)}</code>` : ', before the first commit'
		// An answered decision is a new entry, so its own time is when the owner answered, not when it was logged.
		const time = d.answer ? '' : ` ${at(d.at)}`
		return `Your coding agent${by} logged this${time}${head}. ken did not check the reason.`
	}
	const quotes = d.reason?.quotes ?? []
	if (d.label === 'recorded') {
		const messages = [...new Set(quotes.filter((q) => !isSession(q) && q.path === null).map((q) => short(q.commit)))]
		return `Quoted from the commit message of ${list(messages.map((hash) => `<code>${hash}</code>`))}.`
	}
	if (d.label === 'from-the-session') {
		const times = [...new Set(quotes.filter(isSession).map((quote) => when(quote.at)))]
		return `Quoted from your coding agent's saved session of ${list(times)}.`
	}
	return ''
}

// What each label means, said of one statement and of several.
const MEANS = {
	recorded: [
		'rests on what was written down when the work was done',
		'rest on what was written down when the work was done',
	],
	'from-the-session': ["rests on your coding agent's session", "rest on your coding agent's session"],
	inferred: ['rests on the code', 'rest on the code'],
	'found-by-search': [
		"comes from a text search; ken's model did not follow the code to confirm it",
		"come from a text search; ken's model did not follow the code to confirm them",
	],
}

function labelCounts(statements) {
	const counts = new Map()
	for (const s of statements) counts.set(s.label, (counts.get(s.label) ?? 0) + 1)
	return [...counts].sort((a, b) => b[1] - a[1])
}

// The most common label goes without a mark, since the line above the statements names it. The others are marked.
export function markedLabels(statements) {
	return new Set(
		labelCounts(statements)
			.slice(1)
			.map(([name]) => name),
	)
}

function sentence(text) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

// Said once per answer, over its statements and risks: what the most common label means, and the marked ones.
export function labelLine(statements) {
	const [common, ...marked] = labelCounts(statements)
	if (!common) return ''
	const means = ([each, n]) => MEANS[each]?.[n === 1 ? 0 : 1] ?? ''
	if (marked.length === 0) {
		const n = statements.length
		const all = n === 1 ? 'It' : n === 2 ? 'Both' : `All ${n}`
		return `${all} ${means(common)}.`
	}
	return [common, ...marked].map((each) => `${each[1] === 1 ? 'One' : each[1]} ${means(each)}.`).join(' ')
}

// A note saved before ken kept only what the agent wrote after its answer can hold all its working text, so a long
// one folds like the summary.
function noteHtml(q, ui) {
	if (q.note === '') return ''
	const caret = q.live ? '<span class="caret" aria-hidden="true"></span>' : ''
	const text = q.live ? prose(q.note) : folded(q.note, ui.noteOpen, ui, 'note', 'Show the whole note')
	return `<div class="note"><span class="who">The closing note from ken's model. Not checked.</span><p>${text}${caret}</p></div>`
}
