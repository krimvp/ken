// One box of the picture: a part's name and job, how far ken thinks the reader knows it, and what a change laid over
// the picture did to it. The box fills from the bottom as far as ken thinks the reader knows the part, and says the
// level in words beside a meter, so the level never rests on colour alone. A part new to the reader is dashed and
// empty. A part that commits touched since the reader looked says how many.
import { count, esc, pathList, prose } from '../../views/format.js'
import { KNOWN, levelLabel } from '../state/home-state.js'

// Paths a box lists before it says how many more it holds.
const SHOWN_PATHS = 3

// A box that is one file, named by the file: its name says where it is, and its count says nothing.
export function isFile(box) {
	return box.files === 1 && box.paths.length === 1 && box.paths[0].split('/').at(-1) === box.name
}

export function pathsLine(box) {
	const files = count(box.files, 'file', 'files')
	if (box.paths.length === 1 && box.paths[0].split('/').at(-1) === box.name)
		return `<span class="pv-paths">${files}</span>`
	const shown = pathList(box.paths.slice(0, SHOWN_PATHS))
	const more = box.paths.length - SHOWN_PATHS
	const paths = more > 0 ? `${shown} and ${more} more` : shown
	return `<span class="pv-paths">${paths}. ${files}.</span>`
}

// At the commit checked out now, a named part says whether it changed since ken's model named it. At an older commit,
// every box says whether it was different then from now.
export function stateLine(box, look) {
	if (box.state === 'gone') return '<span class="pv-state">Not there at this commit</span>'
	if (box.state !== 'changed') return ''
	const said = look.at === look.head ? "Changed since ken's model named these parts" : 'Different then from now'
	return `<span class="pv-state">${said}</span>`
}

export function plusMinus({ added, removed }) {
	return `<span class="home-plus"><span class="visually-hidden">lines added: </span>+${added}</span> <span class="home-minus"><span class="visually-hidden">removed: </span>-${removed}</span>`
}

export function sinceLooked(knows) {
	return `${count(knows.since, 'commit', 'commits')} since you looked`
}

// The level in words beside a meter of four marks: none for a part new to the reader, four for one they said they
// know.
export function knowsHtml(home, knows) {
	const at = KNOWN.indexOf(knows.level)
	const marks = KNOWN.slice(1).map((_, i) => `<i${i < at ? ' class="is-on"' : ''}></i>`)
	return `<span class="pv-know"><span class="know-meter" aria-hidden="true">${marks.join('')}</span>${esc(levelLabel(home, knows.level))}</span>`
}

// What a box says under its name. A named part says its job, and its paths at "In the code", where the panel says
// the job. The one it does not say lies under the other, unseen, so the box is as tall at every detail and the
// picture does not move when the detail changes.
function saysHtml(box, look, detail) {
	if (!look.named) return isFile(box) ? '' : pathsLine(box)
	const job = `<span class="pv-job">${prose(box.job ?? '')}</span>`
	const [said, other] = detail === 'code' ? [pathsLine(box), job] : [job, pathsLine(box)]
	return `<span class="pv-says">${said}<span class="pv-unseen" aria-hidden="true">${other}</span></span>`
}

// A box as tall as its row has room for more of its job than a box as tall as its words. Each shows the whole lines
// that fit, and never fewer than two. Called after the canvas is drawn and when it changes size.
export function fitJobs(canvas) {
	const boxes = [...canvas.querySelectorAll('.pv-says')]
	const fits = boxes.map((says) => {
		const line = Number.parseFloat(getComputedStyle(says).lineHeight)
		return Math.max(2, Math.floor((says.getBoundingClientRect().height + 0.5) / line))
	})
	for (const [i, says] of boxes.entries()) says.style.setProperty('--lines', fits[i])
}

// colour is the class of the part's colour, badge the box's stop or steps on the reading path, and chosen whether the
// reader picked it.
export function boxHtml(box, i, { home, detail, colour, badge, chosen }) {
	const { look } = home
	const { knows } = box
	const touched = box.touched
		? `<span class="home-touched">${count(box.touched.files, 'file', 'files')} ${plusMinus(box.touched)}</span>`
		: look.change
			? '<span class="cc-quiet">Not touched</span>'
			: ''
	const since = knows.stale ? `<span class="pv-since">${sinceLooked(knows)}</span>` : ''
	const body = `${badge ? `<span class="pv-badge">${badge}</span>` : ''}
		<span class="pv-name">${esc(box.name)}</span>
		${saysHtml(box, look, detail)}
		${stateLine(box, look)}
		${touched}
		<span class="pv-foot">${knowsHtml(home, knows)}${since}</span>`
	const classes = `pv-box is-${box.state} knows-${knows.level}${box.touched ? ' is-touched' : ''} ${colour}`
	const html = `<button class="${classes}" style="--known:${KNOWN.indexOf(knows.level) / (KNOWN.length - 1)}" data-act="home-box" data-index="${i}" data-key="home-box-${i}" aria-pressed="${chosen}">${body}</button>`
	const faded = look.change && !box.touched ? ' is-faded' : ''
	return { html, classes: `pv-cell${faded}${chosen ? ' is-chosen' : ''}` }
}
