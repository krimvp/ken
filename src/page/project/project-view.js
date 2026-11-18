// The "Project" view: one level of the project's layout, at a commit the reader picks, with a change laid over it and
// the reader's map on each box. A level is the parts ken's model named, with their jobs and the arrows between them, or
// the folders when nobody named them. On a wide screen the boxes are a picture with the arrows drawn between them, and
// the numbered list of arrows sits under it. Plain HTML with SVG lines, not a Mermaid drawing: at 390 pixels Mermaid
// shrinks a level of six parts to about 62 percent, so its labels fall near 10 pixels. On a narrow screen the boxes
// and the arrows are two lists at the page's own text size. Each box is one button, and each state on it is one line.
import { count, esc, prose, quoteBody } from '../views/format.js'
import { partClass } from './part-colours.js'
import { pictureHtml } from './parts-picture.js'

const GROUPS = [
	['uncommitted', 'Your work'],
	['merge', 'Recent merges'],
	['commit', 'Recent commits'],
	['branch', 'Branches'],
]

// Paths a box lists before it says how many more it holds.
const SHOWN_PATHS = 3

// The map's word on the box, written by the server from the same standing as the line over the level. That line
// already names every box the reader has not asked about or not finished, so only a box whose code changed since the
// reader understood it, or one they understand, says so on the box.
function mapLine(map) {
	if (map.line === '' || map.standing === 'unmet' || map.standing === 'open') return ''
	const strong = map.standing === 'changed' ? ' pv-strong' : ''
	return `<span class="pv-map${strong}">${esc(map.line)}</span>`
}

// The paths when they say more than the name does, and the file count.
function pathsLine(box) {
	const [only] = box.paths
	const files = count(box.files, 'file', 'files')
	if (box.paths.length === 1 && only.split('/').at(-1) === box.name) return `<span class="pv-paths">${files}</span>`
	const shown = box.paths.slice(0, SHOWN_PATHS).map((p) => `<code class="pv-path">${esc(p)}</code>`)
	const more = box.paths.length - shown.length
	const paths = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
	return `<span class="pv-paths">${paths}. ${files}.</span>`
}

// At the commit checked out now, a named part says whether it changed since ken's model named it. At an older commit,
// every box says whether it was different then from now.
function stateLine(box, look) {
	if (box.state === 'gone') return '<span class="pv-state">Not there at this commit</span>'
	if (box.state !== 'changed') return ''
	const said = look.at === look.head ? 'Changed since ken named the parts' : 'Different then from now'
	return `<span class="pv-state">${said}</span>`
}

function boxHtml(box, i, look, colour) {
	const touched = box.touched
		? `<span class="pv-touched">The change touched ${count(box.touched.files, 'file', 'files')} here: ${count(box.touched.added, 'line', 'lines')} added, ${box.touched.removed} removed</span>`
		: ''
	const body = `<span class="pv-name">${esc(box.name)}</span>
		${box.job ? `<span class="pv-job">${prose(box.job)}</span>` : ''}
		${pathsLine(box)}
		${stateLine(box, look)}
		${touched}
		${mapLine(box.map)}
		${box.opens ? '<span class="pv-inside" aria-hidden="true">Look inside</span>' : ''}`
	const classes = `pv-box is-${box.state}${box.touched ? ' is-touched' : ''} ${colour}`
	const html = box.opens
		? `<button class="${classes}" data-act="pv-open" data-index="${i}" data-key="pv-box-${i}">${body}</button>`
		: `<div class="${classes}">${body}</div>`
	return { html, classes: 'pv-cell' }
}

// The arrows as box indexes, for the picture.
function linksOf(look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	return look.arrows.map((arrow) => ({ from: at(arrow.from), to: at(arrow.to), text: arrow.text }))
}

// Each arrow names the part that uses the other, a verb, and the part it uses, under the number the picture shows on
// it. A row opens the line the arrow rests on.
function arrowsHtml(look, open, colourOf) {
	if (look.arrows.length === 0) return ''
	const items = look.arrows.map((arrow, i) => {
		const shown = open.has(i)
		const quotes = shown
			? arrow.quotes
					.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, line ${quote.startLine}. `))
					.join('')
			: ''
		return `<li class="pv-arrow-item">
			<button class="pv-arrow" data-act="pv-arrow" data-index="${i}" data-key="pv-arrow-${i}" aria-expanded="${shown}">
				<span class="pv-num" aria-hidden="true">${i + 1}</span>
				<span class="pv-arrow-text"><strong class="part-name ${colourOf(arrow.from)}">${esc(arrow.from)}</strong> ${esc(arrow.text)} <strong class="part-name ${colourOf(arrow.to)}">${esc(arrow.to)}</strong></span>
			</button>
			${quotes}
		</li>`
	})
	return `<section class="pv-side" aria-labelledby="pv-uses">
		<h2 class="pv-sub" id="pv-uses">How the parts use each other</h2>
		<p class="pv-note">Each arrow rests on a line of code, such as an import, in the part it starts from. Pick an arrow to see its line.</p>
		<button class="link pv-all" data-act="pv-all" data-key="pv-all">${open.size === look.arrows.length ? 'Hide the lines' : 'Show every line'}</button>
		<ol class="pv-arrows">${items.join('')}</ol>
	</section>`
}

function trailHtml(trail) {
	const crumbs = trail.map((step, i) =>
		i === trail.length - 1
			? `<li aria-current="location">${esc(step.name)}</li>`
			: `<li><button class="link" data-act="pv-crumb" data-index="${i}" data-key="pv-crumb-${i}">${esc(step.name)}</button></li>`,
	)
	return `<nav class="pv-trail" aria-label="Where you are in the project"><ol>${crumbs.join('')}</ol></nav>`
}

// Another commit or another change, folded away: the view opens on where the reader is, and this is rarely needed. A
// commit or a change the server refused shows its reason under its own field.
function formHtml(view) {
	const option = (value, text) =>
		`<option value="${esc(value)}"${value === view.change ? ' selected' : ''}>${esc(text)}</option>`
	const groups = GROUPS.flatMap(([kind, title]) => {
		const choices = view.changes.filter((c) => c.kind === kind)
		if (choices.length === 0) return []
		return [`<optgroup label="${title}">${choices.map((c) => option(c.change, plainName(c))).join('')}</optgroup>`]
	})
	const listed = view.change === 'none' || view.changes.some((c) => c.change === view.change)
	const current = !listed && view.look?.change ? option(view.change, view.look.change.name) : ''
	const error = (field) =>
		view.problem?.field === field
			? `<span class="pv-error" id="pv-${field}-error">${esc(view.problem.message)}</span>`
			: ''
	const invalid = (field) =>
		view.problem?.field === field ? ` aria-invalid="true" aria-describedby="pv-${field}-error"` : ''
	const open = view.formOpen || view.problem ? ' open' : ''
	return `<details class="pv-other"${open}>
		<summary class="pv-other-toggle" data-key="pv-other">Look at another commit or change</summary>
		<form class="pv-form" autocomplete="off">
			<span class="pv-field"><label for="pv-at">At commit</label><input id="pv-at" name="at" value="${esc(view.at)}" placeholder="HEAD" spellcheck="false"${invalid('at')} />${error('at')}</span>
			<span class="pv-field pv-change"><label for="pv-change">Lay a change over the parts</label><select id="pv-change" name="change"${invalid('change')}>${option('none', 'None')}${current}${groups.join('')}</select>${error('change')}</span>
			<button class="quiet-button" type="submit" data-key="pv-show">Show</button>
		</form>
	</details>`
}

// A merge or a commit is named by its subject alone. The hash says nothing to the reader the subject does not.
function plainName(choice) {
	return choice.name.replace(/^[0-9a-f]{7} /, '')
}

// Who named the parts, and the one button that asks ken's model to name them: on a folder level, or on a named one
// that no longer fits. Both name the parts at the commit checked out, so they show only there. What no longer fits is
// said here once, not on each arrow.
function byHtml(look, canAsk) {
	const here = look.at === look.head
	const ask = (text) =>
		canAsk && here ? `<button class="quiet-button pv-ask" data-act="pv-name" data-key="pv-name">${text}</button>` : ''
	if (!look.named) {
		return `<div class="pv-by"><p class="pv-by-line">These boxes are the folders. ken's model has not named the parts here yet.</p>${ask('Ask ken to name these parts')}</div>`
	}
	const { drawnAt, added, stale } = look.named
	const by = `<p class="pv-by-line">ken's model named these parts at commit <code>${esc(drawnAt.slice(0, 7))}</code>, and ken checked each path and arrow against the code.</p>`
	if (!stale || !here) return `<div class="pv-by">${by}</div>`
	const changed = look.boxes.filter((box) => box.state !== 'same').map((box) => box.name)
	const why = [
		...(changed.length > 0
			? [
					`Since then ${names(changed)} changed, so the arrows from ${changed.length === 1 ? 'it' : 'them'} may be out of date.`,
				]
			: []),
		...(added.length > 0 ? [`${names(added)} ${added.length === 1 ? 'is' : 'are'} new and in no part.`] : []),
	]
	return `<div class="pv-by">${by}<p class="pv-by-line pv-stale-line">${esc(why.join(' '))}</p>${ask('Name them again')}</div>`
}

// The way in for someone new: a tour of this level, part by part, in the order its arrows give. Only a level ken's
// model named has a tour, and only at the commit checked out, since the model reads the code there.
function tourHtml(look, trail, canAsk) {
	if (!look.tour || look.at !== look.head || !canAsk) return ''
	const first = look.tour[0]?.name
	const where = trail.length === 1 ? 'the project' : esc(trail.at(-1).name)
	return `<div class="pv-tour">
		<button class="primary" data-act="tour" data-key="pv-tour">Show me around</button>
		<p class="pv-tour-line">ken's model shows you the ${look.tour.length} parts of ${where} in turn, with their code, starting at ${esc(first)}.</p>
	</div>`
}

function names(list) {
	return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

// What the view shows beyond the default: an older commit, a change laid over it. Nothing on the default view.
function atLine(look, changes) {
	const said = []
	if (look.at !== look.head) {
		const boxes = look.named ? 'the parts as they were named then' : "today's folders"
		said.push(
			`You are looking at commit <code>${esc(look.at.slice(0, 7))}</code>, not the one checked out now. The boxes are ${boxes}.`,
		)
	}
	if (look.change) {
		const picked = changes.find((c) => c.change === look.change.asked)
		const what =
			look.change.asked === 'uncommitted'
				? 'your uncommitted work'
				: picked?.kind === 'branch'
					? `the branch ${esc(look.change.name)}`
					: esc(picked ? plainName(picked) : look.change.name)
		const { files } = look.change
		said.push(
			files === 0
				? `Laid over the parts: ${what}, which changed no file.`
				: `Laid over the parts: ${what}, ${count(files, 'file', 'files')} changed.`,
		)
	}
	return said.length === 0 ? '' : `<p class="pv-at">${said.join(' ')}</p>`
}

// What sits in no box folds behind one line: the reader rarely needs the list.
function moreHtml(look) {
	const paths = (items) => items.map((p) => `<code class="pv-path">${esc(p)}</code>`).join(', ')
	const added = look.named?.added ?? []
	const left = look.loose.filter((p) => !added.includes(p))
	const noun = look.named ? 'part' : 'box'
	const loose =
		left.length === 0
			? ''
			: `<details class="pv-more"><summary class="pv-more-toggle">${count(left.length, 'file or folder', 'files and folders')} at this commit ${left.length === 1 ? 'is' : 'are'} in no ${noun}</summary><p>${paths(left)}.</p></details>`
	const outside = look.change?.outside ?? []
	const changed =
		outside.length === 0 ? '' : `<p class="pv-more">The change also touched files in no ${noun}: ${paths(outside)}.</p>`
	return changed + loose
}

// view holds the level on screen (look), the change choices, the reader's trail of opened boxes, the commit and the
// change they typed or picked, a problem the server sent back, and the arrows the reader opened. canAsk says a model
// is set, so the page can ask it to name parts.
export function projectViewHtml(view, canAsk) {
	if (!view.look && !view.problem) {
		return '<section class="project-view"><h1>Project</h1><p class="muted">Reading the project from git.</p></section>'
	}
	const level = view.trail.length === 1 ? 'The whole project' : view.trail.at(-1).name
	// Inside a part, every box takes the colour of the top-level part it sits in.
	const colourOf = view.trail.length === 1 ? partClass : () => partClass(view.trail[1].name)
	const heading = `<h1 class="pv-level ${view.trail.length === 1 ? '' : colourOf('')}" id="pv-level" tabindex="-1">${esc(level)}</h1>`
	const trail = view.trail.length > 1 ? trailHtml(view.trail) : ''
	// A level the server refused takes the old one off the screen, so nothing below the problem is out of date.
	if (view.problem || !view.look) {
		return `<section class="project-view">
			${trail}${heading}
			<p class="pv-at" role="alert">ken could not show this level. ${view.problem?.field ? 'The reason is under the field below.' : esc(view.problem?.message ?? '')} <button class="link" data-act="pv-reset" data-key="pv-reset">Show where you are now</button></p>
			${formHtml(view)}
		</section>`
	}
	const { look } = view
	const open = view.openArrows ?? new Set()
	const boxes =
		look.boxes.length === 0
			? '<p class="t-empty">Nothing is here at the commit checked out now.</p>'
			: pictureHtml(
					look.boxes.map((box, i) => boxHtml(box, i, look, colourOf(box.name))),
					linksOf(look),
					{ numbered: true, open },
				)
	return `<section class="project-view">
		${trail}${heading}
		${tourHtml(look, view.trail, canAsk)}
		${atLine(look, view.changes)}
		${byHtml(look, canAsk)}
		${look.next.line === '' ? '' : `<p class="lead pv-next">${esc(look.next.line)}</p>`}
		${formHtml(view)}
		<div class="pv-level-body${look.arrows.length > 0 ? ' has-arrows' : ''}">${boxes}${arrowsHtml(look, open, colourOf)}</div>
		${moreHtml(look)}
	</section>`
}
