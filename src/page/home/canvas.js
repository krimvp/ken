// The home's canvas: where the reader is, why ken opened this way in, the change laid over the parts, and the picture
// of one level. A level is the parts ken's model named, with their jobs and the arrows between them, or the folders
// when nobody named them. The chosen detail decides what each box says: its job, its stop on the reading path, its
// paths. A change marks the parts it touched and fades the rest. A box is a button that selects its part.
import { partClass } from '../project/part-colours.js'
import { pictureHtml } from '../project/parts-picture.js'
import { stepParts } from '../project/walk.js'
import { count, esc, list, prose } from '../views/format.js'
import { pathOf, placeOf, shownDetail } from './content.js'

// The changes "Review a change" offers, by kind, in the order of the picker.
const REVIEW_GROUPS = [
	['uncommitted', 'Your work'],
	['branch', 'Branches'],
	['merge', 'Recent merges'],
	['commit', 'Recent commits'],
]

// Paths a box lists before it says how many more it holds, and changes ken explained that the picker offers.
const SHOWN_PATHS = 3
const SHOWN_EXPLAINED = 8

export function levelName(home) {
	return home.trail.length === 1 ? 'The whole project' : home.trail.at(-1).name
}

// Inside a part, every box takes the colour of the top-level part it sits in.
export function colourOf(home) {
	return home.trail.length === 1 ? partClass : () => partClass(home.trail[1].name)
}

// A merge or a commit is named by its subject alone. The hash says nothing to the reader the subject does not.
function plainName(choice) {
	return choice.name.replace(/^[0-9a-f]{7} /, '')
}

// What the change laid over the parts is, to the reader.
export function changeName(look, changes) {
	const picked = changes.find((choice) => choice.change === look.change.asked)
	if (look.change.asked === 'uncommitted') return 'Your uncommitted work'
	if (picked?.kind === 'branch') return `The branch ${look.change.name}`
	return picked ? plainName(picked) : look.change.name
}

// The arrows as box indexes, for the picture.
export function linksOf(look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	return look.arrows.map((arrow) => ({ from: at(arrow.from), to: at(arrow.to), text: arrow.text }))
}

// The map's word on a box. Only a box whose code changed since the reader understood it, or one they understand, says
// so: the inspector says the rest.
function mapLine(map) {
	if (map.line === '' || map.standing === 'unmet' || map.standing === 'open') return ''
	const strong = map.standing === 'changed' ? ' pv-strong' : ''
	return `<span class="pv-map${strong}">${esc(map.line)}</span>`
}

// The paths when they say more than the name does, and the file count.
export function pathsLine(box) {
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
export function stateLine(box, look) {
	if (box.state === 'gone') return '<span class="pv-state">Not there at this commit</span>'
	if (box.state !== 'changed') return ''
	const said = look.at === look.head ? 'Changed since ken named the parts' : 'Different then from now'
	return `<span class="pv-state">${said}</span>`
}

// What a change did to a part, as the box and the inspector say it.
export function touchedHtml(touched) {
	return `${count(touched.files, 'file', 'files')} <span class="home-plus"><span class="visually-hidden">, lines added: </span>+${touched.added}</span> <span class="home-minus"><span class="visually-hidden">, removed: </span>-${touched.removed}</span>`
}

// The mark on a box at "How it works" and "In the code": its stop on the tour, or the steps of the walkthrough that
// quote its files.
function badgeOf(i, box, look, content, path) {
	if (content.kind === 'level') {
		const k = path.findIndex((step) => step.part === box.name)
		return k < 0 ? '' : `Stop ${k + 1}`
	}
	const steps = path.flatMap((step, k) => (stepParts(step, look.boxes).has(i) ? [k + 1] : []))
	return steps.length === 0 ? '' : `${steps.length === 1 ? 'Step' : 'Steps'} ${list(steps.map(String))}`
}

function boxHtml(box, i, { look, detail, colour, badge, chosen }) {
	const touched = box.touched
		? `<span class="home-touched">${touchedHtml(box.touched)}</span>`
		: look.change
			? '<span class="cc-quiet">Not touched</span>'
			: ''
	const paths = !look.named || detail === 'code' ? pathsLine(box) : ''
	const body = `${badge ? `<span class="home-badge">${badge}</span>` : ''}
		<span class="pv-name">${esc(box.name)}</span>
		${box.job ? `<span class="pv-job">${prose(box.job)}</span>` : ''}
		${paths}
		${stateLine(box, look)}
		${touched}
		${mapLine(box.map)}`
	const classes = `pv-box is-${box.state}${box.touched ? ' is-touched' : ''} ${colour}`
	const html = `<button class="${classes}" data-act="home-box" data-index="${i}" data-key="home-box-${i}" aria-pressed="${chosen}">${body}</button>`
	const faded = look.change && !box.touched ? ' is-faded' : ''
	return { html, classes: `pv-cell${faded}${chosen ? ' is-chosen' : ''}` }
}

// The boxes the selection is about: the part picked, or the parts the picked step quotes.
function chosenBoxes(look, path, selected) {
	if (!selected) return new Set()
	if (selected.kind === 'part') {
		const i = look.boxes.findIndex((box) => box.name === selected.name)
		return new Set(i < 0 ? [] : [i])
	}
	const step = path[placeOf(path, selected)]
	return step ? stepParts(step, look.boxes) : new Set()
}

function pictureOf(home) {
	const { look, content } = home
	if (look.boxes.length === 0) return '<p class="t-empty">Nothing is here at this commit.</p>'
	const detail = shownDetail(home)
	const colour = colourOf(home)
	const path = pathOf(look, content)
	const links = linksOf(look)
	const chosen = chosenBoxes(look, path, home.selected)
	// A picked part lights the arrows that touch it and the parts at their other ends, as pointing at it does.
	const hot = new Set(links.flatMap((link, i) => (chosen.has(link.from) || chosen.has(link.to) ? [i] : [])))
	const lit = new Set([...chosen, ...[...hot].flatMap((i) => [links[i].from, links[i].to])])
	const cells = look.boxes.map((box, i) =>
		boxHtml(box, i, {
			look,
			detail,
			colour: colour(box.name),
			badge: detail === 'big' ? '' : badgeOf(i, box, look, content, path),
			chosen: chosen.has(i),
		}),
	)
	return pictureHtml(cells, links, { numbered: true, open: home.openArrows, lit, hot: chosen.size > 0 ? hot : null })
}

function trailHtml(trail) {
	if (trail.length === 1) return ''
	const crumbs = trail.map((step, i) =>
		i === trail.length - 1
			? `<li aria-current="location">${esc(step.name)}</li>`
			: `<li><button class="link" data-act="home-crumb" data-index="${i}" data-key="home-crumb-${i}">${esc(i === 0 ? 'The whole project' : step.name)}</button></li>`,
	)
	return `<nav class="home-trail" aria-label="Where you are in the project"><ol>${crumbs.join('')}</ol></nav>`
}

// The changes ken explained before, newest first, each once: the reader can open one again with no model.
function explainedChoices(rows) {
	const seen = new Set()
	return [...rows]
		.reverse()
		.flatMap((row) => {
			if (row.outcome !== 'answered' || !row.change) return []
			const change = `${row.change.base}..${row.change.head}`
			if (seen.has(change)) return []
			seen.add(change)
			return [{ change, name: row.question.split('\n')[0] }]
		})
		.slice(0, SHOWN_EXPLAINED)
}

// The change picker of "Catch up" and "Review a change". Catching up offers what landed since a point in time.
// Reviewing offers the reader's own work, branches, merges and commits, and behind one line another commit to look
// at. A commit or a change the server refused shows its reason under its own field.
function pickerHtml(home, rows) {
	const { look, changes, wayIn, problem } = home
	if (wayIn === 'learn') return ''
	const review = wayIn === 'review'
	const since = changes.filter((choice) => choice.kind === 'since')
	if (!review && since.length === 0) {
		return '<p class="home-line">No commit landed in the last 90 days, so there is nothing to catch up on. This is the project as it is now.</p>'
	}
	const option = (value, text) =>
		`<option value="${esc(value)}"${value === home.change ? ' selected' : ''}>${esc(text)}</option>`
	const group = (title, choices) =>
		choices.length === 0
			? ''
			: `<optgroup label="${title}">${choices.map((c) => option(c.change, plainName(c))).join('')}</optgroup>`
	const explained = review ? explainedChoices(rows) : []
	const groups = review
		? `${REVIEW_GROUPS.map(([kind, title]) =>
				group(
					title,
					changes.filter((choice) => choice.kind === kind),
				),
			).join('')}${group('Changes ken explained', explained)}`
		: since.map((choice) => option(choice.change, choice.name)).join('')
	const listed =
		home.change === 'none' || [...(review ? changes : since), ...explained].some((c) => c.change === home.change)
	const current = !listed && look?.change ? option(home.change, look.change.name) : ''
	const none = home.change === 'none' ? option('none', 'No change picked') : ''
	const error = (field) =>
		problem?.field === field ? `<span class="home-error" id="home-${field}-error">${esc(problem.message)}</span>` : ''
	const invalid = (field) =>
		problem?.field === field ? ` aria-invalid="true" aria-describedby="home-${field}-error"` : ''
	const other = review
		? `<details class="home-other"${home.formOpen || problem?.field === 'at' ? ' open' : ''}>
				<summary data-key="home-other">Another commit</summary>
				<span class="home-field"><label for="home-at">At commit</label><input id="home-at" name="at" data-key="home-at" value="${esc(home.at)}" placeholder="HEAD" spellcheck="false"${invalid('at')} /><button class="quiet-button" type="submit" data-key="home-show">Show</button></span>${error('at')}
			</details>`
		: ''
	return `<form class="home-picker" id="home-picker" autocomplete="off">
		<span class="home-field"><label for="home-change">${review ? 'Change laid over the parts' : 'Show what landed'}</label><select id="home-change" name="change" data-key="home-change"${invalid('change')}>${none}${current}${groups}</select></span>${error('change')}
		${other}
	</form>`
}

// What the canvas shows beyond the level itself: an older commit, what the change's marks mean, and the reader's own
// words when ken drew the picture the way they asked.
function notesHtml(home) {
	const { look } = home
	const said = []
	if (look.at !== look.head) {
		const boxes = look.named ? 'the parts as they were named then' : "today's folders"
		said.push(
			`<p class="home-line">You are looking at commit <code>${esc(look.at.slice(0, 7))}</code>, not the one checked out now. The boxes are ${boxes}.</p>`,
		)
	}
	if (!look.named) {
		said.push(
			`<p class="home-line">These boxes are folders. ken's model has not named the parts ${home.trail.length === 1 ? 'of this project' : 'in here'} yet.</p>`,
		)
	}
	if (look.change) {
		said.push(
			look.change.files === 0
				? '<p class="home-line">This change touched no file.</p>'
				: '<p class="home-key"><span class="home-key-touched">Touched, with its files and lines added and removed</span><span class="home-key-faded">Not touched</span></p>',
		)
	}
	if (look.named?.asked) {
		said.push(`<div class="home-banner" role="status">
			<p><strong>Drawn the way you asked: ${esc(look.named.asked)}.</strong> ken's model drew it, and ken checked each path and arrow against the code.</p>
			<button class="link" data-act="home-back" data-key="home-back">Go back to the picture before</button>
			${home.backProblem ? `<p class="home-error">${esc(home.backProblem)}</p>` : ''}
		</div>`)
	}
	return said.join('')
}

// What sits in no box folds behind one line: the reader rarely needs the list.
function looseHtml(look) {
	const paths = (items) => items.map((p) => `<code class="pv-path">${esc(p)}</code>`).join(', ')
	const noun = look.named ? 'part' : 'box'
	const loose =
		look.loose.length === 0
			? ''
			: `<details class="home-loose"><summary>${count(look.loose.length, 'file or folder', 'files and folders')} at this level ${look.loose.length === 1 ? 'is' : 'are'} in no ${noun}.</summary><p>${paths(look.loose)}.</p></details>`
	const outside = look.change?.outside ?? []
	const changed =
		outside.length === 0
			? ''
			: `<p class="home-loose">The change also touched ${count(outside.length, 'file', 'files')} in no ${noun}: ${paths(outside)}.</p>`
	return changed + loose
}

// home is the home's state, and rows the reader's saved questions, which name the changes ken explained before.
export function canvasHtml(home, rows) {
	const { look, suggestion } = home
	const inside = home.trail.length > 1
	const heading = `${trailHtml(home.trail)}<h1 class="home-level ${inside ? colourOf(home)('') : ''}" id="home-level" tabindex="-1">${esc(levelName(home))}</h1>`
	if (!look && !home.problem) return `${heading}<p class="home-line">Reading the project from git.</p>`
	// A level the server refused takes the old one off the screen, so nothing under the problem is out of date.
	if (home.problem) {
		return `${heading}
			<p class="home-line" role="alert">ken could not show this. ${home.problem.field ? 'The reason is under the field below.' : esc(home.problem.message)} <button class="link" data-act="home-reset" data-key="home-reset">Show where you are now</button></p>
			${pickerHtml(home, rows)}`
	}
	const why =
		suggestion && home.wayIn === suggestion.suggested
			? `<p class="home-why">ken opened this way in for you. ${esc(suggestion.why)}</p>`
			: ''
	return `${heading}
		${why}
		${pickerHtml(home, rows)}
		${notesHtml(home)}
		<div class="home-picture${look.arrows.length > 0 ? ' has-arrows' : ''}">${pictureOf(home)}</div>
		${looseHtml(look)}`
}
