// A reply about a change opens on a picture of what it touched: the project's top level of parts, each part the change
// touched marked with its files and lines, and the change's commits. Plain code draws it from git when the page shows
// the reply, so it needs no quote and cannot be wrong about what changed. A part on it opens the Project view there,
// with the same change laid over it.
import { count, esc, list, short } from '../views/format.js'
import { partClass } from './part-colours.js'
import { pictureHtml } from './parts-picture.js'

// Commits the card lists before it says how many more there are.
const SHOWN_COMMITS = 6

// The key the page keeps a change's look under, and the change as the Project view asks for it.
export function changeKey(change) {
	return `${change.base}..${change.head}`
}

// look is the top level with the change laid over it, null while ken reads it, or { problem } when it could not.
export function changeCardHtml(change, look, t) {
	return `<section class="change-card" aria-labelledby="cc-${t}">
		<h3 class="cc-title" id="cc-${t}">What this change touched</h3>
		${partsHtml(look, t)}
		${commitsHtml(change.commits)}
	</section>`
}

function partsHtml(look, t) {
	if (look === null) return '<p class="cc-line">Reading which parts of the project this change touched.</p>'
	if (look.problem) return `<p class="cc-line">ken could not lay this change over the parts: ${esc(look.problem)}</p>`
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => ({ from: at(arrow.from), to: at(arrow.to) }))
	const cells = look.boxes.map((box, i) => {
		const said = box.touched
			? `<span class="cc-touched">${count(box.touched.files, 'file', 'files')}: ${count(box.touched.added, 'line', 'lines')} added, ${box.touched.removed} removed</span>`
			: '<span class="cc-quiet">Not touched</span>'
		const body = `<span class="pv-name">${esc(box.name)}</span>${said}`
		const classes = `pv-box cc-box${box.touched ? ' is-touched' : ''} ${partClass(box.name)}`
		const html = box.opens
			? `<button class="${classes}" data-act="cc-open" data-turn="${t}" data-index="${i}" data-key="cc-${t}-${i}">${body}</button>`
			: `<div class="${classes}">${body}</div>`
		return { html, classes: `pv-cell${box.touched ? '' : ' cc-untouched is-faded'}` }
	})
	const untouched = look.boxes.filter((box) => !box.touched).map((box) => box.name)
	const outside = look.change?.outside ?? []
	const named = look.named ? '' : ' The parts are the top folders: nobody has named the parts of this project yet.'
	const touched = look.boxes.length - untouched.length
	return `<p class="cc-line">The change touched ${touched === 0 ? 'none' : touched} of the project's ${look.boxes.length} parts.${named} Open a part to see the change inside it.</p>
		${pictureHtml(cells, links, { numbered: false, open: new Set() })}
		${untouched.length > 0 ? `<p class="cc-line cc-narrow">Not touched: ${esc(list(untouched))}.</p>` : ''}
		${outside.length > 0 ? `<p class="cc-line">Also changed, in no part: ${outside.map((p) => `<code class="pv-path">${esc(p)}</code>`).join(', ')}.</p>` : ''}`
}

function commitsHtml(commits) {
	if (commits.length === 0) return ''
	const shown = commits
		.slice(0, SHOWN_COMMITS)
		.map(
			(commit) =>
				`<li class="cc-commit"><code>${esc(short(commit.hash))}</code> ${esc(commit.subject)} <span class="cc-quiet">${esc(commit.author)}</span></li>`,
		)
	const more = commits.length - shown.length
	return `<h4 class="cc-sub">${count(commits.length, 'commit', 'commits')}</h4>
		<ol class="cc-commits">${shown.join('')}</ol>
		${more > 0 ? `<p class="cc-line">And ${count(more, 'older commit', 'older commits')}.</p>` : ''}`
}
