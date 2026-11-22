// The panel beside the picture: what ken says about the selection at the chosen detail. With nothing selected it is
// about the whole level or the whole change. One line at its top says who wrote what: the explanations are the
// model's, and a boxed card holds what plain code read from git or lines ken found there. While a run of ken's model
// started from the home is under way, the panel shows that run in place of what it will fill, and when a run ends
// with nothing to show, it says so. The code calls the panel the inspector.
import { stepDiffHtml } from '../../project/walk.js'
import { count, day, esc, list, pathList, prose, runButton, short } from '../../views/format.js'
import { LEGEND, storyHtml } from '../../views/reply.js'
import { noModelHtml, workingHtml } from '../../views/states.js'
import { changeName, mapLine, stateLine } from '../canvas/canvas.js'
import { besideCanvas, diagramOf, firstUnseen, pathOf, placeOf, shownDetail, stoodOn } from '../state/content.js'
import { colourOf, DETAILS, levelName } from '../state/home-state.js'
import { diffKey } from '../state/loads.js'
import { DOING, isThere, levelOf } from '../state/runs.js'
import {
	asksHtml,
	elementNoun,
	elementsView,
	FROM_GIT,
	factCard,
	filesHtml,
	knownFold,
	lookInside,
	outsideHtml,
	pathView,
	pickedElementHtml,
	usesHtml,
} from './reading-path.js'

// Paths a line lists before it keeps the rest behind one line, and commits a change lists before it does the same.
const SHOWN_PATHS = 8
const SHOWN_COMMITS = 10

const READING_REPLY = `<p class="muted">Reading what ken's model said.</p>`

// A part's files: how many, and where they are. The first few paths show, and the rest behind one line.
function filesLine(box) {
	const said = `${count(box.files, 'file', 'files')}: `
	if (box.paths.length <= SHOWN_PATHS) return `${said}${pathList(box.paths)}.`
	return `${said}${pathList(box.paths.slice(0, SHOWN_PATHS))}<details class="insp-more" data-key="more-paths"><summary>and ${box.paths.length - SHOWN_PATHS} more</summary>${pathList(box.paths.slice(SHOWN_PATHS))}.</details>`
}

// One level, nothing selected: the way to be shown around it, and its parts in reading order.
function levelView(home, off) {
	const { look, content } = home
	const here = look.at === look.head
	const path = pathOf(look, content)
	const changed = look.boxes.filter((box) => box.state !== 'same').map((box) => box.name)
	const { added } = look.named
	const stale =
		look.named.stale && here
			? `<div class="insp-stale"><p>${esc(
					[
						...(changed.length > 0
							? [
									`Since ken's model named these parts, ${list(changed)} changed, so the arrows from ${changed.length === 1 ? 'it' : 'them'} may be out of date.`,
								]
							: []),
						...(added.length > 0 ? [`${list(added)} ${added.length === 1 ? 'is' : 'are'} new and in no part.`] : []),
					].join(' '),
				)}</p>${runButton({ act: 'run-name', key: 'run-name', text: 'Name them again' }, off)}</div>`
			: ''
	let tour = ''
	if (content.tour) {
		// A reader who has seen some stops goes on at the first they have not, and is told which, with the way to stop 1.
		const start = firstUnseen(look, path)
		const button = (k, body, kind = 'primary nav-button') =>
			`<button class="${kind}" data-act="home-tour" data-index="${k}" data-key="home-tour-${k}">${body}</button>`
		tour =
			start === 0
				? `<div class="insp-main">${button(0, 'Start the tour', 'primary')}</div>`
				: `<div class="insp-main insp-actions">${button(start, `<span class="nav-name">Go on with the tour</span><span class="nav-way">Stop ${start + 1} of ${path.length}: ${esc(path[start].part)}</span>`)}${button(0, 'Start again at stop 1', 'link')}</div>`
	} else if (path.length > 0 && here) {
		tour = `<div class="insp-main">${runButton({ act: 'run-tour', key: 'run-tour', text: 'Show me around', primary: true }, off)}
			<p class="small muted">ken's model shows you the ${path.length} parts in turn, with their code, starting at ${esc(path[0].part)}. The order is the one ken's model named the parts in, with tests and upkeep last.</p></div>`
	}
	const colour = colourOf(home)
	const order =
		path.length > 0
			? path.map((step) => look.boxes.findIndex((box) => box.name === step.part))
			: look.boxes.map((_, i) => i)
	const parts = order.map((i) => {
		const box = look.boxes[i]
		return `<li><button class="insp-part" data-act="home-box" data-index="${i}" data-key="insp-part-${i}"><span class="part-name ${colour(box.name)}">${esc(box.name)}</span><span class="insp-part-job">${prose(box.job ?? '')}</span></button></li>`
	})
	const first =
		look.next.changed.length === 0
			? ''
			: `<p class="small"><strong>Code you understood in ${esc(list(look.next.changed))} has changed since.</strong> Look there first.</p>`
	return {
		title: esc(levelName(home)),
		body: `${stale}${tour}${first}
			<h3 class="insp-sub">${count(parts.length, 'part', 'parts')}. Pick one to read about it.</h3>
			<ul class="insp-parts">${parts.join('')}</ul>
			${look.arrows.length > 0 ? `<div class="insp-arrows">${usesHtml(home, null)}</div>` : ''}`,
	}
}

// One part of a level at "Big picture": its job, where it is, and what it uses.
function partView(home, box) {
	const title = { picked: true, title: esc(box.name), titleClass: `part-name ${colourOf(home)(box.name)}` }
	if (stoodOn(box, [box.name]) === 'known' && !home.unfolded.has(box.name)) {
		return { ...title, body: knownFold(box.name) }
	}
	const state = stateLine(box, home.look)
	const map = mapLine(box.map)
	return {
		...title,
		body: `<p class="insp-lead">${prose(box.job ?? '')}</p>
			<div class="small">${filesLine(box)}</div>
			${state === '' ? '' : `<p class="small">${state}.</p>`}
			${map === '' ? '' : `<p class="small">${map}.</p>`}
			${usesHtml(home, box.name)}
			<p class="insp-actions">${lookInside(box)}<button class="quiet-button" data-act="detail" data-detail="how" data-key="to-how">Read how it works</button></p>`,
	}
}

// A level nobody named yet: what git shows, and the one run that names its parts.
function foldersView(home, off) {
	const { look } = home
	const files = look.boxes.reduce((sum, box) => sum + box.files, 0)
	const here = look.at === look.head
	const ask = here
		? `<div class="insp-main">${runButton({ act: 'run-name', key: 'run-name', text: 'Ask ken to name these parts', primary: true }, off)}
			<p class="small muted">After the run the boxes are parts with names and one-line jobs, and arrows for which part uses which. ken checks each path and arrow against the code. Then the Detail control opens.</p></div>`
		: `<p class="small muted">ken's model reads the code that is checked out, so it cannot name the parts of this older commit.</p>`
	const facts = [
		`${count(look.boxes.length, 'box', 'boxes')} with ${count(files, 'file', 'files')}.`,
		...(look.loose.length > 0
			? [`${count(look.loose.length, 'more file or folder', 'more files and folders')} at this level, in no box.`]
			: []),
		`The commit is <code>${short(look.at)}</code>.`,
	]
	return {
		title: esc(levelName(home)),
		body: `<p class="insp-lead">ken's model has not named the parts of ${home.trail.length === 1 ? 'this project' : esc(levelName(home))} yet. What you see is what git lists.</p>
			${ask}
			${factCard('What git shows', FROM_GIT, `<ul class="fact-list">${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>`)}`,
	}
}

function folderView(box) {
	return {
		picked: true,
		title: esc(box.name),
		body: `<div class="small">${filesLine(box)}</div>
			<p class="insp-actions">${lookInside(box)}</p>`,
	}
}

// The commits of a change as git lists them, newest first: the day, who wrote it, and its subject. The first few
// show, and the rest behind one line.
function commitsHtml(change) {
	const rows = change.commits.map(
		(commit) =>
			`<li><span class="commit-day">${day(commit.date.slice(0, 10))}</span> <span class="commit-who">${esc(commit.author)}</span> ${esc(commit.subject)}</li>`,
	)
	if (rows.length === 0) return ''
	const rest = rows.slice(SHOWN_COMMITS)
	const older =
		change.moreCommits === 0
			? ''
			: `<p class="small muted">${count(change.moreCommits, 'older commit is', 'older commits are')} not listed here. <code>git log ${short(change.range.base)}..${short(change.range.head)}</code> lists them all.</p>`
	const more =
		rest.length + change.moreCommits === 0
			? ''
			: `<details class="insp-more" data-key="more-commits"><summary>and ${rest.length + change.moreCommits} more</summary>${rest.length > 0 ? `<ol class="insp-commits">${rest.join('')}</ol>` : ''}${older}</details>`
	return `<ol class="insp-commits">${rows.slice(0, SHOWN_COMMITS).join('')}</ol>${more}`
}

// What git says of a change, with no model: how much it changed and where, then its commits. byPart adds the changed
// files of each part, for the details that look closer.
function gitSaysHtml(home, byPart) {
	const { look } = home
	const { change } = look
	const touched = look.boxes.filter((box) => box.touched)
	const noun = look.named ? 'part' : 'folder'
	const commits = change.commits.length + change.moreCommits
	const facts = [
		commits > 0 ? `<li>${count(commits, 'commit', 'commits')}.</li>` : '',
		`<li>${count(change.files, 'file', 'files')} changed, in ${touched.length} of the ${count(look.boxes.length, noun, `${noun}s`)}.</li>`,
	]
	const colour = colourOf(home)
	const files = !byPart
		? ''
		: factCard(
				`Changed files, by ${noun}`,
				FROM_GIT,
				`${touched
					.map(
						(box) =>
							`<p><strong class="part-name ${colour(box.name)}">${esc(box.name)}</strong></p>${filesHtml(box.touched.paths, box.touched.morePaths)}`,
					)
					.join('')}${outsideHtml(look)}`,
			)
	return `${factCard('What git says', FROM_GIT, `<ul class="fact-list">${facts.join('')}</ul>${commitsHtml(change)}${byPart ? '' : outsideHtml(look)}`)}${files}`
}

// A change, nothing selected, at "Big picture": what git says of it, then its story in the model's words, or the run
// that asks for one.
function changeView(home, off) {
	const { look, content, changes } = home
	let story
	if (content.story?.q) {
		story = `<h3 class="insp-sub">What it did, in the words of ken's model</h3>${storyHtml(content.story.q, 'story', home.ui)}${asksHtml(off)}`
	} else if (content.story) story = READING_REPLY
	else if (look.change.files === 0) story = ''
	else {
		story = `<div class="insp-main">${runButton({ act: 'run-story', key: 'run-story', text: 'Ask ken what this change did', primary: true }, off)}
			<p class="small muted">ken's model reads the diff and the commit messages, and says what the change did and why.</p></div>`
	}
	const walk =
		content.walk && look.named
			? `<p><button class="link" data-act="detail" data-detail="how" data-key="to-how">Read the walkthrough ken's model gave, step by step</button></p>`
			: ''
	const name = look.named
		? ''
		: `<div class="insp-main">${runButton({ act: 'run-name', key: 'run-name', text: 'Ask ken to name these parts' }, off)}</div>`
	return {
		title: esc(changeName(look, changes)),
		body: `${gitSaysHtml(home, false)}${story}${walk}${name}`,
	}
}

// A change with no walkthrough stored, at "How it works" and "In the code": what git says, the changed files of each
// part, and the run that asks for a walkthrough. So a closer detail never shows less than the one before it.
function unwalkedView(home, off) {
	const { look, content, changes } = home
	const code = shownDetail(home) === 'code'
	const pick = code ? '<p class="insp-pick">Pick a part in the picture to see the diff of its changed files.</p>' : ''
	const ask = content.walk
		? READING_REPLY
		: look.change.files === 0
			? '<p class="muted">This change touched no file here, so there is nothing to walk through.</p>'
			: `<div class="insp-main">${runButton({ act: 'run-walk', key: 'run-walk', text: 'Ask ken to walk me through it', primary: true }, off)}
				<p class="small muted">ken's model orders the change into steps a reviewer can read one at a time, each with its diff.</p></div>`
	return {
		title: esc(changeName(look, changes)),
		body: `${gitSaysHtml(home, true)}${pick}${ask}`,
	}
}

// The diff of the files a change touched in one part, read from git when the reader asks for it.
function partDiffHtml(home, box) {
	const { change } = home.look
	const diff = home.diffs.get(diffKey(change, box))
	if (!diff) return '<p class="muted">Reading the diff from git.</p>'
	if (diff.problem) return `<p class="home-error" role="alert">ken could not read the diff. ${esc(diff.problem)}</p>`
	const all = `<code>git diff ${short(change.range.base)} ${short(change.range.head)}</code>`
	const notes = [
		...(diff.tooLarge ? [`This change is too large for ken to read its diff here. ${all} shows it.`] : []),
		...(diff.binary ?? []).map((path) => `<code>${esc(path)}</code> is not text, so it has no lines to show.`),
		...(diff.cut ? [`The diff is long, so only its first lines show here. ${all} shows all of it.`] : []),
		...(diff.left > 0 ? [`${count(diff.left, 'more file', 'more files')} changed here. ${all} shows them.`] : []),
	]
	const lines =
		diff.hunks.length === 0 ? '' : `<div class="path-diff">${stepDiffHtml({ hunks: diff.hunks }, change.range)}</div>`
	return `${lines}${notes.map((note) => `<p class="small muted">${note}</p>`).join('')}`
}

// One part with a change laid over it: the files the change touched there, and at "In the code" their diff.
function touchedView(home, box) {
	const code = shownDetail(home) === 'code'
	const did = !box.touched
		? '<p>The change did not touch this part.</p>'
		: `${factCard('What the change touched here', FROM_GIT, filesHtml(box.touched.paths, box.touched.morePaths))}
			${code ? partDiffHtml(home, box) : '<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">See the diff of these files</button></p>'}`
	return {
		picked: true,
		title: esc(box.name),
		titleClass: `part-name ${colourOf(home)(box.name)}`,
		body: `${box.job ? `<p class="insp-lead">${prose(box.job)}</p>` : ''}
			${did}
			${home.look.named ? usesHtml(home, box.name) : ''}
			<p class="insp-actions">${lookInside(box)}</p>`,
	}
}

// A drawn picture at "Big picture": what ken's model said when it drew it, and above that the box or arrow the reader
// picked in the drawing. While the answer to the request still shows those words, they are not said twice.
function drawnView(home) {
	const { picture, q } = home.content
	const diagram = diagramOf(q)
	if (!diagram) return { title: prose(picture.title ?? picture.asked), body: READING_REPLY }
	const title = prose(diagram.title)
	if (shownDetail(home) !== 'big') return { title, ...elementsView(home, diagram) }
	const element = diagram.elements[placeOf(diagram.elements, home.selected)]
	const told = besideCanvas(q, true)
	// While ken's answer to the request shows over this, it says these words and opens the full reply itself.
	const answered = home.said?.q.id === q.id
	const words = answered
		? ''
		: told.reply.items.length === 0
			? `<p class="muted">ken's model drew this picture and said nothing more.</p>`
			: `<h3 class="insp-sub">What ken's model said when it drew this</h3>${storyHtml(told, 'drawn', home.ui)}`
	const noun = element ? elementNoun(diagram, element) : ''
	return {
		where: element ? `${noun.replace(/^./, (c) => c.toUpperCase())} ${element.number}` : '',
		picked: Boolean(element),
		title,
		body: `${pickedElementHtml(home, diagram)}${words}
			<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="how" data-key="to-how">Read it in order</button><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-all-code">Show its code</button></p>
			${answered ? '' : `<p><button class="link" data-act="open" data-id="${esc(q.id)}" data-key="drawn-open">Open the full reply</button></p>`}`,
	}
}

// A run of ken's model that the reader started here, while it runs: what ken is doing, for how long, and its actions.
function workingView(home, running, seconds) {
	const [title, doing] = DOING[running.onHome.kind]
	const asked = running.onHome.kind === 'redraw' ? `<p class="insp-asked">"${esc(home.redraw.asked)}"</p>` : ''
	return {
		title,
		body: `${asked}<p class="small muted">The picture stays as it is until the run ends. The run stops if you close or reload this tab. ken keeps every run under Earlier replies.</p>
			${workingHtml(running.q, 0, home.stepsOpen, seconds, doing)}`,
	}
}

const ENDED = {
	stopped: 'You stopped this run.',
	error: "ken's model did not reply.",
	'no-answer': "ken's model stopped without a reply.",
	'out-of-turns': "ken's model ran out of turns before it replied.",
	unasked: 'ken did not start its model for this request.',
	answered: "ken's model replied, but with nothing this page can show here.",
}

// What a run is doing, said to a reader who has left the level or the change it is for.
const STILL = {
	name: (level) => `ken's model is naming the parts of ${level}.`,
	tour: (level) => `ken's model is writing the tour of ${level}.`,
	story: () => "ken's model is reading the change you asked about.",
	walk: () => "ken's model is ordering the change you asked about into steps.",
	redraw: (level) => `ken's model is working on your request about ${level}.`,
}

// What a run made, said to a reader who has left the level or the change it was for.
const FINISHED = {
	name: (level) => `ken's model named the parts of ${level}.`,
	tour: (level) => `ken finished the tour of ${level}.`,
	story: () => "ken's model said what the change did.",
	walk: () => "ken's model walked through the change.",
	redraw: (level) => `ken answered your request about ${level}.`,
}

// A run of ken's model for another level or change than the one on screen: one quiet line, and the way back to it.
function awayHtml(said, key) {
	const close =
		key === 'ended' ? ' <button class="link" data-act="home-ended-close" data-key="ended-close">Close</button>' : ''
	return `<p class="insp-away" role="status">${esc(said)} <button class="link" data-act="home-run-go" data-key="${key}-go">Go there</button>${close}</p>`
}

// A run that ended and needs a word. One that made nothing to show says so, with the way to its full reply in the
// thread. One that made it for a level the reader has left says where.
function endedHtml(ended) {
	if (!ended) return ''
	if (ended.kind === 'elsewhere') return awayHtml(FINISHED[ended.run](ended.level), 'ended')
	const open = ended.id
		? `<button class="quiet-button" data-act="open" data-id="${esc(ended.id)}" data-key="ended-open">Open the full reply</button>`
		: ''
	return `<div class="notice insp-ended" role="alert">
		<h3>${ENDED[ended.outcome] ?? 'This run has no reply.'}</h3>
		${ended.error ? `<p>${prose(ended.error)}</p>` : ''}
		<p class="insp-actions">${open}<button class="quiet-button" data-act="home-ended-close" data-key="ended-close">Close</button></p>
	</div>`
}

// Something the server could not do that leaves the picture as it is, in plain words.
function troubleHtml(trouble) {
	if (!trouble) return ''
	const again = trouble.again
		? '<button class="quiet-button" data-act="home-retry" data-key="trouble-retry">Try again</button>'
		: ''
	return `<div class="notice insp-ended" role="alert">
		<h3>${esc(trouble.said)}</h3>
		<p>${esc(trouble.message)} The picture is from git, and is as it was.</p>
		<p class="insp-actions">${again}<button class="quiet-button" data-act="home-trouble-close" data-key="trouble-close">Close</button></p>
	</div>`
}

// ken's answer to the reader's request to show a level another way: what changed, or why nothing did. A diagram ken
// drew for it is a picture of its own on the canvas, so the answer only says where it is.
function saidHtml(home) {
	const { said } = home
	if (!said) return ''
	const reply =
		said.q.reply.items.length === 0 ? "<p>ken's model answered with no words.</p>" : storyHtml(said.q, 'said', home.ui)
	const drawn = home.pictures.some((picture) => picture.id === said.q.id)
	const onCanvas = !drawn
		? ''
		: home.shown === said.q.id
			? '<p class="small muted">The picture it drew shows in place of the parts, under its own tab.</p>'
			: `<p class="small muted">It drew a picture. <button class="link" data-act="home-picture" data-id="${esc(said.q.id)}" data-key="said-picture">Show that picture</button></p>`
	return `<section class="insp-said" aria-labelledby="insp-said-head">
		<div class="insp-said-head"><h3 id="insp-said-head">ken's answer to your request</h3><button class="link" data-act="home-said-close" data-key="said-close">Close</button></div>
		<p class="insp-asked">"${esc(said.asked)}"</p>
		${reply}
		${onCanvas}
		<p><button class="link" data-act="open" data-id="${esc(said.q.id)}" data-key="said-open">Open the full reply</button></p>
	</section>`
}

function viewOf(home, off) {
	const { look, content, selected } = home
	const big = shownDetail(home) === 'big'
	const box = selected?.kind === 'part' ? look.boxes.find((each) => each.name === selected.name) : null
	if (content.kind === 'drawn') return drawnView(home)
	if (content.kind === 'change') {
		if (box) return touchedView(home, box)
		if (big) return changeView(home, off)
		return content.walk?.q
			? { title: esc(changeName(look, home.changes)), ...pathView(home, off) }
			: unwalkedView(home, off)
	}
	if (content.kind === 'folders') return box ? folderView(box) : foldersView(home, off)
	if (!big) {
		const reading = content.tour && !content.tour.q ? READING_REPLY : ''
		const view = pathView(home, off)
		return { title: esc(levelName(home)), ...view, body: `${reading}${view.body}` }
	}
	return box ? partView(home, box) : levelView(home, off)
}

// home is the home's state. env says what the page around it is doing: off is the reason no run of ken's model can
// start now, or null; running is the run under way, if any, with seconds since it started; model is the model's
// setting, and asked whether the reader has saved questions.
export function inspectorHtml(home, env) {
	if (!home.look || home.reading === 'level') {
		return `<div class="insp-scroll" id="insp-scroll">${home.problem ? '' : '<p class="muted" role="status">Reading the project from git.</p>'}</div>`
	}
	// A run shows in place of what it will fill only while the reader is where it started.
	const run = env.running?.onHome ?? null
	const working = run !== null && isThere(run, home)
	const away = run !== null && !working ? awayHtml(STILL[run.kind](levelOf(run)), 'run') : ''
	const view = working ? workingView(home, env.running, env.seconds) : viewOf(home, env.off)
	const whole =
		home.content.kind === 'drawn'
			? 'Show the whole picture'
			: home.content.kind === 'change'
				? 'Show the whole change'
				: home.trail.length === 1
					? 'Show the whole project'
					: `Show all of ${esc(levelName(home))}`
	const clear =
		view.picked && !working ? `<button class="link" data-act="home-clear" data-key="home-clear">${whole}</button>` : ''
	const notices = working ? '' : `${away}${troubleHtml(home.trouble)}${endedHtml(home.ended)}${saidHtml(home)}`
	const noModel = env.model?.kind === 'unset' ? noModelHtml(env.model, env.asked, true) : ''
	const nav = working ? '' : (view.nav ?? '')
	// While the server reads the level again for another change or commit, the panel still shows the one before. It
	// cannot be pressed or reached by the keyboard then, so a stop of the old path is not picked into the new one.
	const closed = home.reading ? ' inert' : ''
	// The line on who wrote what shows once the panel holds words of ken's model: a part's job, a story, a picture.
	const { look, content } = home
	const told =
		look.named || content.kind === 'drawn' || content.story?.q || content.walk?.q || home.said
			? `<p class="insp-legend">${LEGEND}</p>`
			: ''
	return `<div class="insp-scroll" id="insp-scroll"${closed}>
			${told}
			<p class="insp-head"><span class="insp-detail">${DETAILS[shownDetail(home)]}</span>${view.where ? `<span class="insp-where">${view.where}</span>` : ''}${clear}<button class="link insp-up" data-act="home-up" data-key="home-up">Back to the picture</button></p>
			<h2 class="insp-title ${view.titleClass ?? ''}" id="insp-title" data-key="insp-title" tabindex="-1">${view.title}</h2>
			${notices}
			${view.body}
			${noModel}
		</div>
		${nav === '' ? '' : `<div class="insp-foot"${closed}>${nav}</div>`}`
}
