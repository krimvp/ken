// The home's canvas: where the reader is, what the level is, the change laid over the parts, and the picture of one
// level. A level is the parts ken's model named, with their jobs and the arrows between them, or the folders when
// nobody named them. The chosen detail decides what each box says under its name: its job, or its paths at "In the
// code". A change marks the parts it touched and fades the rest. A box is a button that selects its part. When ken
// drew the level another way because the reader asked, a row of tabs offers each drawn picture in place of the parts.
import { pictureHtml } from '../../project/parts-picture.js'
import { stepParts } from '../../project/walk.js'
import { count, esc, label, list, pathList, prose } from '../../views/format.js'
import { diagramOf, pathOf, placeOf, shownDetail, stepFiles } from '../state/content.js'
import { colourOf, projectName } from '../state/home-state.js'
import { arrowListHtml } from './arrow-list.js'
import { boxHtml, isFile } from './part-box.js'

// The changes "Review a change" offers, by kind, in the order of the picker.
const REVIEW_GROUPS = [
	['uncommitted', 'Your work'],
	['branch', 'Branches'],
	['merge', 'Recent merges'],
	['commit', 'Recent commits'],
]

// Changes ken explained that the picker offers, and drawn pictures that get a tab before the rest go behind "Older".
const SHOWN_EXPLAINED = 8
const SHOWN_DRAWN = 4

// A merge or a commit is named by its subject alone. The hash says nothing to the reader the subject does not.
function plainName(choice) {
	return choice.name.replace(/^[0-9a-f]{7} /, '')
}

// What the change laid over the parts is, to the reader. A change the picker does not list, such as one ken explained
// before, is named by its newest commit.
export function changeName(look, changes) {
	const picked = changes.find((choice) => choice.change === look.change.asked)
	if (look.change.asked === 'uncommitted') return 'Your uncommitted work'
	if (picked?.kind === 'branch') return `The branch ${look.change.name}`
	if (picked?.kind === 'since') return picked.name.slice(0, picked.name.lastIndexOf(': '))
	// GitHub's subject for a merge names the branch at length. ken's own questions call it by its pull request.
	const pull = picked?.kind === 'merge' && picked.name.match(/ Merge pull request #(\d+) /)
	if (pull) return `The merge of pull request #${pull[1]}`
	if (picked) return plainName(picked)
	return look.change.asked.startsWith('since:')
		? look.change.name
		: (look.change.commits[0]?.subject ?? look.change.name)
}

function linksOf(look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	return look.arrows.map((arrow) => ({ from: at(arrow.from), to: at(arrow.to), text: arrow.text }))
}

// The mark on a box at "How it works" and "In the code": its stop on the tour, or the steps of the walkthrough that
// quote its files.
function badgeOf(i, box, look, content, path) {
	if (content.kind === 'level') {
		const k = path.findIndex((step) => step.part === box.name)
		return k < 0 ? '' : `Stop ${k + 1}`
	}
	const steps = path.flatMap((step, k) => (stepParts(step, look.boxes).has(i) ? [k + 1] : []))
	return steps.length === 0 ? '' : `${steps.length === 1 ? 'Step' : 'Steps'} ${list(runs(steps))}`
}

// Numbers in order as words, with three or more in a row said as one span: 1, 3, 4, 5, 6 is "1" and "3 to 6". A
// badge has room for few words.
function runs(numbers) {
	const said = []
	for (let i = 0; i < numbers.length; ) {
		let j = i
		while (numbers[j + 1] === numbers[j] + 1) j++
		if (j - i >= 2) said.push(`${numbers[i]} to ${numbers[j]}`)
		else said.push(...numbers.slice(i, j + 1).map(String))
		i = j + 1
	}
	return said
}

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
	// A picked part lights the arrows that touch it and the parts at their other ends, as pointing at it does. Under a
	// change the boxes keep their marks, touched or not, and only the arrows light.
	const hot = new Set(links.flatMap((link, i) => (chosen.has(link.from) || chosen.has(link.to) ? [i] : [])))
	const lit = look.change ? new Set() : new Set([...chosen, ...[...hot].flatMap((i) => [links[i].from, links[i].to])])
	const cells = look.boxes.map((box, i) =>
		boxHtml(box, i, {
			home,
			detail,
			colour: colour(box.name),
			badge: detail === 'big' ? '' : badgeOf(i, box, look, content, path),
			chosen: chosen.has(i),
		}),
	)
	return pictureHtml(cells, links, {
		numbered: true,
		open: home.openArrows,
		lit,
		hot: chosen.size > 0 ? hot : null,
		marked: Boolean(look.change),
	})
}

// Where the reader is: the levels they went down, the project first, each a button but the one on screen, which is
// the page's heading. A part they picked stands after it, and the level's own step then goes back to the board, as
// Esc does.
function trailHtml(home) {
	const { trail } = home
	const picked = home.selected?.kind === 'part' ? home.selected.name : null
	const named = (step, i) => esc(i === 0 ? projectName(home) : step.name)
	const up = trail
		.slice(0, -1)
		.map(
			(step, i) =>
				`<li><button class="link" data-act="home-crumb" data-index="${i}" data-key="home-crumb-${i}">${named(step, i)}</button></li>`,
		)
	const here = named(trail.at(-1), trail.length - 1)
	const level = picked ? `<button class="link" data-act="home-board" data-key="home-crumb-here">${here}</button>` : here
	const colour = trail.length > 1 ? colourOf(home)('') : ''
	return `<nav class="home-trail" aria-label="Where you are in the project"><ol>${up.join('')}<li${picked ? '' : ' aria-current="location"'}><h1 class="home-level ${colour}" id="home-level" data-key="home-level" tabindex="-1">${level}</h1></li>${picked ? `<li class="home-picked" aria-current="location">${esc(picked)}</li>` : ''}</ol></nav>`
}

// The changes ken explained before, newest first, each once: the reader can open one again with no model. ken's own
// copy of uncommitted work is left out: it is not a range the project's git holds.
function explainedChoices(rows) {
	const seen = new Set()
	return [...rows]
		.reverse()
		.flatMap((row) => {
			if (row.outcome !== 'answered' || !row.change || row.change.snapshot) return []
			const change = `${row.change.base}..${row.change.head}`
			if (seen.has(change)) return []
			seen.add(change)
			return [{ change, name: row.question.split('\n')[0] }]
		})
		.slice(0, SHOWN_EXPLAINED)
}

// The change picker of "Catch up" and "Review a change". Catching up offers what landed since a point in time, and
// behind one line takes a day or a number of days of the reader's own. Reviewing offers the reader's own work,
// branches, merges and commits, and behind one line takes another change: a range, a branch or one commit. A second
// line there shows the project as it was at an older commit, which is no change to review. What the server refused
// shows its reason under its field.
function pickerHtml(home, rows) {
	const { look, changes, wayIn, problem, typed } = home
	if (wayIn === 'learn') return ''
	const review = wayIn === 'review'
	const since = changes.filter((choice) => choice.kind === 'since')
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
	const none = home.change === 'none' ? option('none', review ? 'No change picked' : 'Nothing picked') : ''
	// The field a refusal belongs to: a change the reader typed is refused under the field they typed it in.
	const own = review ? 'another' : 'since'
	const refused = problem?.field === 'change' && typed[own].trim() !== '' ? own : problem?.field
	const error = (field) =>
		refused === field
			? `<span class="home-error" id="home-${field}-error">${esc(problem.message)} The picture has not changed.</span>`
			: ''
	const invalid = (field) => (refused === field ? ` aria-invalid="true" aria-describedby="home-${field}-error"` : '')
	// A field the reader types in, behind one line. Each is a form of its own, so Enter sends the field it is pressed in.
	const typedIn = (field, summary, label, placeholder) =>
		`<details class="home-other" data-key="home-other-${field}"${refused === field ? ' open' : ''}>
				<summary data-key="home-other-${field}-summary">${summary}</summary>
				<form class="home-field home-typed" data-field="${field}" autocomplete="off"><label for="home-${field}">${label}</label><input id="home-${field}" name="${field}" data-key="home-${field}" value="${esc(typed[field])}" placeholder="${placeholder}" spellcheck="false"${invalid(field)} /><button class="quiet-button" type="submit" data-key="home-show-${field}">Show</button></form>${error(field)}
			</details>`
	const more = review
		? `${typedIn('another', 'Another change', 'A range, a branch or one commit', 'main..feature')}${typedIn('at', 'See the project at an older commit', 'At commit', 'HEAD~10')}`
		: typedIn('since', 'Another span', 'Since a day or a number of days', '2026-11-01 or 14')
	const nothing =
		!review && since.length === 0
			? '<p class="home-line">No commit landed in the last 90 days. Name a day further back to catch up from.</p>'
			: ''
	const select =
		!review && since.length === 0
			? ''
			: `<span class="home-field"><label for="home-change">${review ? 'The change' : 'Show what landed'}</label><select id="home-change" name="change" data-key="home-change"${invalid('change')}>${none}${current}${groups}</select></span>${error('change')}`
	return `<div class="home-picker">${nothing}${select}${more}</div>`
}

// What the canvas says over the picture: an older commit, a level nobody named, and the reader's own words when
// ken's model drew the picture the way they asked.
function notesHtml(home) {
	const { look } = home
	const said = []
	if (look.at !== look.head) {
		const boxes = look.named ? 'the parts as they were named then' : "today's folders"
		said.push(
			`<p class="home-line">You are looking at commit <code>${esc(look.at.slice(0, 7))}</code>, not the one checked out now. The boxes are ${boxes}.</p>`,
		)
	}
	if (!look.named && look.boxes.length > 0) {
		said.push(
			look.boxes.every((box) => isFile(box) || /^\d+ more files$/.test(box.name))
				? '<p class="home-line">These boxes are files.</p>'
				: `<p class="home-line">These boxes are folders. ken's model has not named the parts ${home.trail.length === 1 ? 'of this project' : 'in here'} yet.</p>`,
		)
	}
	if (look.change?.files === 0) said.push('<p class="home-line">This change touched no file here.</p>')
	if (look.named?.asked) {
		said.push(`<div class="home-banner" role="status">
			<p>ken's model drew it the way you asked, "${esc(look.named.asked)}". <button class="link" data-act="home-back" data-key="home-back">Go back to the picture before</button></p>
			${home.backProblem ? `<p class="home-error">${esc(home.backProblem)}</p>` : ''}
		</div>`)
	}
	// A step of a walkthrough whose files sit in no part lights no box, so one line names them.
	const path = pathOf(look, home.content)
	const at = home.selected?.kind === 'step' ? placeOf(path, home.selected) : -1
	if (at >= 0 && stepParts(path[at], look.boxes).size === 0) {
		const files = stepFiles(path[at]).map((file) => file.path)
		said.push(
			`<p class="home-line" role="status">Step ${at + 1} touches no part${files.length > 0 ? `: ${pathList(files)}` : ''}.</p>`,
		)
	}
	return said.join('')
}

// Under the picture: what an arrow and an amber edge mean, and what sits in no box, which folds behind one line.
function footHtml(look) {
	const noun = look.named ? 'part' : 'box'
	const said = []
	if (look.arrows.length > 0) said.push('<span>An arrow points from the part that uses to the part it uses.</span>')
	if (look.change && look.change.files > 0) {
		said.push('<span class="home-key">An amber edge marks a part the change touched.</span>')
	}
	const outside = look.change?.outside ?? []
	if (outside.length > 0) {
		said.push(
			`<details class="home-loose" data-key="home-outside"><summary>The change also touched ${count(outside.length, 'file', 'files')} in no ${noun}.</summary><p>${pathList(outside)}.</p></details>`,
		)
	}
	if (look.loose.length > 0) {
		said.push(
			`<details class="home-loose" data-key="home-loose"><summary>${count(look.loose.length, 'file or folder', 'files and folders')} at this level ${look.loose.length === 1 ? 'is' : 'are'} in no ${noun}.</summary><p>${pathList(look.loose)}.</p></details>`,
		)
	}
	return said.length === 0 ? '' : `<div class="home-foot">${said.join('')}</div>`
}

// The tabs over the canvas, for a level with drawn pictures: the parts, then the newest drawn pictures, each under its
// diagram's title, and the rest behind "Older". The picture on screen always has a tab, in the last place when it is
// an older one.
function tabsHtml(home) {
	const [, ...drawn] = home.pictures
	if (drawn.length === 0) return ''
	const on = home.content.kind === 'drawn' ? home.content.id : null
	const first = drawn.slice(0, SHOWN_DRAWN)
	const older = drawn.slice(SHOWN_DRAWN)
	const swap = older.findIndex((picture) => picture.id === on)
	if (swap >= 0) [first[SHOWN_DRAWN - 1], older[swap]] = [older[swap], first[SHOWN_DRAWN - 1]]
	const name = (picture) => picture.title ?? picture.asked
	const tab = (id, text, pressed) =>
		`<button class="pic-tab" data-act="home-picture" data-id="${esc(id)}" data-key="pic-${esc(id)}" aria-pressed="${pressed}">${text}</button>`
	const tabs = [
		tab('', 'The parts', on === null),
		...first.map((picture) =>
			tab(picture.id, `<span title="${esc(name(picture))}">${prose(name(picture))}</span>`, picture.id === on),
		),
	]
	const rest =
		older.length === 0
			? ''
			: `<details class="pic-older" data-key="pic-older"><summary data-key="pic-older-summary">Older (${older.length})</summary><ul>${older
					.map(
						(picture) =>
							`<li><button class="link" data-act="home-picture" data-id="${esc(picture.id)}" data-key="pic-${esc(picture.id)}">${prose(name(picture))}</button></li>`,
					)
					.join('')}</ul></details>`
	return `<div class="pic-row"><div class="pic-tabs" role="group" aria-label="Pictures of this level">${tabs.join('')}</div>${rest}</div>`
}

// A drawn picture in place of the parts: the diagram's title and label, the reader's own words, and the drawing. A
// drawing wider than the canvas scrolls sideways inside its frame, and says so only then.
function drawnHtml({ picture, q }) {
	const diagram = diagramOf(q)
	if (!diagram) return '<p class="home-line">Reading the picture ken drew.</p>'
	return `<section class="diagram home-drawn" aria-labelledby="home-drawn-title">
			<h2 class="diagram-title" id="home-drawn-title">${label(diagram.label)}${prose(diagram.title)}</h2>
			<p class="home-line">ken's model drew it the way you asked, "${esc(picture.asked)}". <span class="drawing-hint">Scroll it sideways to see the rest.</span></p>
			<div class="drawing-frame"><div class="drawing" data-diagram="${esc(picture.id)}" data-mermaid="${esc(diagram.mermaid)}" role="img" aria-label="Diagram: ${esc(diagram.title)}. The numbered list at How it works says the same in words."></div></div>
		</section>`
}

const READING = '<p class="home-line home-reading" role="status">Reading the project from git.</p>'

// home is the home's state, and rows the reader's saved questions, which name the changes ken explained before.
export function canvasHtml(home, rows) {
	const { look, problem } = home
	const name = `<div class="home-where">${trailHtml(home)}</div>`
	// While the server reads another level, the one on screen is not the one the heading names, so it gives its place
	// to one line. A level read again for another change or commit stays, so the picture does not blink.
	if (!look || home.reading === 'level') return `<div class="home-head">${name}</div>${problem ? '' : READING}`
	// A level the server refused takes the old one off the screen, so nothing under the problem is out of date. A
	// commit or a change it refused leaves the level as it was, with the reason under the field the reader filled.
	if (problem && !problem.keeps) {
		return `<div class="home-head">${name}</div>
			<p class="home-line" role="alert">ken could not show this. ${prose(problem.message)} <button class="link" data-act="home-reset" data-key="home-reset">Show where you are now</button></p>`
	}
	const drawn = home.content.kind === 'drawn'
	// The tabs and the picker share the line of the level's name while the canvas has room, so they take no height
	// from the picture. The way in and the change laid over belong to the parts, so a drawn picture shows without them.
	const head = `<div class="home-head">${name}${drawn ? '' : pickerHtml(home, rows)}${tabsHtml(home)}</div>`
	const reading = home.reading ? READING : ''
	if (drawn) return `${head}${reading}${drawnHtml(home.content)}`
	return `${head}${reading}
		${notesHtml(home)}
		<div class="home-picture${look.arrows.length > 0 ? ' has-arrows' : ''}${look.named ? ' is-named' : ''}"${home.reading ? ' inert' : ''}>${pictureOf(home)}</div>
		${footHtml(look)}
		<div class="home-arrows">${arrowListHtml(home, null, { where: 'canvas' })}</div>`
}
