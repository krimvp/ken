// A walkthrough of a change, or a tour of the project: the model's steps beside a picture of the parts. Plain code
// links each step to what it is about. For a change, the server sends the hunks each step's quotes overlap and the
// page finds the parts its quotes fall in, by path, in the same top level the picture shows. For a tour, step n is
// stop n, whose part plain code picked, and the reader's map says which stops they reached. A reply with no steps has
// no walkthrough.
import { count, esc, isSession, lineSpan, prose } from '../views/format.js'

// Lines a hunk shows before it says how many more it has.
const SHOWN_LINES = 60

// The steps of a reply by number, each with its cards, as { card, j } with j the card's place in the reply, the hunks
// its quotes overlap, and on a tour the name of its stop's part. A reply saved before ken had steps has none.
export function walkOf(reply) {
	const items = reply?.items ?? []
	const hunks = reply?.change?.stepHunks ?? []
	const stops = reply?.tour?.stops ?? []
	return items
		.filter((item) => item.kind === 'step')
		.sort((a, b) => a.number - b.number)
		.map((step) => ({
			number: step.number,
			text: step.text,
			cards: items.flatMap((item, j) =>
				item.kind === 'card' && item.step === step.number ? [{ card: item.card, j }] : [],
			),
			hunks: hunks.find((each) => each.step === step.number)?.hunks ?? [],
			part: stops[step.number - 1]?.name ?? null,
		}))
}

// The topics of a stop: its part's, and those its cards name.
export function stopTopics(step) {
	const named = step.cards.map(({ card }) => card.claim?.topic ?? card.risk?.topic ?? card.decision?.topic)
	return [step.part, ...named].filter(Boolean)
}

// Where the reader stands on a stop, from the states of the reply's topics on their map: "known" when they said they
// know each of its topics, "met" when they reached it, "new" before. A stop whose topics the record does not hold
// stays new.
export function stopState(step, states) {
	const names = stopTopics(step).map((name) => name.toLowerCase())
	const mine = (states ?? []).filter((state) => names.includes(state.topic.toLowerCase()))
	if (mine.length === 0 || mine.some((state) => state.kind === 'never-met')) return 'new'
	return mine.every((state) => state.kind !== 'met') ? 'known' : 'met'
}

// The stop a tour goes on at: the first the reader has not reached, or the first when they reached them all.
export function tourStart(steps, states) {
	return (steps.find((step) => stopState(step, states) === 'new') ?? steps[0])?.number ?? null
}

const STOP_SAID = { new: '', met: 'Seen', known: 'You know this part' }

// The quotes a card rests on.
export function cardQuotes(card) {
	return card.kind === 'claim'
		? card.claim.quotes
		: card.kind === 'risk'
			? card.risk.quotes
			: card.kind === 'decision'
				? [...card.decision.quotes, ...(card.decision.reason?.quotes ?? [])]
				: card.kind === 'topic'
					? card.topic.quotes
					: card.kind === 'withdrawn'
						? card.withdrawn.proof
						: []
}

// The file paths a card quotes. A quote of a session or a commit message names no file.
export function cardPaths(card) {
	return cardQuotes(card).flatMap((quote) => (isSession(quote) || quote.path === null ? [] : [quote.path]))
}

// The box of the level that holds the file, or -1: a box holds a file when one of its paths is the file or a folder
// above it.
export function partOf(file, boxes) {
	return boxes.findIndex((box) => box.paths.some((place) => file === place || file.startsWith(`${place}/`)))
}

// The boxes a step is about: its stop's part on a tour, else the boxes its quotes fall in.
export function stepParts(step, boxes) {
	if (step.part !== null) {
		const i = boxes.findIndex((box) => box.name === step.part)
		return new Set(i < 0 ? [] : [i])
	}
	return new Set(
		step.cards.flatMap(({ card }) => cardPaths(card).map((file) => partOf(file, boxes))).filter((i) => i >= 0),
	)
}

// A step's words as a title and a body, so nothing is said twice: its first sentence, whole, and the rest. A stop of
// a tour is titled by its part, and all its words are body.
export function stepWords(step) {
	if (step.part !== null) return { title: step.part, body: step.text }
	const [first = '', ...rest] = step.text.trim().split(/(?<=[.?!])\s+(?=[A-Z`"'(])/)
	return { title: first.replace(/\.$/, ''), body: rest.join(' ') }
}

// The steps as a list the reader moves through, one line each: the step's number, its title and, on a tour, whether
// the reader saw it. at is the number of the step the reader is on, or null. cardHtml draws a card of the reply. under
// opens the step under its line, on a screen with no panel beside the thread: its text, changed lines and cards. With
// the panel they open there. states is the reader's map on the reply's topics, for a tour, and knowHtml draws a
// stop's "I know this part".
export function walkHtml(steps, t, { at, boxes, cardHtml, under, change, tour = false, states = [], knowHtml }) {
	const where = steps.findIndex((step) => step.number === at)
	const word = tour ? 'stop' : 'step'
	const items = steps.map((step, k) => {
		const on = step.number === at
		const parts = boxes ? [...stepParts(step, boxes)] : []
		const stood = tour ? stopState(step, states) : 'new'
		const mark =
			stood === 'new'
				? ''
				: `<span class="walk-mark"><span aria-hidden="true">&#10003;</span> ${STOP_SAID[stood]}<span class="visually-hidden">. Done.</span></span>`
		const cards = `<div class="walk-cards">${step.cards.map(({ card, j }) => cardHtml(card, j)).join('')}</div>`
		const { title, body } = stepWords(step)
		const opened =
			!on || !under
				? ''
				: `<div class="walk-open">${body === '' ? '' : `<p class="walk-text">${prose(body)}</p>`}${
						tour
							? `${cards}${knowHtml(step, t)}`
							: `<div class="walk-diff-under">${stepDiffHtml(step, change)}</div>${cards}`
					}</div>`
		return `<li class="walk-step${on ? ' is-on' : ''} is-${stood}" data-parts="${parts.join(' ')}" data-step="${step.number}">
			<button class="walk-head" data-act="walk-step" data-turn="${t}" data-step="${step.number}" data-key="walk-${t}-${step.number}" aria-expanded="${on}">
				<span class="walk-n">${k + 1}</span>
				<span class="walk-name">${prose(title)}</span>
				${mark}
			</button>
			${opened}
		</li>`
	})
	const start = tour ? tourStart(steps, states) : steps[0]?.number
	const begin =
		start === steps[0]?.number ? 'Start' : `Go on at ${word} ${steps.findIndex((step) => step.number === start) + 1}`
	const nav = `<div class="walk-nav">
		<button class="quiet-button" data-act="walk-by" data-by="-1" data-turn="${t}" data-key="walk-prev-${t}"${where <= 0 ? ' disabled' : ''}>Previous</button>
		<span class="walk-where">${where < 0 ? `${count(steps.length, word, `${word}s`)}` : `${tour ? 'Stop' : 'Step'} ${where + 1} of ${steps.length}`}</span>
		<button class="quiet-button${where < 0 ? ' walk-start' : ''}" data-act="walk-by" data-by="1" data-turn="${t}" data-key="walk-next-${t}"${where === steps.length - 1 ? ' disabled' : ''}>${where < 0 ? begin : 'Next'}</button>
	</div>`
	const title = tour ? 'The tour, stop by stop' : 'The change, step by step'
	const how = tour
		? 'Pick a stop to light its part and read its code. The arrow keys move between stops.'
		: 'Pick a step to light its parts and open its changed lines. The arrow keys move between steps.'
	return `<section class="walk" data-turn="${t}" aria-label="${title}">
		<h4 class="cc-sub walk-title">${title}</h4>
		<p class="cc-line">${how}</p>
		<ol class="walk-steps">${items.join('')}</ol>
		${nav}
	</section>`
}

// The changed lines of a step as a diff: each block under its file, removed lines in red and added lines in green,
// with the line numbers before and after.
export function stepDiffHtml(step, change) {
	if (step.hunks.length === 0) {
		return '<p class="cc-line">No quote of this step falls on a changed line, so it has no diff to show.</p>'
	}
	return step.hunks.map((changed) => hunkHtml(changed, change)).join('')
}

function hunkHtml({ path, oldPath, hunk }, change) {
	const name =
		path === oldPath ? `<code>${esc(path)}</code>` : `<code>${esc(oldPath)}</code> to <code>${esc(path)}</code>`
	const span =
		hunk.newLength === 0
			? `removes ${lineSpan(hunk.oldStart, hunk.oldStart + hunk.oldLength - 1)}`
			: `${lineSpan(hunk.newStart, hunk.newStart + hunk.newLength - 1)} after the change`
	const shown = hunk.lines.slice(0, SHOWN_LINES)
	let before = hunk.oldStart
	let after = hunk.newStart
	const rows = shown.map((line) => {
		const sign = line[0]
		const [old, now, kind] =
			sign === '-' ? [before++, '', 'del'] : sign === '+' ? ['', after++, 'add'] : [before++, after++, '']
		const text = esc(line.slice(1)) || ' '
		const mark =
			sign === '-'
				? '<span class="visually-hidden">Removed: </span>'
				: sign === '+'
					? '<span class="visually-hidden">Added: </span>'
					: ''
		return `<span class="ln">${old}</span><span class="ln">${now}</span><span class="lc ${kind}">${mark}${text}</span>`
	})
	const more =
		hunk.lines.length > shown.length
			? `<span class="more">and ${count(hunk.lines.length - shown.length, 'more line', 'more lines')}. See them with git diff ${esc(change.base.slice(0, 7))} ${esc(change.head.slice(0, 7))} -- ${esc(path)}</span>`
			: ''
	return `<div class="walk-hunk"><p class="walk-file">${name}, ${span}</p><pre class="code diff"><code>${rows.join('')}${more}</code></pre></div>`
}
