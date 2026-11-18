// A walkthrough of a change: the model's steps, in the order a reviewer should read them, beside the change card's
// picture. Plain code links each step to what it is about. The server sends the hunks each step's quotes overlap; the
// page finds the parts its quotes fall in, by path, in the same top level the picture shows. A reply with no steps
// has no walkthrough.
import { count, esc, isSession, lineSpan, prose } from '../views/format.js'

// Lines a hunk shows before it says how many more it has.
const SHOWN_LINES = 60

// The steps of a reply by number, each with its cards, as { card, j } with j the card's place in the reply, and the
// hunks its quotes overlap. A reply saved before ken had steps has none.
export function walkOf(reply) {
	const items = reply?.items ?? []
	const hunks = reply?.change?.stepHunks ?? []
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
		}))
}

// The file paths a card quotes. A quote of a session or a commit message names no file.
export function cardPaths(card) {
	const quotes =
		card.kind === 'claim'
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
	return quotes.flatMap((quote) => (isSession(quote) || quote.path === null ? [] : [quote.path]))
}

// The box of the level that holds the file, or -1: a box holds a file when one of its paths is the file or a folder
// above it.
export function partOf(file, boxes) {
	return boxes.findIndex((box) => box.paths.some((place) => file === place || file.startsWith(`${place}/`)))
}

// The boxes a step's quotes fall in.
export function stepParts(step, boxes) {
	return new Set(
		step.cards.flatMap(({ card }) => cardPaths(card).map((file) => partOf(file, boxes))).filter((i) => i >= 0),
	)
}

// The steps as a list the reader moves through. at is the number of the step the reader is on, or null. cardHtml draws
// a card of the reply. under puts the step's cards and changed lines under it, on a screen with no panel beside the
// thread; with the panel they open there, so every step stays in view beside the picture.
export function walkHtml(steps, t, { at, boxes, cardHtml, under, change }) {
	const where = steps.findIndex((step) => step.number === at)
	const items = steps.map((step, k) => {
		const on = step.number === at
		const parts = boxes ? [...stepParts(step, boxes)] : []
		const named = parts.map((i) => boxes[i].name)
		const lines =
			step.hunks.length === 0 ? 'No changed lines' : count(step.hunks.length, 'changed block', 'changed blocks')
		return `<li class="walk-step${on ? ' is-on' : ''}" data-parts="${parts.join(' ')}" data-step="${step.number}">
			<button class="walk-head" data-act="walk-step" data-turn="${t}" data-step="${step.number}" data-key="walk-${t}-${step.number}" aria-expanded="${on}">
				<span class="walk-n" aria-hidden="true">${k + 1}</span>
				<span class="walk-text">${prose(step.text)}</span>
				<span class="walk-meta">${named.length > 0 ? `${esc(named.join(', '))}. ` : ''}${lines}.</span>
			</button>
			${on && under ? `<div class="walk-diff-under">${stepDiffHtml(step, change)}</div>` : ''}
			${on && under ? `<div class="walk-cards">${step.cards.map(({ card, j }) => cardHtml(card, j)).join('')}</div>` : ''}
		</li>`
	})
	const nav = `<div class="walk-nav">
		<button class="quiet-button" data-act="walk-by" data-by="-1" data-turn="${t}" data-key="walk-prev-${t}"${where <= 0 ? ' disabled' : ''}>Previous</button>
		<span class="walk-where">${where < 0 ? `${count(steps.length, 'step', 'steps')}` : `Step ${where + 1} of ${steps.length}`}</span>
		<button class="quiet-button" data-act="walk-by" data-by="1" data-turn="${t}" data-key="walk-next-${t}"${where === steps.length - 1 ? ' disabled' : ''}>${where < 0 ? 'Start' : 'Next'}</button>
	</div>`
	return `<section class="walk" data-turn="${t}" aria-label="The change, step by step">
		<h4 class="cc-sub walk-title">The change, step by step</h4>
		<p class="cc-line">Pick a step to light its parts and open its changed lines. The arrow keys move between steps.</p>
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
