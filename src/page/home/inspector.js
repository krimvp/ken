// The home's inspector: what ken says about the selection at the chosen detail. With nothing selected it is about the
// whole level or the whole change. Plain text in it is the model's, and a boxed card is what ken read from git. While
// a run of ken's model started from the home is under way, the inspector shows that run in place of what it will
// fill, and when a run ends with nothing to show, it says so.
import { at, count, esc, list, prose, runButton, short } from '../views/format.js'
import { storyHtml } from '../views/reply.js'
import { noModelHtml, workingHtml } from '../views/states.js'
import { changeName, colourOf, levelName, stateLine } from './canvas.js'
import { firstUnseen, pathOf, shownDetail, stoodOn } from './content.js'
import { asksHtml, factCard, pathView, usesHtml } from './reading-path.js'

export const DETAILS = { big: 'Big picture', how: 'How it works', code: 'In the code' }

const LEGEND = "Plain text is what ken's model says. ken has not checked it. A boxed card is checked against git."

// Paths a line lists before it folds the rest.
const SHOWN_PATHS = 8

// Paths as the end of a sentence: the first few, and the rest behind one line.
function pathsHtml(paths) {
	const code = (items) => items.map((p) => `<code class="pv-path">${esc(p)}</code>`).join(', ')
	if (paths.length <= SHOWN_PATHS) return `${code(paths)}.`
	return `${code(paths.slice(0, SHOWN_PATHS))}<details class="insp-more"><summary>and ${paths.length - SHOWN_PATHS} more</summary>${code(paths.slice(SHOWN_PATHS))}.</details>`
}

function lookInside(box) {
	return box.opens
		? `<button class="quiet-button" data-act="home-open" data-key="home-open">Look inside ${esc(box.name)}</button>`
		: ''
}

// One level, nothing selected: what the level is, the way to be shown around it, and its parts in reading order.
function levelView(home, off) {
	const { look, content } = home
	const here = look.at === look.head
	const path = pathOf(look, content)
	const about = content.about ? `<p class="insp-lead">${prose(content.about)}</p>` : ''
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
		const start = firstUnseen(look, path)
		const given = content.tour.q ? ` ${at(content.tour.q.askedAt)}` : ''
		tour = `<div class="insp-main"><button class="primary" data-act="home-tour" data-key="home-tour">${start === 0 ? 'Start the tour' : `Go on with the tour at stop ${start + 1}`}</button>
			<p class="small muted">ken's model gave this tour${given}. Opening it runs no model.</p></div>`
	} else if (path.length > 0 && here) {
		tour = `<div class="insp-main">${runButton({ act: 'run-tour', key: 'run-tour', text: 'Show me around', primary: true }, off)}
			<p class="small muted">ken's model shows you the ${path.length} parts in turn, with their code, starting at ${esc(path[0].part)}. Plain code picked the order from the arrows.</p></div>`
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
	const next = look.next.line === '' ? '' : `<p class="small muted">From your map: ${esc(look.next.line)}</p>`
	return {
		where: 'Nothing is selected',
		title: esc(levelName(home)),
		body: `${about}${stale}${tour}
			<h3 class="insp-sub">${count(parts.length, 'part', 'parts')}. Pick one to read about it.</h3>
			<ul class="insp-parts">${parts.join('')}</ul>
			${look.arrows.length > 0 ? usesHtml(home, null) : ''}
			${next}`,
	}
}

// One part of a level at "Big picture": its job, where it is, and what it uses.
function partView(home, box) {
	const title = {
		where: `A part of ${esc(levelName(home).replace(/^The/, 'the'))}`,
		picked: true,
		title: esc(box.name),
	}
	const titleClass = `part-name ${colourOf(home)(box.name)}`
	if (stoodOn(box, [box.name]) === 'known' && !home.unfolded.has(box.name)) {
		return {
			...title,
			titleClass,
			body: `<p class="insp-known">You said you know this part. Nothing in it changed since. <button class="link" data-act="home-unfold" data-name="${esc(box.name)}" data-key="home-unfold">Show it anyway</button></p>`,
		}
	}
	const state = stateLine(box, home.look)
	return {
		...title,
		titleClass,
		body: `<p class="insp-lead">${prose(box.job ?? '')}</p>
			<div class="small">${count(box.files, 'file', 'files')} in ${pathsHtml(box.paths)}</div>
			${state === '' ? '' : `<p class="small">${state}.</p>`}
			${box.map.line === '' ? '' : `<p class="small muted">${esc(box.map.line)}</p>`}
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
			<p class="small muted">After the run the folders become parts with names and one-line jobs, and arrows for which part uses which. ken checks each path and arrow against the code. Then the Detail control opens.</p></div>`
		: `<p class="small muted">ken's model reads the code that is checked out, so it cannot name the parts of this older commit.</p>`
	const facts = [
		`${count(look.boxes.length, 'box', 'boxes')} with ${count(files, 'file', 'files')}.`,
		...(look.loose.length > 0
			? [`${count(look.loose.length, 'more file or folder', 'more files and folders')} at this level, in no box.`]
			: []),
		`The commit is <code>${short(look.at)}</code>.`,
	]
	return {
		where: 'Nothing is selected',
		title: esc(levelName(home)),
		body: `<p class="insp-lead">ken has not explained ${home.trail.length === 1 ? 'this project' : esc(levelName(home))} yet. What you see is the folder list from git.</p>
			${ask}
			${factCard('What git shows', 'From git', `<ul class="fact-list">${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>`)}`,
	}
}

function folderView(box) {
	return {
		where: 'A folder',
		picked: true,
		title: esc(box.name),
		body: `<div class="small">${count(box.files, 'file', 'files')} in ${pathsHtml(box.paths)}</div>
			<p class="insp-actions">${lookInside(box)}</p>`,
	}
}

// The commits of a change, newest first as git lists them. ken's own copy of uncommitted work is not one of them.
function commitsHtml(commits) {
	const real = commits.filter((commit) => commit.email !== 'ken@localhost')
	if (real.length === 0) return ''
	const rows = real.map(
		(commit) =>
			`<li><code>${esc(short(commit.hash))}</code> ${esc(commit.subject)} <span class="muted">${esc(commit.author)}</span></li>`,
	)
	return `<li><details class="insp-more"><summary>${count(real.length, 'commit', 'commits')}</summary><ol class="insp-commits">${rows.join('')}</ol></details></li>`
}

// What git says of a change, as a stored reply about it holds it: its commits, newest first.
function toldOf(content) {
	return (content.story?.q ?? content.walk?.q)?.reply.change ?? null
}

// A change, nothing selected: what git says of it, then its story in the model's words, or the run that asks for one.
function changeView(home, off) {
	const { look, content, changes } = home
	const { change } = look
	const told = toldOf(content)
	const picked = changes.find((choice) => choice.change === change.asked)
	const touched = look.boxes.filter((box) => box.touched).length
	const noun = look.named ? 'part' : 'folder'
	const facts = [
		told
			? commitsHtml(told.commits)
			: picked?.commits !== undefined
				? `<li>${count(picked.commits, 'commit', 'commits')}</li>`
				: '',
		`<li>${count(change.files, 'file', 'files')} changed, in ${touched} of the ${count(look.boxes.length, noun, `${noun}s`)}.</li>`,
		change.outside.length > 0
			? `<li>${count(change.outside.length, 'changed file is', 'changed files are')} in no ${noun}: ${pathsHtml(change.outside)}</li>`
			: '',
	]
	let story
	if (content.story?.q) {
		story = `<h3 class="insp-sub">What it did, in the words of ken's model</h3>${storyHtml(content.story.q, 'story', home.ui)}${asksHtml(off)}`
	} else if (content.story) story = `<p class="muted">Reading what ken's model said.</p>`
	else if (change.files === 0) story = ''
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
		where: 'Nothing is selected',
		title: esc(changeName(look, changes, told)),
		body: `${factCard('What git says', 'From git', `<ul class="fact-list">${facts.join('')}</ul>`)}
			${story}${walk}${name}`,
	}
}

// One part with a change laid over it: what the change did there.
function touchedView(home, box) {
	const did = box.touched
		? `The change touched ${count(box.touched.files, 'file', 'files')} here: ${count(box.touched.added, 'line', 'lines')} added, ${box.touched.removed} removed.`
		: 'The change did not touch this part.'
	return {
		where: 'A part, with the change laid over it',
		picked: true,
		title: esc(box.name),
		titleClass: `part-name ${colourOf(home)(box.name)}`,
		body: `${box.job ? `<p class="insp-lead">${prose(box.job)}</p>` : ''}
			<p>${did}</p>
			${home.look.named ? usesHtml(home, box.name) : ''}
			<p class="insp-actions">${lookInside(box)}</p>`,
	}
}

const DOING = {
	name: ['Naming the parts', "ken's model is naming the parts"],
	tour: ['Preparing the tour', "ken's model is reading each part in turn"],
	story: ['Reading the change', "ken's model is reading the change"],
	walk: ['Ordering the change into steps', "ken's model is ordering the change into steps"],
	redraw: ['Working on your request', "ken's model is working on your request"],
}

// A run of ken's model that the reader started here, while it runs: what ken is doing, for how long, and its steps.
function workingView(home, running, seconds) {
	const [title, doing] = DOING[running.onHome]
	const asked = running.onHome === 'redraw' ? `<p class="insp-asked">"${esc(home.redraw.asked)}"</p>` : ''
	return {
		where: "A run of ken's model",
		title,
		body: `${asked}<p class="small muted">The picture stays as it is until the run ends. ken keeps every run under Your questions.</p>
			${workingHtml(running.q, 0, home.stepsOpen, seconds, doing)}`,
	}
}

const ENDED = {
	stopped: 'You stopped this run.',
	error: "ken's model did not reply.",
	'no-answer': "ken's model stopped without a reply.",
	'out-of-turns': "ken's model ran out of turns before it replied.",
	unasked: 'ken did not ask its model.',
	answered: "ken's model replied, but with nothing this page can show here.",
}

// A run that ended with nothing to show here, in plain words, with the way to its full reply in the thread.
function endedHtml(ended) {
	if (!ended) return ''
	const open = ended.id
		? `<button class="quiet-button" data-act="open" data-id="${esc(ended.id)}" data-key="ended-open">Open the full reply</button>`
		: ''
	return `<div class="notice insp-ended" role="alert">
		<h3>${ENDED[ended.outcome] ?? 'This run has no reply.'}</h3>
		${ended.error ? `<p>${esc(ended.error)}</p>` : ''}
		<p class="insp-actions">${open}<button class="quiet-button" data-act="home-ended-close" data-key="ended-close">Close</button></p>
	</div>`
}

// ken's reply to the reader's request to show a level another way: what changed, or why nothing did, and the diagram
// when the request needed one.
function saidHtml(said, ui) {
	if (!said) return ''
	const reply =
		said.q.reply.items.length === 0 ? "<p>ken's model answered with no words.</p>" : storyHtml(said.q, 'said', ui)
	return `<section class="insp-said" aria-labelledby="insp-said-head">
		<p class="insp-said-head"><strong id="insp-said-head">ken on your request</strong><button class="link" data-act="home-said-close" data-key="said-close">Close</button></p>
		<p class="insp-asked">"${esc(said.asked)}"</p>
		${reply}
		<p><button class="link" data-act="open" data-id="${esc(said.q.id)}" data-key="said-open">Open the full reply</button></p>
	</section>`
}

function viewOf(home, off) {
	const { look, content, selected } = home
	const big = shownDetail(home) === 'big'
	const box = selected?.kind === 'part' ? look.boxes.find((each) => each.name === selected.name) : null
	if (content.kind === 'change') {
		if (box) return touchedView(home, box)
		return big
			? changeView(home, off)
			: { title: esc(changeName(look, home.changes, toldOf(content))), ...pathView(home, off) }
	}
	if (content.kind === 'folders') return box ? folderView(box) : foldersView(home, off)
	if (!big) return { title: esc(levelName(home)), ...pathView(home, off) }
	return box ? partView(home, box) : levelView(home, off)
}

// home is the home's state. env says what the page around it is doing: off is the reason no run of ken's model can
// start now, or null; running is the run under way, if any, with seconds since it started; model is the model's
// setting, and asked whether the reader has saved questions.
export function inspectorHtml(home, env) {
	if (!home.look) return `<div class="insp-scroll"><p class="muted">Reading the project from git.</p></div>`
	const working = env.running?.onHome
	const view = working ? workingView(home, env.running, env.seconds) : viewOf(home, env.off)
	const whole =
		home.content.kind === 'change'
			? 'Show the whole change'
			: home.trail.length === 1
				? 'Show the whole project'
				: `Show all of ${esc(levelName(home))}`
	const clear =
		view.picked && !working ? `<button class="link" data-act="home-clear" data-key="home-clear">${whole}</button>` : ''
	const notices = working ? '' : `${endedHtml(home.ended)}${saidHtml(home.said, home.ui)}`
	const noModel = env.model?.kind === 'unset' ? noModelHtml(env.model, env.asked, true) : ''
	return `<div class="insp-scroll" id="insp-scroll">
			<p class="insp-head"><span class="insp-detail">${DETAILS[shownDetail(home)]}</span><span class="insp-where">${view.where}</span>${clear}</p>
			${notices}
			<h2 class="insp-title ${view.titleClass ?? ''}" id="insp-title" tabindex="-1">${view.title}</h2>
			${view.body}
			${noModel}
		</div>
		<div class="insp-foot">${working ? '' : (view.nav ?? '')}<p class="insp-legend">${LEGEND}</p></div>`
}
