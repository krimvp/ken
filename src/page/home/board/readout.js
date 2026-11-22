// The readout line under the picture: what ken thinks the reader knows of one box, why it thinks so, and two presses.
// "Not right" opens the five levels to pick from, and "Open" goes to the part where ken would open it. The box is the
// one the reader picked, else the one they last pointed at or moved to. With none, the line says what the fill means.
// ken says "thinks" of everything it worked out from what the reader looked at: only the reader says they know a part.

import { DETAILS, KNOWN } from '../../level/level-state.js'
import { esc } from '../../views/format.js'
import { sinceLooked } from '../canvas/part-box.js'

const THINKS = {
	new: (name) => `ken thinks ${name} is new to you.`,
	seen: (name) => `ken thinks you have seen ${name}.`,
	read: (name) => `ken thinks you have read about ${name}.`,
	code: (name) => `ken thinks you have read the code of ${name}.`,
	// The line on why says that the reader said so, and when.
	said: (name) => `${name}.`,
}

// What the reader says of a part when they correct ken, weakest first.
const SAYS = {
	new: 'It is new to me',
	seen: 'I have only seen it',
	read: 'I have read about it',
	code: 'I have read its code',
	said: 'I know it',
}

const FILL = 'The more ken thinks you know a part, the more of its box is filled.'
const FIRST = 'ken fills a box as you open, read and look at code. You do not have to tell it anything.'

// The box the line is about, or null.
export function readoutBox(home) {
	const picked = home.selected?.kind === 'part' ? home.selected.name : null
	const name = home.fixing ?? picked ?? home.pointed
	return home.look?.boxes.find((box) => box.name === name) ?? null
}

// Where a press on "Open" takes the reader, in words: what changed for a part that changed, else the detail in use.
export function opensAt(home, go) {
	const detail = home.pinned ?? go.detail
	return go.way === 'catch-up' ? 'See what changed' : `Open at ${DETAILS[detail]}`
}

export function readoutHtml(home) {
	const { look } = home
	// A picture ken drew has no boxes to fill, so the line has nothing to say over it.
	if (!look || home.reading === 'level' || look.boxes.length === 0 || home.content.kind === 'drawn') return ''
	const box = readoutBox(home)
	if (!box) {
		const first = look.boxes.every((each) => each.knows.level === 'new') && (home.reader?.learned.length ?? 0) === 0
		return `<p class="readout-line">${first ? FIRST : FILL}</p>`
	}
	const { knows } = box
	if (home.fixing === box.name) {
		const picks = KNOWN.map(
			(level) =>
				`<button class="chip" data-act="home-set" data-level="${level}" data-key="set-${level}" aria-pressed="${level === knows.level}">${SAYS[level]}</button>`,
		)
		return `<div class="readout-fix" role="group" aria-labelledby="readout-ask"><span class="readout-ask" id="readout-ask">What do you know of ${esc(box.name)}?</span>${picks.join('')}<button class="link" data-act="home-fix" data-key="fix-cancel">Cancel</button></div>`
	}
	const since = knows.stale ? ` <strong class="pv-since">${sinceLooked(knows)}.</strong>` : ''
	return `<p class="readout-line"><strong>${esc(THINKS[knows.level](box.name))}</strong> ${esc(knows.why)}${since}</p>
		<p class="readout-acts"><button class="quiet-button" data-act="home-fix" data-name="${esc(box.name)}" data-key="fix-open">Not right</button><button class="quiet-button" data-act="home-go-box" data-name="${esc(box.name)}" data-key="readout-open">${opensAt(home, knows.go)}</button></p>`
}
