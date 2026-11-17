// The "Project" view: one level of the project's layout, at a commit the reader picks, with a change laid over it and
// the reader's map on each box. A level is the parts ken's model named, with their jobs and the arrows between them, or
// the folders when nobody named them. Plain HTML, not a Mermaid drawing: at 390 pixels Mermaid shrinks a level of six
// parts to about 62 percent, so its labels fall near 10 pixels, while a grid of cards and a list of arrows keep the
// page's own text size. Each box is one button, and each state on it is one line of words.
import { count, esc, prose, quoteBody } from '../views/format.js'

const GROUPS = [
	['uncommitted', 'Your work'],
	['merge', 'Recent merges'],
	['commit', 'Recent commits'],
	['branch', 'Branches'],
]

// What each mark of the reader's map means, said plainly, for one topic and for several.
const MARKS = [
	['changed', 'you understood, changed since', 'you understood, changed since'],
	['met', 'you asked about, not marked understood', 'you asked about, not marked understood'],
	['new', 'you have not asked about', 'you have not asked about'],
	['understood', 'you understand', 'you understand'],
]

// Paths a box lists before it says how many more it holds.
const SHOWN_PATHS = 3

function mapLine(topics) {
	if (topics.length === 0) return ''
	const parts = MARKS.flatMap(([mark, one, many]) => {
		const n = topics.filter((t) => t.mark === mark).length
		if (n === 0) return []
		const text = `${n} ${n === 1 ? one : many}`
		return [mark === 'changed' ? `<strong class="pv-strong">${text}</strong>` : text]
	})
	return `<span class="pv-map">${count(topics.length, 'Topic', 'Topics')} here: ${parts.join('; ')}.</span>`
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

// A folder is compared with the commit checked out now, a named part with the commit it was named at.
function stateLine(box, look) {
	if (box.state === 'gone') return '<span class="pv-state">Not there at this commit</span>'
	if (box.state !== 'changed') return ''
	if (!look.named) return '<span class="pv-state">Different at this commit</span>'
	const said = look.at === look.head ? 'Changed since the parts were named' : 'Different from when the parts were named'
	return `<span class="pv-state">${said}</span>`
}

function boxHtml(box, i, look) {
	const touched = box.touched
		? `<span class="pv-touched">The change touched ${count(box.touched.files, 'file', 'files')} here: ${count(box.touched.added, 'line', 'lines')} added, ${box.touched.removed} removed</span>`
		: ''
	const body = `<span class="pv-name">${esc(box.name)}</span>
		${box.job ? `<span class="pv-job">${prose(box.job)}</span>` : ''}
		${pathsLine(box)}
		${stateLine(box, look)}
		${touched}
		${mapLine(box.topics)}`
	const classes = `pv-box is-${box.state}${box.touched ? ' is-touched' : ''}`
	if (!box.opens) return `<li class="pv-cell"><div class="${classes}">${body}</div></li>`
	return `<li class="pv-cell"><button class="${classes}" data-act="pv-open" data-index="${i}" data-key="pv-box-${i}">${body}</button></li>`
}

// Each arrow names the part that uses the other, a verb, and the part it uses, and opens the line it rests on.
function arrowsHtml(look, open) {
	if (look.arrows.length === 0) return ''
	const items = look.arrows.map((arrow, i) => {
		const shown = open.has(i)
		const stale = arrow.stale
			? `<span class="pv-stale">${esc(arrow.from)} changed since, so this may be out of date</span>`
			: ''
		const quotes = shown
			? arrow.quotes
					.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, line ${quote.startLine}. `))
					.join('')
			: ''
		return `<li class="pv-arrow-item">
			<button class="pv-arrow" data-act="pv-arrow" data-index="${i}" data-key="pv-arrow-${i}" aria-expanded="${shown}">
				<span class="pv-arrow-text"><strong>${esc(arrow.from)}</strong> ${esc(arrow.text)} <strong>${esc(arrow.to)}</strong></span>
				<span class="pv-arrow-go">${shown ? 'Hide the line' : 'Show the line'}</span>
			</button>
			${stale}
			${quotes}
		</li>`
	})
	return `<h2 class="pv-sub">How the parts use each other</h2>
		<p class="pv-note">Each arrow rests on a line of code ken found in the part it starts at.</p>
		<ul class="pv-arrows">${items.join('')}</ul>`
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
		<span class="pv-field"><label for="pv-at">At commit</label><input id="pv-at" name="at" value="${esc(view.at)}" placeholder="HEAD" spellcheck="false" /></span>
		<span class="pv-field pv-change"><label for="pv-change">Mark what a change touched</label><select id="pv-change" name="change">${option('', 'No change')}${groups.join('')}</select></span>
		<button class="quiet-button" type="submit" data-key="pv-show">Show</button>
	</form>`
}

// Who drew the level, and the one button that asks ken's model to name it: on a folder level, or on a named one that
// no longer fits. Both name the parts at the commit checked out, so they show only there.
function byHtml(look, canAsk) {
	const here = look.at === look.head
	const ask = (text) =>
		canAsk && here ? `<button class="quiet-button pv-ask" data-act="pv-name" data-key="pv-name">${text}</button>` : ''
	if (!look.named) {
		return `<div class="pv-by"><p class="pv-by-line">These boxes are the folders. ken's model has not named the parts here yet.</p>${ask('Ask ken to name these parts')}</div>`
	}
	const { drawnAt, added, stale } = look.named
	const by = `<p class="pv-by-line">Named by ken's model at commit <code>${esc(drawnAt.slice(0, 7))}</code>. ken checked every path and arrow.</p>`
	if (!stale || !here) return `<div class="pv-by">${by}</div>`
	const changed = look.boxes.filter((box) => box.state !== 'same').map((box) => box.name)
	const why = [
		...(changed.length > 0 ? [`${names(changed)} changed since`] : []),
		...(added.length > 0 ? [`${names(added)} ${added.length === 1 ? 'is' : 'are'} new and in no part`] : []),
	]
	return `<div class="pv-by">${by}<p class="pv-by-line pv-stale-line">The drawing may no longer fit: ${esc(why.join('; '))}.</p>${ask('Name them again')}</div>`
}

function names(list) {
	return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

// What the view shows beyond the default: an older commit, a change laid over it. Nothing on the default view.
function atLine(look, changes) {
	const said = []
	if (look.at !== look.head) {
		said.push(
			look.named
				? `You are looking at an older commit, <code>${esc(look.at.slice(0, 7))}</code>.`
				: `You are looking at an older commit, <code>${esc(look.at.slice(0, 7))}</code>. The boxes are today's folders, each marked by how it differed then.`,
		)
	}
	if (look.change) {
		const picked = changes.find((c) => c.change === look.change.name)
		const name = picked ? picked.name.replace(/^[0-9a-f]{7} /, '') : look.change.name
		const { files } = look.change
		said.push(
			files === 0
				? `Marked: ${esc(name)}, which changed nothing here.`
				: `Marked: what ${esc(name)} touched, ${count(files, 'file', 'files')} in all.`,
		)
	}
	return said.length === 0 ? '' : `<p class="pv-at">${said.join(' ')}</p>`
}

function moreHtml(look) {
	const paths = (items) => items.map((p) => `<code class="pv-path">${esc(p)}</code>`).join(', ')
	const added = look.named?.added ?? []
	const left = look.loose.filter((p) => !added.includes(p))
	const noun = look.named ? 'part' : 'box'
	const loose = left.length === 0 ? '' : `<p class="pv-more">In no ${noun} at this commit: ${paths(left)}.</p>`
	const outside = look.change?.outside ?? []
	const changed =
		outside.length === 0 ? '' : `<p class="pv-more">The change also touched files in no ${noun}: ${paths(outside)}.</p>`
	return loose + changed
}

// view holds the level on screen (look), the change choices, the reader's trail of opened boxes, the commit and the
// change they typed or picked, a problem the server sent back, and the arrows the reader opened. canAsk says a model
// is set, so the page can ask it to name parts.
export function projectViewHtml(view, canAsk) {
	if (!view.look && !view.problem) {
		return '<section class="project-view"><h1>Project</h1><p class="muted">Reading the project from git.</p></section>'
	}
	const level = view.trail.length === 1 ? 'The whole project' : view.trail.at(-1).name
	const heading = `<h1 class="pv-level" id="pv-level" tabindex="-1">${esc(level)}</h1>`
	const trail = view.trail.length > 1 ? trailHtml(view.trail) : ''
	// A level the server refused takes the old one off the screen, so nothing below the problem is out of date.
	if (view.problem || !view.look) {
		return `<section class="project-view">
			${trail}${heading}
			${formHtml(view)}
			<div class="notice" role="alert"><p>${esc(view.problem)}</p><p><button class="link" data-act="pv-reset" data-key="pv-reset">Show the commit checked out now</button></p></div>
		</section>`
	}
	const { look } = view
	const boxes =
		look.boxes.length === 0
			? '<p class="t-empty">Nothing is here at the commit checked out now.</p>'
			: `<ul class="pv-boxes">${look.boxes.map((box, i) => boxHtml(box, i, look)).join('')}</ul>`
	return `<section class="project-view">
		${trail}${heading}
		${byHtml(look, canAsk)}
		<p class="lead pv-next">${esc(look.next.line)}</p>
		${formHtml(view)}
		${atLine(look, view.changes)}
		${boxes}
		${arrowsHtml(look, view.openArrows ?? new Set())}
		${moreHtml(look)}
	</section>`
}
