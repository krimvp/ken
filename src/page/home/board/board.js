// The board's own column, beside the picture while nothing is picked: "Next for you", the few things the server
// ranked from what the reader looked at and from git, and "What ken recorded lately", the newest lines of the file
// ken keeps on the reader's machine. A card leads with the thing itself: what landed in a part, the parts a change
// touches, a part's job. Each has one button that says where it opens, and only the first is filled.

import { DETAILS } from '../../level/level-state.js'
import { partClass } from '../../project/part-colours.js'
import { count, day, esc, prose } from '../../views/format.js'
import { plusMinus } from '../canvas/part-box.js'
import { miniPictureHtml } from './mini-picture.js'

const SHOWN_NEXT = 4
const SHOWN_RECORDED = 3

// What a card's button says before the detail it opens at.
const OPENS = {
	stale: () => 'See what changed',
	review: () => 'Review it',
	tour: (item) => (item.title.startsWith('Start') ? 'Start the tour' : 'Go on with the tour'),
	read: () => 'Read it',
}

// The thing a card is about, under its title: the parts a change touches, or the job of a part to read. A part that
// changed leads with its count in the sentence on why, which then says how much landed.
function leadHtml(look, item) {
	const box = look.boxes.find((each) => each.name === item.parts[0])
	if (item.kind === 'review' && item.parts.length > 0) {
		const names = item.parts.map((name) => `<span class="part-name ${partClass(name)}">${esc(name)}</span>`)
		return `<p class="next-lead next-parts">It touches ${names.join(' ')}</p>`
	}
	if ((item.kind === 'tour' || item.kind === 'read') && box?.job) return `<p class="next-lead">${prose(box.job)}</p>`
	return ''
}

function whyHtml(item) {
	const landed = item.landed
		? ` <span class="next-landed">${plusMinus(item.landed)} in ${count(item.landed.files, 'file', 'files')}.</span>`
		: ''
	return `<p class="next-why">${esc(item.why)}${landed}</p>`
}

function cardHtml(home, item, i) {
	const { look } = home
	const first = i === 0 ? 'primary' : 'quiet-button'
	const button =
		item.kind === 'decision'
			? `<button class="${first}" data-act="decisions" data-key="next-go-${i}">Open the decisions</button>`
			: `<button class="${first}" data-act="home-go" data-index="${i}" data-key="next-go-${i}">${OPENS[item.kind](item)}, at ${DETAILS[home.pinned ?? item.go.detail]}</button>`
	const mini = item.parts.length > 0 ? miniPictureHtml(look, item.parts) : ''
	return `<li class="next-card" data-parts="${esc(JSON.stringify(item.parts))}">
			<div class="next-top"><h3 class="next-title">${esc(item.title)}</h3>${mini}</div>
			${leadHtml(look, item)}
			${whyHtml(item)}
			${button}
		</li>`
}

function nextHtml(home) {
	const { items, line } = home.look.next
	const cards = items.slice(0, SHOWN_NEXT).map((item, i) => cardHtml(home, item, i))
	const body =
		cards.length > 0 ? `<ol class="next-list">${cards.join('')}</ol>` : `<p class="board-empty">${esc(line)}</p>`
	return `<section class="board-panel" aria-labelledby="insp-title">
			<div class="board-head"><h2 class="board-title" id="insp-title" data-key="insp-title" tabindex="-1">Next for you</h2><span class="board-note">ranked from what you looked at and from git</span></div>
			${body}
		</section>`
}

// A line is a moment for what the reader looked at and a day for a line of the map.
const dayOf = (at) => day(at.length > 10 ? new Date(at).toLocaleDateString('en-CA') : at)

function recordedHtml(home) {
	const { reader } = home
	if (!reader) return ''
	const kept = `<span class="board-file" tabindex="0" data-tip="${esc(reader.file)}" data-key="recorded-file">ken keeps this in a file on your machine.</span>`
	const head = '<div class="board-head"><h2 class="board-title" id="recorded-title">What ken recorded lately</h2></div>'
	if (reader.learned.length === 0) {
		return `<section class="board-panel" aria-labelledby="recorded-title">${head}
				<p class="board-empty">Nothing yet. ken writes a line here when you open a part, stay on its explanation, open its code or walk through a change. You can take any line back.</p>
				<p class="board-foot">${kept}</p>
			</section>`
	}
	const shown = home.recordedOpen ? reader.learned : reader.learned.slice(0, SHOWN_RECORDED)
	const rows = shown.map(
		(line, i) =>
			`<li class="recorded-line"${line.part ? ` data-parts="${esc(JSON.stringify([line.part]))}"` : ''}><span class="recorded-day">${dayOf(line.at)}</span><span class="recorded-text">${esc(line.text)}</span><button class="link recorded-undo" data-act="home-undo" data-index="${i}" data-key="undo-${esc(line.at)}-${esc(line.topic ?? line.did)}" aria-label="Not right: ${esc(line.text)}">Not right</button></li>`,
	)
	const more = reader.learned.length - SHOWN_RECORDED
	const all =
		more <= 0
			? ''
			: `<button class="link" data-act="home-recorded" data-key="recorded-all" aria-expanded="${home.recordedOpen}">${home.recordedOpen ? 'Show the newest 3' : `All ${reader.learned.length} lines`}</button>`
	const skipped =
		reader.problems.length === 0
			? ''
			: `<p class="board-foot">ken skipped ${count(reader.problems.length, 'line', 'lines')} of the file that it could not read.</p>`
	return `<section class="board-panel" aria-labelledby="recorded-title">${head}
			<ul class="recorded-list">${rows.join('')}</ul>
			<p class="board-foot">${all}${kept}</p>${skipped}
		</section>`
}

export function boardHtml(home) {
	return `${nextHtml(home)}${recordedHtml(home)}`
}
