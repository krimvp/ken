// The "Project" view: one level of the project's layout as boxes over its folders, at a commit the reader picks, with
// a change laid over it and the reader's map on each box. Plain HTML boxes, not a Mermaid drawing: there are no arrows
// yet, each box must be a button, and boxes in a grid stay readable at 390 pixels, where a drawing would shrink its
// text. Every mark is a word on the box; colour and border only repeat it.
import { count, esc, list, short } from '../views/format.js'

const STATES = {
	changed: 'Different at this commit',
	gone: 'Not there at this commit',
}

const MARKS = [
	['changed', 'changed since you understood it', 'changed since you understood them'],
	['new', 'never met', 'never met'],
	['met', 'met, not understood yet', 'met, not understood yet'],
	['understood', 'understood', 'understood'],
]

const GROUPS = [
	['uncommitted', 'Your work'],
	['merge', 'Recent merges'],
	['commit', 'Recent commits'],
	['branch', 'Branches'],
]

function mapLine(topics) {
	if (topics.length === 0) return '<span class="pv-map">Your map: no topic here yet.</span>'
	const parts = MARKS.flatMap(([mark, one, many]) => {
		const n = topics.filter((t) => t.mark === mark).length
		if (n === 0) return []
		const text = `${count(n, 'topic', 'topics')} ${n === 1 ? one : many}`
		return [mark === 'changed' ? `<strong class="pv-strong">${text}</strong>` : text]
	})
	return `<span class="pv-map">Your map: ${parts.join(', ')}.</span>`
}

function pathsLine(box) {
	const [only] = box.paths
	const named = box.paths.length === 1 && only.split('/').at(-1) === box.name
	const paths = named ? `<code>${esc(only)}</code>` : list(box.paths.map((p) => `<code>${esc(p)}</code>`))
	const files = box.opens ? `, ${count(box.files, 'file', 'files')}` : ''
	return `<span class="pv-paths">${paths}${files}</span>`
}

function boxHtml(box, i) {
	const state = STATES[box.state]
	const touched = box.touched
		? `<span class="pv-touched">Touched by the change: ${count(box.touched.files, 'file', 'files')}, ${count(box.touched.added, 'line', 'lines')} added, ${box.touched.removed} removed</span>`
		: ''
	const body = `<span class="pv-name">${esc(box.name)}</span>
		${pathsLine(box)}
		${state ? `<span class="pv-state">${state}</span>` : ''}
		${touched}
		${mapLine(box.topics)}`
	const classes = `pv-box is-${box.state}${box.touched ? ' is-touched' : ''}`
	if (!box.opens) return `<li class="pv-cell"><div class="${classes}">${body}</div></li>`
	return `<li class="pv-cell"><button class="${classes}" data-act="pv-open" data-index="${i}" data-key="pv-box-${i}">${body}<span class="pv-go">Open ${esc(box.name)}</span></button></li>`
}

function trailHtml(trail) {
	const crumbs = trail.map((step, i) =>
		i === trail.length - 1
			? `<li aria-current="location">${esc(step.name)}</li>`
			: `<li><button class="link" data-act="pv-crumb" data-index="${i}" data-key="pv-crumb-${i}">${esc(step.name)}</button></li>`,
	)
	return `<nav class="pv-trail" aria-label="Where you are in the project"><ol>${crumbs.join('')}</ol></nav>`
}

function formHtml(view) {
	const option = (value, text) =>
		`<option value="${esc(value)}"${value === view.change ? ' selected' : ''}>${esc(text)}</option>`
	const groups = GROUPS.flatMap(([kind, title]) => {
		const choices = view.changes.filter((c) => c.kind === kind)
		if (choices.length === 0) return []
		return [`<optgroup label="${title}">${choices.map((c) => option(c.change, c.name)).join('')}</optgroup>`]
	})
	return `<form class="pv-form" autocomplete="off">
		<span class="pv-field"><label for="pv-at">Commit</label><input id="pv-at" name="at" value="${esc(view.at)}" placeholder="HEAD" spellcheck="false" /></span>
		<span class="pv-field pv-change"><label for="pv-change">Change to lay over it</label><select id="pv-change" name="change">${option('', 'None')}${groups.join('')}</select></span>
		<button class="quiet-button" type="submit" data-key="pv-show">Show</button>
	</form>`
}

// A change the reader picked is named as the picker names it, not by the range ken was sent.
function atLine(look, changes) {
	const at =
		look.at === look.head
			? `Showing <code>${short(look.at)}</code>, the commit checked out now.`
			: `Showing <code>${short(look.at)}</code>. The boxes are the folders of <code>${short(look.head)}</code>, the commit checked out now.`
	if (!look.change) return `<p class="pv-at small">${at}</p>`
	const { files } = look.change
	const name = changes.find((c) => c.change === look.change.name)?.name ?? look.change.name
	const said =
		files === 0 ? `${esc(name)}: nothing changed.` : `${esc(name)}: ${count(files, 'file', 'files')} changed.`
	return `<p class="pv-at small">${at} ${said}</p>`
}

function moreHtml(look) {
	const paths = (items) => list(items.map((p) => `<code>${esc(p)}</code>`))
	const loose =
		look.loose.length === 0 ? '' : `<p class="pv-more small">Also at this commit, in no box: ${paths(look.loose)}.</p>`
	const outside = look.change?.outside ?? []
	const changed =
		outside.length === 0 ? '' : `<p class="pv-more small">Changed outside these boxes: ${paths(outside)}.</p>`
	return loose + changed
}

// view holds the level on screen (look), the change choices, the reader's trail of opened boxes, the commit and the
// change they typed or picked, and a problem the server sent back.
export function projectViewHtml(view) {
	const head = '<h1>Project</h1>'
	if (!view.look && !view.problem) {
		return `<section class="project-view">${head}<p class="muted">Reading the project from git.</p></section>`
	}
	const problem = view.problem ? `<div class="notice" role="alert"><p>${esc(view.problem)}</p></div>` : ''
	if (!view.look) return `<section class="project-view">${head}${formHtml(view)}${problem}</section>`
	const { look } = view
	const level = view.trail.length === 1 ? 'The whole project' : `Inside ${view.trail.at(-1).name}`
	const boxes =
		look.boxes.length === 0
			? '<p class="t-empty">Nothing is here at the commit checked out now.</p>'
			: `<ul class="pv-boxes">${look.boxes.map(boxHtml).join('')}</ul>`
	return `<section class="project-view">
		${head}
		<p class="lead pv-next">${esc(look.next.line)}</p>
		${formHtml(view)}
		${problem}
		${view.trail.length > 1 ? trailHtml(view.trail) : ''}
		<h2 class="pv-level" id="pv-level" tabindex="-1">${esc(level)}</h2>
		${atLine(look, view.changes)}
		${boxes}
		${moreHtml(look)}
	</section>`
}
