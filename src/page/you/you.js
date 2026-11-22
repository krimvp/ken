// The You page: the reader's own map of the project. The project stands in the middle and each part is a branch in
// its colour that grows with what ken thinks the reader knows of it: a part not opened is a dashed bud, a part seen
// has colour, a part read grows its inner branches, the parts inside it, a part whose code they read has a thicker
// branch, and a part they said they know is solid with a tick. A badge counts the commits that landed since they
// looked. Beside the map: what ken recorded lately, each line with "Not right", the notes ken keeps on how the
// reader likes things shown, and where these files are.
import { partId } from '../brief/concept-id.js'
import { KNOWN, levelLabel } from '../level/level-state.js'
import { partClass } from '../project/part-colours.js'
import { icon, levelMark } from '../shell/icons.js'
import { esc, prose } from '../views/format.js'
import { changedParts } from '../views/open.js'

const [W, H] = [1000, 640]
const CENTRE = { x: W / 2, y: H / 2 }
// How wide a branch is drawn at each level, weakest first.
const BRANCH = { new: 2.5, seen: 5, read: 7, code: 11, said: 13 }
const SHOWN_INSIDE = 5
const SHOWN_LINES = 8

const grows = (level) => KNOWN.indexOf(level) >= KNOWN.indexOf('read')

// Each part's place on an ellipse round the project, the first at the top, and which side its inner branches go.
function placed(boxes) {
	return boxes.map((box, i) => {
		const turn = (i / boxes.length) * 2 * Math.PI - Math.PI / 2 + Math.PI / boxes.length
		const x = CENTRE.x + 235 * Math.cos(turn)
		const y = CENTRE.y + 225 * Math.sin(turn)
		return { box, x, y, side: x < CENTRE.x ? -1 : 1 }
	})
}

// inside holds the names of the parts inside each part, by its name, once read.
function mindHtml(look, inside, project, home) {
	const nodes = placed(look.boxes)
	const lines = []
	const html = []
	for (const [i, { box, x, y, side }] of nodes.entries()) {
		const { level, stale, since } = box.knows
		const colour = partClass(box.name)
		const bend = `${(CENTRE.x + x) / 2} ${y}`
		lines.push(
			`<path class="${colour} is-${level}" d="M${CENTRE.x} ${CENTRE.y}Q${bend} ${x} ${y}" stroke-width="${BRANCH[level]}"/>`,
		)
		const badge =
			stale && since > 0
				? `<span class="k-badge k-mind-badge">${icon('changed')}<span class="k-num">${since}</span><span class="visually-hidden">${since === 1 ? 'commit' : 'commits'} since you looked</span></span>`
				: ''
		const tick = level === 'said' ? `<span class="k-mind-tick">${icon('tick')}</span>` : ''
		html.push(
			`<button class="k-mind-node ${colour} is-${level}" style="--x:${(x / W) * 100}%;--y:${(y / H) * 100}%" data-act="brief-open" data-concept="${esc(partId(look.within, box.name))}" data-key="mind-${i}">${badge}${tick}<b>${esc(box.name)}</b><span class="k-mind-level">${levelMark(level, 14)}${esc(levelLabel(home, level))}</span></button>`,
		)
		const inner = grows(level) ? (inside.get(box.name) ?? []).slice(0, SHOWN_INSIDE) : []
		for (const [k, name] of inner.entries()) {
			const [cx, cy] = [x + side * 185, y + (k - (inner.length - 1) / 2) * 36]
			lines.push(
				`<path class="${colour} is-inner" d="M${x + side * 100} ${y}C${x + side * 118} ${y} ${cx - side * 80} ${cy} ${cx - side * 62} ${cy}"/>`,
			)
			html.push(
				`<span class="k-mind-in ${colour}" style="--x:${(cx / W) * 100}%;--y:${(cy / H) * 100}%">${esc(name)}</span>`,
			)
		}
	}
	const label = `${project} and its ${look.boxes.length} parts, each drawn as far as ken thinks you know it`
	return `<div class="k-mind" role="group" aria-label="${esc(label)}">
		<svg class="k-mind-lines" viewBox="0 0 ${W} ${H}" aria-hidden="true">${lines.join('')}</svg>
		<span class="k-mind-root" style="--x:50%;--y:50%"><b>${esc(project)}</b><span>${look.boxes.length} parts</span></span>
		${html.join('')}
	</div>`
}

// The key names only what the map shows: the levels its parts are at, and the badge when a part carries one.
function legendHtml(home, look) {
	const shown = new Set(look.boxes.map((box) => box.knows.level))
	const rows = KNOWN.filter((level) => shown.has(level)).map(
		(level) => `<li><span class="k-mind-sample is-${level}"></span>${esc(levelLabel(home, level))}</li>`,
	)
	const badge =
		changedParts(look).length > 0
			? `<li><span class="k-badge">${icon('changed')}<span class="k-num">1</span></span>changed since you looked</li>`
			: ''
	return `<div class="k-mind-key"><h2 class="k-eyebrow">A part grows as you learn it</h2><ul>${rows.join('')}${badge}</ul></div>`
}

const dayOf = (at) =>
	new Date(at.length === 10 ? `${at}T12:00:00Z` : at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// What ken recorded, newest first, with the same thing done on the same day as one line and how many times. i is the
// newest line's place in the list, which "Not right" acts on.
function sameDayOnce(learned) {
	const lines = []
	for (const [i, line] of learned.entries()) {
		const same = lines.find((each) => each.line.text === line.text && dayOf(each.line.at) === dayOf(line.at))
		if (same) same.times += 1
		else lines.push({ line, i, times: 1 })
	}
	return lines
}

// One line of what ken recorded. fixing is the line whose "Not right" is open.
function lineHtml({ line, i, times }, { look, home, you }) {
	const box = line.part ? look.boxes.find((each) => each.name === line.part) : null
	const swatch = line.part ? `<span class="k-sw ${partClass(line.part)}"></span>` : ''
	const often = times > 1 ? ` <span class="k-muted">${times} times</span>` : ''
	const head = `<span class="k-rec-day">${esc(dayOf(line.at))}</span><span class="k-rec-text">${swatch}${prose(line.text)}${often}</span>`
	if (you.fixing !== i) {
		return `<li class="k-rec">${head}<button class="k-link" data-act="you-fix" data-index="${i}" data-key="rec-${i}" aria-label="Not right: ${esc(line.text)}">Not right</button></li>`
	}
	const rungs = box
		? `<p class="k-ladder-q">What do you know of ${prose(box.name)}?</p>${KNOWN.map(
				(level) =>
					`<button class="k-rung" data-act="you-set" data-level="${level}" data-name="${esc(box.name)}" data-key="you-set-${level}" aria-pressed="${level === box.knows.level}">${levelMark(level, 18)}<span>${esc(levelLabel(home, level))}</span>${level === box.knows.level ? '<em>ken thinks this</em>' : ''}</button>`,
			).join('')}`
		: ''
	return `<li class="k-rec is-fixing">${head}
		<div class="k-ladder" role="group" aria-label="Correct what ken recorded">
			<button class="k-btn is-quiet" data-act="you-undo" data-index="${i}" data-key="you-undo">${line.topic ? `I do not know ${prose(line.topic)}` : 'Take this line back'}</button>
			${rungs}
			<button class="k-link" data-act="you-fix" data-index="-1" data-key="you-fix-cancel">Cancel</button>
		</div></li>`
}

function sideHtml({ look, home, you }) {
	const reader = home.reader
	const learned = reader?.learned ?? []
	const once = sameDayOnce(learned)
	const shown = you.all ? once : once.slice(0, SHOWN_LINES)
	const lines =
		learned.length === 0
			? `<div class="k-rec-none">${icon('you')}<p><b>Nothing recorded yet.</b></p><p>ken writes down what you open and read, and fills your map as you go. You do not have to tell it anything.</p></div>`
			: `<ul class="k-recs">${shown.map((each) => lineHtml(each, { look, home, you })).join('')}</ul>${once.length > SHOWN_LINES ? `<button class="k-link" data-act="you-all" data-key="you-all">${you.all ? 'Show fewer' : `Show all ${once.length}`}</button>` : ''}`
	const notes =
		home.notes.length === 0
			? '<p class="k-muted">None yet. Tell ken how you like things shown with "Draw it another way" on the Architecture page, and it keeps a note.</p>'
			: `<ul class="k-you-notes">${home.notes
					.map(
						(note) =>
							`<li><span>${esc(note.text)}</span><button class="k-link" data-act="note-remove" data-id="${esc(note.id)}" data-key="note-${esc(note.id)}" aria-label="Remove the note: ${esc(note.text)}">Remove</button></li>`,
					)
					.join('')}</ul>`
	const folder = reader?.file ? reader.file.slice(0, reader.file.lastIndexOf('/')) : null
	const files = folder
		? `<p class="k-files">What ken recorded of you is in <code>${esc(folder)}</code>, on this computer, outside the project.</p>`
		: '<p class="k-files">ken keeps what it records of you on this computer, outside the project.</p>'
	return `<aside class="k-tile k-you-side" aria-label="What ken recorded">
		<h2 class="k-you-title" id="recorded-title" tabindex="-1">What ken recorded</h2>
		${you.problem ? `<p class="k-ask-problem" role="alert">${esc(you.problem)}</p>` : ''}
		${you.said ? `<p class="k-knows-said" role="status">${esc(you.said)}</p>` : ''}
		${lines}
		<h2 class="k-eyebrow">How you like things shown</h2>
		${notes}
		${home.noteProblem ? `<p class="k-ask-problem" role="alert">ken could not remove the note. ${esc(home.noteProblem)}</p>` : ''}
		<h2 class="k-eyebrow">Where these files are</h2>
		${files}
	</aside>`
}

// view is { look, inside, home, you, project }: the top level, the parts inside each part read so far, the level's
// state with what ken recorded and its notes, the page's own state, and the project's name.
export function youPageHtml(view) {
	const { look } = view
	if (!look)
		return '<div class="k-you-page"><p class="k-home-line" role="status">Reading the project from git.</p></div>'
	return `<div class="k-you-page">
		<section class="k-tile k-you-map" aria-labelledby="you-map-title">
			<h2 class="visually-hidden" id="you-map-title">Your map of ${esc(view.project)}</h2>
			${mindHtml(look, view.inside, view.project, view.home)}
			${legendHtml(view.home, look)}
		</section>
		${sideHtml(view)}
	</div>`
}
