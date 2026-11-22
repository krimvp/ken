// A reply in the thread: the model's own words as plain text, and the cards it showed, each in a box, in the order it
// gave them. ken checked every card against git; the words are the model's, and one line at the top of the thread
// says so, once. A reply about a change opens on the change card, before the model's words, and under it two chips
// ask for the change's decisions and its risks.
import { changeCardHtml, changeKey } from '../project/change-card.js'
import { tourCardHtml, tourKey } from '../project/tour-card.js'
import { stopState, stopTopics, walkHtml, walkOf } from '../project/walk.js'
import { checksHtml } from './checks.js'
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
	markHtml,
	prose,
	quoteRows,
	RISK_MARKS,
	short,
	WEIGHT_MEANS,
	when,
} from './format.js'
import { foldedTopics, knownHtml, mapBarHtml } from './map.js'

// Who wrote what on the page, said once: at the top of a thread, and at the top of the panel beside the picture.
export const LEGEND =
	"ken's model wrote the explanations, and ken did not check them. In a boxed card, ken found each quoted line in git."

// What the chips under a reply about a change ask, in the reader's words. They name the commits, so the question stands
// on its own in a chat that never saw the change.
export function chipQuestion(kind, change) {
	const range = `the change from ${short(change.base)} to ${short(change.head)}`
	if (kind === 'walk') return `Walk me through ${range}, step by step, in the order a reviewer should read it.`
	return kind === 'risks'
		? `What could go wrong with ${range}? Show me the risks.`
		: `What did ${range} decide, and why?`
}

// The reply was asked at a HEAD the project has moved on from.
export function isMoved(q) {
	return Boolean(q.head && q.headNow && q.head !== q.headNow)
}

const UNDO = { easy: 'Easy', 'some-work': 'Some work', hard: 'Hard' }

const CHIPS = { walk: 'Walk me through it', decisions: 'Ask what it decided', risks: 'Ask what could go wrong' }

// The key of the card at item j of turn t, which its quote rows, its place in the panel and its element ids share.
export function cardKey(t, j) {
	return `t${t}c${j}`
}

// A diagram's id on the page: its turn and its item, so two diagrams in one thread never share one.
export function diagramId(t, j) {
	return `${t}-${j}`
}

// The cards of a reply with their place in the thread.
export function cardsOf(q, t) {
	return (q.reply?.items ?? []).flatMap((item, j) => (item.kind === 'card' ? [{ card: item.card, t, j }] : []))
}

// Every thing in the thread that carries quotes, in the order the page shows them, by the key the page uses for it.
export function itemsOf(thread) {
	return thread.flatMap((q, t) =>
		cardsOf(q, t).flatMap(({ card, j }) => {
			const key = cardKey(t, j)
			switch (card.kind) {
				case 'claim':
					return [{ key, kind: 'claim', item: card.claim, q }]
				case 'risk':
					return [{ key, kind: 'risk', item: card.risk, q }]
				case 'decision':
					return [{ key, kind: 'decision', item: { ...card.decision, quotes: decisionQuotes(card.decision) }, q }]
				case 'topic':
					return [{ key, kind: 'topic', item: { text: card.topic.name, quotes: card.topic.quotes }, q }]
				case 'withdrawn':
					return [{ key, kind: 'withdrawn', item: { text: card.withdrawn.risk.text, quotes: card.withdrawn.proof }, q }]
				case 'layout':
					return card.layout.arrows.map((arrow, n) => ({
						key: `${key}a${n}`,
						kind: 'arrow',
						item: arrowItem(arrow),
						q,
					}))
				case 'diagram':
					return card.diagram.elements
						.filter((element) => element.quotes.length > 0)
						.map((element) => ({
							key: elementKey(diagramId(t, j), element.number),
							kind: 'element',
							item: element,
							diagram: card.diagram,
							q,
						}))
				default:
					return []
			}
		}),
	)
}

// When the quotes of one reply come from more than one commit, each quote row of git names its commit.
function manyCommits(q) {
	const quotes = itemsOf([q]).flatMap(({ item }) => item.quotes.filter((quote) => !isSession(quote)))
	return new Set(quotes.map((quote) => quote.commit)).size > 1
}

function topicOf(card) {
	return card.claim?.topic ?? card.risk?.topic ?? card.decision?.topic ?? null
}

// inThread is false for a live note, which shows its words and cards alone: no chips, no map buttons, no checks.
export function replyHtml(q, t, ui, { running, inThread }) {
	const hidden = foldedTopics(q, ui)
	const rows = { ui, commits: manyCommits(q), head: q.head, copies: copiesOf(q), change: q.reply.change }
	const cards = cardsOf(q, t)
	const named = new Set(cards.map(({ card }) => topicOf(card)).filter((name) => name !== null))
	const steps = walkOf(q.reply)
	// The cards of a step show in the walkthrough, under their step.
	const parts = q.reply.items.map((item, j) => {
		if (item.kind === 'words') return wordsHtml(item.text)
		if (item.kind !== 'card' || (steps.length > 0 && item.step !== undefined)) return ''
		if (hidden.has(topicOf(item.card))) return ''
		return cardHtml(item.card, t, j, rows)
	})
	const shown = new Set(cards.map(({ card }) => card.kind))
	const asks =
		inThread && q.reply.change && !q.about
			? [...(steps.length > 0 ? [] : ['walk']), 'decisions', 'risks']
					.filter((kind) => !shown.has(kind.slice(0, -1)))
					.map(
						(kind) =>
							`<button class="chip${kind === 'walk' ? ' chip-main' : ''}" data-act="chip" data-chip="${kind}" data-turn="${t}" data-key="chip-${t}-${kind}"${running ? ' disabled' : ''}>${CHIPS[kind]}</button>`,
					)
			: []
	const checks =
		!inThread || cards.length === 0
			? ''
			: `<section class="checks-inline narrow-only" aria-label="What ken checked">${ui.wide ? '' : checksHtml(q, ui)}</section>`
	const change = q.reply.change ?? q.liveChange
	const { tour } = q.reply
	const walk =
		inThread && steps.length > 0
			? {
					steps,
					at: ui.walkAt?.get(t) ?? null,
					cardHtml: (card, j) => cardHtml(card, t, j, rows),
					under: !ui.wide,
					states: q.topics,
					knowHtml: (step) => knowPartHtml(q, t, step),
				}
			: null
	const look = change ? (ui.changeLooks?.get(changeKey(change)) ?? null) : null
	const card =
		inThread && change
			? changeCardHtml(change, look, t, walk)
			: walk && tour
				? tourCardHtml(tour, ui.changeLooks?.get(tourKey(tour)) ?? null, t, walk)
				: walk
					? walkHtml(steps, t, { ...walk, boxes: null, change: null, tour: Boolean(tour) })
					: ''
	// On a tour each stop says what the reader's map holds, so the lines and buttons for the whole reply stay away.
	const mapped = inThread && !tour && (q.reply.topics ?? []).length > 0
	return `${tour ? '' : knownHtml(q, ui, named, isMoved(q))}
		<div class="reply">${card}${parts.join('')}</div>
		${asks.length > 0 ? `<p class="chips">${asks.join(' ')}</p>` : ''}
		${mapped ? mapBarHtml(q, t, ui, running) : ''}
		${checks}`
}

// What the reader's map says about the part of a tour stop, and the button that says they know it.
export function knowPartHtml(q, t, step) {
	const names = stopTopics(step).map((name) => name.toLowerCase())
	if (!(q.topics ?? []).some((state) => names.includes(state.topic.toLowerCase()))) {
		return '<p class="walk-know muted">ken cannot keep this stop on your map: it quotes no code of the part.</p>'
	}
	const stood = stopState(step, q.topics)
	const part = esc(step.part)
	if (stood === 'known') return `<p class="walk-know">Your map says you know ${part}.</p>`
	const said = stood === 'met' ? `Your map says you have seen ${part}. ` : ''
	return `<p class="walk-know">${said}<button class="quiet-button" data-act="tour-know" data-turn="${t}" data-step="${step.number}" data-key="tour-know-${t}-${step.number}">I know this part</button></p>`
}

// How a reply's cards draw their quote rows where no panel shows a quote: each opens in place.
function rowsInPlace(q, ui) {
	return {
		ui: { ...ui, wide: false },
		commits: manyCommits(q),
		head: q.head,
		copies: copiesOf(q),
		change: q.reply.change,
	}
}

// The cards that prove a step, for the panel and the home. Their quotes open in place, so the step stays in view.
// shown says which quotes the step's diff above the cards already shows.
export function stepCardsHtml(q, t, step, ui, shown = null) {
	const rows = { ...rowsInPlace(q, ui), shown }
	return step.cards.map(({ card, j }) => cardHtml(card, t, j, rows)).join('')
}

// A reply's words and the cards that belong to no step, in the order the model gave them, for the home: no chips,
// no map buttons, and no checks. t names the reply in the keys of its cards.
export function storyHtml(q, t, ui) {
	const rows = rowsInPlace(q, ui)
	return q.reply.items
		.map((item, j) =>
			item.kind === 'words'
				? wordsHtml(item.text)
				: item.kind === 'card' && item.step === undefined
					? cardHtml(item.card, t, j, rows)
					: '',
		)
		.join('')
}

// The model writes plain text: paragraphs, now and then a list or a block of code. Each becomes its own element, and
// everything in it is escaped.
export function wordsHtml(text) {
	const blocks = []
	const lines = text.trim().split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.trim() === '') continue
		if (line.trimStart().startsWith('```')) {
			const code = []
			for (i++; i < lines.length && !lines[i].trimStart().startsWith('```'); i++) code.push(lines[i])
			blocks.push(`<pre class="code"><code>${esc(code.join('\n'))}</code></pre>`)
			continue
		}
		const listed = line.match(/^\s*(?:[-*]|\d+\.)\s+/)
		if (listed) {
			const ordered = /\d/.test(listed[0])
			const items = []
			while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
				items.push(`<li>${inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`)
				i++
			}
			i--
			blocks.push(`<${ordered ? 'ol' : 'ul'} class="words-list">${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
			continue
		}
		const paragraph = [line]
		while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !/^\s*(?:[-*]|\d+\.)\s+|^\s*```/.test(lines[i + 1])) {
			paragraph.push(lines[++i])
		}
		blocks.push(`<p>${inline(paragraph.join(' ').replace(/^#+\s+/, ''))}</p>`)
	}
	return `<div class="words">${blocks.join('')}</div>`
}

// `code` as code and **bold** as bold, after escaping.
function inline(text) {
	return prose(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

// One renderer per kind of card. The page names a kind it cannot show, so a missing renderer never hides a card.
const CARD_RENDERERS = {
	claim: (card, key, rows) => claimHtml(card.claim, key, rows, ''),
	risk: (card, key, rows) => claimHtml(card.risk, key, rows, 'Risk'),
	decision: (card, key, rows) => decisionCardHtml(card.decision, key, rows),
	diagram: (card, _key, rows, id) => diagramHtml(card.diagram, id, rows),
	layout: (card, key, rows) => layoutCardHtml(card.layout, key, rows),
	topic: (card, key, rows) =>
		`<p class="card-text"><span class="card-kind">Topic</span> <strong>${prose(card.topic.name)}</strong> rests on these lines.</p>${quoteRows(card.topic.quotes, key, rows)}`,
	withdrawn: (card, key, rows) => {
		const { risk, reason, proof } = card.withdrawn
		return `<p class="card-marks">${markHtml('card-kind', 'Withdrawn risk', RISK_MARKS.withdrawnMeans)}</p><p class="card-text">${prose(risk.text)}</p>
			<p class="small"><span class="d-field">Why it was withdrawn</span> ${prose(reason)}</p>
			${quoteRows(proof, key, rows)}`
	},
}

export function arrowItem(arrow) {
	return { text: `${arrow.from} ${arrow.text} ${arrow.to}`, quotes: arrow.quotes }
}

// A level of the project's parts that the model named: each part and its job, then each arrow with the lines it rests
// on. The home shows the same level as boxes.
function layoutCardHtml(layout, key, rows) {
	const where =
		layout.within.length === 0 ? 'the whole project' : list(layout.within.map((p) => `<code>${esc(p)}</code>`))
	const parts = layout.parts.map((part) => `<li><strong>${prose(part.name)}</strong> ${prose(part.job)}</li>`).join('')
	const arrows = layout.arrows
		.map(
			(arrow, n) =>
				`<li><p class="card-text">${prose(arrowItem(arrow).text)}</p>${quoteRows(arrow.quotes, `${key}a${n}`, rows)}</li>`,
		)
		.join('')
	return `<p class="card-text"><span class="card-kind">Parts</span> The parts of ${where}, as ken's model named them. ken draws the picture of the project from them.</p>
		<ul class="layout-parts">${parts}</ul>
		${arrows === '' ? '' : `<ul class="layout-arrows">${arrows}</ul>`}`
}

function cardHtml(card, t, j, rows) {
	const key = cardKey(t, j)
	const render = CARD_RENDERERS[card.kind]
	const body = render
		? render(card, key, rows, diagramId(t, j))
		: '<p class="card-text">ken sent a card this page cannot show.</p>'
	return `<div class="card card-${esc(card.kind)}" id="item-${key}"><span class="card-check" title="Quotes found in git" aria-label="Quotes found in git">✓</span><div class="card-body">${body}</div></div>`
}

// A claim or a risk: its marks on a line of their own, its text, ken's search for what it says is missing, and its quote
// rows. "Inferred" is the label of most claims, so only another label is shown.
function claimHtml(claim, key, rows, kind) {
	const tag = kind ? `<span class="card-kind">${kind}</span>` : ''
	const marked = claim.label && claim.label !== 'inferred' ? label(claim.label, true) : ''
	const marks = `${tag}${marked}${fixedHtml(claim)}${unreviewedHtml(claim)}${checkedHtml(claim)}${weightHtml(claim)}`
	return `${marks === '' ? '' : `<p class="card-marks">${marks}</p>`}<p class="card-text">${prose(claim.text)}</p>
		${searchedHtml(claim.absent)}
		${quoteRows(claim.quotes, key, rows)}`
}

// A decision shows its question, the option taken and why; its quotes and how hard it is to reverse open in place.
function decisionCardHtml(d, key, rows) {
	const open = rows.ui.openDecisions.has(key)
	const quotes = decisionQuotes(d)
	const call = d.needsOwner ? '<span class="your-call">Your call</span> ' : ''
	const why = d.reason ? `<p class="d-why"><span class="d-field">Why</span> ${prose(d.reason.text)}</p>` : ''
	const what = open
		? 'Hide the quotes'
		: `Show ${count(quotes.length, 'quote', 'quotes')} and how hard it is to reverse`
	const answerIt = d.needsOwner && !d.answer ? `<p class="small">${answerItLink(key)}</p>` : ''
	const more = open
		? `<div class="d-card">${fromHtml(d)}${factsHtml(d, false)}${answerIt}${quoteRows(quotes, key, rows)}</div>`
		: ''
	return `<p class="card-text"><span class="card-kind">Decision</span> ${call}${label(d.label, true)} <span class="d-q">${prose(d.question)}</span> <span class="d-chosen"><span class="d-field">Chosen</span> ${prose(d.chosen)}</span></p>
		${why}
		${searchedHtml(d.absent)}
		<button class="link small d-more" data-act="decision" data-item="${key}" data-key="${key}-row" aria-expanded="${open}">${what}</button>
		${more}`
}

// ken's own search for the text a card says is missing, which found nothing.
function searchedHtml(absent) {
	if (!absent) return ''
	const under = absent.under === null ? '' : ` under <code>${esc(absent.under)}</code>`
	return `<p class="searched">ken searched for <code>${esc(absent.text)}</code>${under} at <code>${short(absent.commit)}</code> and found nothing.</p>`
}

// ken's own mark on a risk, from git: solid when a quote lies outside the change, dashed when not.
function checkedHtml({ checked }) {
	if (checked === undefined) return ''
	const [style, name, means] = checked
		? ['recorded', RISK_MARKS.outside, RISK_MARKS.outsideMeans]
		: ['inferred', RISK_MARKS.inside, RISK_MARKS.insideMeans]
	return markHtml(`label label-${style}`, name, means)
}

// ken's mark on a risk the second look held and never settled.
function unreviewedHtml({ unreviewed }) {
	if (!unreviewed) return ''
	return markHtml('label label-inferred', RISK_MARKS.unreviewed, RISK_MARKS.unreviewedMeans)
}

// ken's mark on a risk that quotes the message of a commit made after the change: the project fixed it since.
function fixedHtml({ fixedIn }) {
	if (fixedIn === undefined) return ''
	return markHtml('label label-recorded', `${RISK_MARKS.fixed} <code>${short(fixedIn)}</code>`, RISK_MARKS.fixedMeans)
}

// The model's weight on a risk. ken does not judge it.
function weightHtml({ weight }) {
	if (weight === undefined) return ''
	return markHtml('label label-inferred', weight === 'serious' ? 'Serious' : 'Minor', WEIGHT_MEANS[weight])
}

// A decision in a list: its question and the option the code took, a row that opens it in place.
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

// A decision's facts under what was chosen, the same in a reply, in "Waiting on you" and in Decisions: why, the
// other options when there are any, and how hard it is to reverse.
export function factsHtml(d, why = true) {
	const others = d.rejected
		.map((r) => `<dd>${prose(r.option)}<span class="why">Why not: ${prose(r.reason)}</span></dd>`)
		.join('')
	return `<dl class="facts">
		${why && d.reason ? `<div><dt>Why</dt><dd>${prose(d.reason.text)}${fromHtml(d)}${searchedHtml(d.absent)}</dd></div>` : ''}
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
