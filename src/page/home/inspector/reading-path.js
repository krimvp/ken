// The panel at "How it works" and "In the code": the whole reading path in order, numbered as the boxes of the
// picture are. For a level it is the stops of its tour, for a change the steps of its walkthrough. The stop or step
// the reader picked is open, with its cards and what the reader can do next, and the others show their title and, at
// "How it works", their words. So picking a box in the picture and picking a line here are the same act. A drawn
// picture has a path too: the boxes and arrows of its diagram, under the numbers the drawing shows.

import { diagramPath, firstUnseen, pathOf, placeOf, shownDetail, stepFiles } from '../../level/content.js'
import { colourOf, levelLabel } from '../../level/level-state.js'
import { cardPaths, cardQuotes, stepDiffHtml, stepWords } from '../../project/walk.js'
import { count, esc, isSession, label, pathList, prose, quoteBody, RUN_COST, runButton } from '../../views/format.js'
import { stepCardsHtml, storyHtml, wordsHtml } from '../../views/reply.js'
import { arrowListHtml } from '../canvas/arrow-list.js'
import { pathsLine, plusMinus } from '../canvas/part-box.js'

// The two tags a boxed card can carry. Plain code read the facts of the first from git. The second holds words of
// ken's model, each resting on quoted lines that ken found in git.
export const FROM_GIT = 'From git'
export const QUOTES_FOUND = 'Quotes found in git'

// A boxed card. tag says how ken knows what is in it, and level is the level of its heading in the panel.
export function factCard(title, tag, body, level = 3) {
	return `<section class="fact-card"><h${level} class="fact-head"><span>${title}</span><span class="fact-tag">${tag}</span></h${level}><div class="fact-body">${body}</div></section>`
}

// The arrows that start or end at a part, or every arrow of the level when name is null, as a card. The verbs are
// the model's, and each rests on a line of code ken found. open shows every arrow's line.
export function usesHtml(home, name, { open = false, level = 3 } = {}) {
	const rows = arrowListHtml(home, name, { open, where: 'insp' })
	const body =
		rows === ''
			? `<p>No arrow joins ${esc(name)} to another part here.</p>`
			: `${rows}<p class="small muted">Each arrow rests on a line of code in the part it starts from. Pick one to see its line.</p>`
	return factCard(
		name === null ? 'How the parts use each other' : 'What it uses, and what uses it',
		QUOTES_FOUND,
		body,
		level,
	)
}

// The way into a part's own level, for a part that has one. Its second line says what is inside before the reader
// goes there: the parts ken's model named, or the files as git lists them.
export function lookInside(box) {
	if (!box.opens) return ''
	const inside =
		box.inside === null
			? `${count(box.files, 'file', 'files')}, as git lists them. ken's model has not named the parts inside.`
			: `${count(box.inside, 'part', 'parts')}, named by ken's model.`
	return `<button class="quiet-button look-inside" data-act="home-open" data-key="home-open"><span class="look-name">Look inside ${esc(box.name)}</span><span class="look-says">${inside}</span></button>`
}

// A part the reader said they know, with no commit there since, shows one line in place of its words.
export function isKnown(box) {
	return box.knows.level === 'said' && !box.knows.stale
}

export function knownFold(name) {
	return `<p class="insp-known">You said you know this part. Nothing in it changed since. <button class="link" data-act="home-unfold" data-name="${esc(name)}" data-key="home-unfold">Show it anyway</button></p>`
}

// The button that says the reader knows a stop's part, or the line that says they said so.
function knowHtml(box) {
	if (box.knows.level === 'said') return `<span class="small">You said you know ${esc(box.name)}.</span>`
	return '<button class="quiet-button" data-act="home-know" data-key="home-know">I know this part</button>'
}

export function filesHtml(files, more = 0) {
	const rows = files.map((file) => `<li><code>${esc(file.path)}</code> ${plusMinus(file)}</li>`)
	const rest = more > 0 ? `<li>and ${count(more, 'more file', 'more files')}</li>` : ''
	return `<ul class="fact-list">${rows.join('')}${rest}</ul>`
}

function stepPaths(step) {
	const paths = [
		...new Set([...step.hunks.map((each) => each.path), ...step.cards.flatMap(({ card }) => cardPaths(card))]),
	]
	return paths.length === 0 ? '<span class="muted">This step quotes no file.</span>' : pathList(paths)
}

// The line of a stop or a step in the path: its number, its title, and a mark. It is a heading and a button, so a
// reader who moves with the arrow keys lands on it and hears where they are.
function headHtml(k, on, number, title, mark = '') {
	return `<h3 class="path-title"><button class="path-head" data-act="home-step" data-index="${k}" data-key="home-step-${k}" aria-expanded="${on}">
			<span class="path-n">${number}</span>${title}${mark}
		</button></h3>`
}

// The cards of a stop without a topic card that only quotes lines a card before it shows already.
function cardsOnce(step) {
	const shown = []
	const repeats = (quote) =>
		shown.some(
			(each) =>
				!isSession(quote) &&
				each.path === quote.path &&
				each.startLine <= quote.startLine &&
				each.endLine >= quote.endLine,
		)
	const cards = step.cards.filter(({ card }) => {
		const quotes = cardQuotes(card)
		const again = card.kind === 'topic' && quotes.every(repeats)
		shown.push(...quotes.filter((quote) => !isSession(quote)))
		return !again
	})
	return { ...step, cards }
}

function stopHtml(step, k, on, ctx) {
	const { home, detail, q } = ctx
	const box = home.look.boxes.find((each) => each.name === step.part)
	const text = step.text === null ? prose(box.job ?? '') : prose(step.text)
	const head = headHtml(
		k,
		on,
		k + 1,
		`<span class="path-name part-name ${colourOf(home)(step.part)}">${esc(step.part)}</span>`,
		box.knows.level === 'new' ? '' : `<span class="path-mark">${esc(levelLabel(home, box.knows.level))}</span>`,
	)
	if (!on) {
		return `${head}<div class="path-body">${detail === 'how' ? `<p>${text}</p>` : `<p class="small">${pathsLine(box)}</p>`}</div>`
	}
	if (isKnown(box) && !home.unfolded.has(step.part))
		return `${head}<div class="path-body">${knownFold(step.part)}</div>`
	if (detail === 'how') {
		return `${head}<div class="path-body">
				<p>${text}</p>
				${usesHtml(home, step.part, { level: 4 })}
				<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">Show its code</button>${lookInside(box)}${knowHtml(box)}</p>
			</div>`
	}
	const cards =
		step.cards.length > 0
			? `<div class="path-cards">${stepCardsHtml(q, 'tour', cardsOnce(step), home.ui)}</div>`
			: `<p class="small muted">${q ? "ken's model quoted no code at this stop." : "ken's model has not explained this part yet, so it has no quoted lines."}</p>`
	return `${head}<div class="path-body">
			<p class="small">${pathsLine(box)}</p>
			${cards}
			${usesHtml(home, step.part, { open: true, level: 4 })}
			<p class="insp-actions">${lookInside(box)}${knowHtml(box)}</p>
		</div>`
}

// Whether a step's diff shows the lines of a quote: the quote names a file of one of its changed blocks, and its
// lines fall in the block as it was before the change or as it is after.
function inDiff(step) {
	return (quote) =>
		!isSession(quote) &&
		step.hunks.some(({ path, oldPath, hunk }) => {
			const within = (start, length) => quote.startLine < start + length && quote.endLine >= start
			return (
				(quote.path === path && within(hunk.newStart, hunk.newLength)) ||
				(quote.path === oldPath && within(hunk.oldStart, hunk.oldLength))
			)
		})
}

function stepHtml(step, k, on, ctx) {
	const { home, detail, q } = ctx
	const { title, body } = stepWords(step)
	const head = headHtml(k, on, k + 1, `<span class="path-name">${prose(title)}</span>`)
	const words = body === '' ? '' : `<p>${prose(body)}</p>`
	if (!on) {
		return `${head}<div class="path-body">${detail === 'how' ? words : `<p class="small">${stepPaths(step)}</p>`}</div>`
	}
	if (detail === 'how') {
		const files = stepFiles(step)
		const changed =
			files.length === 0
				? '<p>No quote of this step falls on a changed line, so git cannot say which files it changed.</p>'
				: filesHtml(files)
		return `${head}<div class="path-body">
				${words}
				${factCard('Files in this step', FROM_GIT, changed, 4)}
				<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">See the diff for this step</button></p>
			</div>`
	}
	// The diff comes first: it is what the reader came to this detail for. A card under it keeps the lines the diff
	// already shows behind one button.
	return `${head}<div class="path-body">
			<div class="path-diff">${stepDiffHtml(step, q.reply.change)}</div>
			<div class="path-cards">${stepCardsHtml(q, 'walk', step, home.ui, inDiff(step))}</div>
		</div>`
}

function wordsAround(reply) {
	const first = reply.items.findIndex((item) => item.kind === 'step')
	const last = reply.items.findLastIndex((item) => item.kind === 'step')
	const words = (items) =>
		items
			.filter((item) => item.kind === 'words')
			.map((item) => wordsHtml(item.text))
			.join('')
	return { before: words(reply.items.slice(0, first)), after: words(reply.items.slice(last + 1)) }
}

// The story of a change opens its reading path: its first paragraph, and the rest behind one line.
function storyLead(home) {
	const q = home.content.story?.q
	if (!q) return ''
	if (home.storyOpen) {
		return `<div class="path-story">${storyHtml(q, 'story', home.ui)}<p><button class="link" data-act="home-story" data-key="home-story" aria-expanded="true">Hide the rest of the story</button></p></div>`
	}
	const text = q.reply.items.find((item) => item.kind === 'words')?.text.trim() ?? ''
	const [first] = text.split(/\n\s*\n/)
	if (!first) return ''
	const more = first !== text || q.reply.items.some((item) => item.kind === 'card' && item.step === undefined)
	return `<div class="path-story">${wordsHtml(first)}${more ? '<p><button class="link" data-act="home-story" data-key="home-story" aria-expanded="false">Read the whole story</button></p>' : ''}</div>`
}

// What a walkthrough leaves out, from the check ken ran on it: how many of the change's blocks its steps quote, and
// the files of the ones they do not.
function leftOutHtml(change) {
	const total = change.covered.length + change.uncovered.length
	if (total === 0) return ''
	const said = `The steps quote ${change.covered.length} of ${count(total, 'changed block', 'changed blocks')}.`
	if (change.uncovered.length === 0) return `<p class="small">${said}</p>`
	const files = new Map()
	for (const { path } of change.uncovered) files.set(path, (files.get(path) ?? 0) + 1)
	const rows = [...files].map(
		([path, blocks]) => `<li><code>${esc(path)}</code>, ${count(blocks, 'block', 'blocks')}</li>`,
	)
	return `<details class="insp-more" data-key="left-out"><summary>${said} The rest are in ${count(files.size, 'file', 'files')}.</summary><ul class="fact-list">${rows.join('')}</ul></details>`
}

export function outsideHtml(look) {
	const { outside } = look.change
	if (outside.length === 0) return ''
	const noun = look.named ? 'part' : 'box'
	return `<p class="small">${count(outside.length, 'changed file is', 'changed files are')} in no ${noun}: ${pathList(outside)}.</p>`
}

const WAY = { tour: ['stop', 'Stop'], walk: ['step', 'Step'] }

// Back and Next, each with the name of what it goes to, and one line on the keys that do the same. With nothing
// picked, one button starts the path, on a tour at the first stop the reader has not seen. The last stop has an end:
// it says so, and goes back to the big picture.
function navHtml(path, at, titles, start) {
	if (path.length === 0) return ''
	const button = (k, kind, way) =>
		`<button class="${kind} nav-button" data-act="home-step" data-index="${k}" data-key="home-nav-${way}"><span class="nav-way">${way}</span><span class="nav-name">${titles[k]}</span></button>`
	const number = (k) => path[k].number ?? k + 1
	const keys = `<p class="insp-keys small muted">The arrow keys move between ${start.word}s.</p>`
	if (at < 0) {
		const first = number(start.k) === number(0)
		return `<div class="insp-nav">${button(start.k, 'primary', first ? `Start at ${start.word} ${number(0)}` : `Go on at ${start.word} ${number(start.k)}`)}</div>${keys}`
	}
	const back = at > 0 ? button(at - 1, 'quiet-button', `Back to ${start.word} ${number(at - 1)}`) : '<span></span>'
	const next =
		at < path.length - 1
			? button(at + 1, 'primary', `Next, ${start.word} ${number(at + 1)}`)
			: `<button class="primary nav-button" data-act="home-done" data-key="home-nav-done"><span class="nav-way">That was the last ${start.word}.</span><span class="nav-name">Back to the big picture</span></button>`
	return `<div class="insp-nav">${back}${next}</div>${keys}`
}

function sourcesHtml(element) {
	if (element.quotes.length === 0) return `<p class="small muted">ken's model quoted no code for this one.</p>`
	const places = element.quotes.map(
		(quote) => `<code class="pv-path">${esc(quote.path)}</code>, line ${quote.startLine}`,
	)
	return `<p class="small">It rests on ${places.join(', and on ')}.</p>
		<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">Show its code</button></p>`
}

// One box or arrow of a drawn picture. At "In the code" every one shows the lines it quotes, as ken read them.
function elementHtml(element, k, on, { detail, diagram }) {
	const own = element.label !== null && element.label !== diagram.label ? label(element.label) : ''
	const head = headHtml(k, on, element.number, `<span class="path-name">${own}${prose(element.text)}</span>`)
	if (detail === 'how') return on ? `${head}<div class="path-body">${sourcesHtml(element)}</div>` : head
	const lines =
		element.quotes.length === 0
			? `<p class="small muted">ken's model quoted no code for this one.</p>`
			: element.quotes
					.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, line ${quote.startLine}. `))
					.join('')
	return `${head}<div class="path-body uses-item">${lines}</div>`
}

// The box or arrow the reader picked in the drawing, as its line of the path at "How it works": the panel shows it
// over ken's words at "Big picture". With none picked it is empty.
export function pickedElementHtml(home, diagram) {
	const path = diagramPath(diagram)
	const k = placeOf(path, home.selected)
	if (k < 0) return ''
	return `<ol class="path"><li class="path-step is-on">${elementHtml(path[k], k, true, { detail: 'how', diagram })}</li></ol>`
}

// What the two lists of a drawn picture are called, by the kind of its diagram, and what one of each is called: its
// boxes, then its arrows.
const LISTS = {
	sequence: [
		['Who takes part', 'participant'],
		['What happens, in order', 'message'],
	],
	component: [
		['The pieces', 'piece'],
		['How one uses another', 'arrow'],
	],
	'entity-relationship': [
		['The data', 'record'],
		['How it relates', 'relation'],
	],
}

// What one numbered element of a drawn picture is called: "message" for an arrow of a sequence.
export function elementNoun(diagram, element) {
	const [[, box], [, arrow]] = LISTS[diagram.kind]
	return element.label === null ? box : arrow
}

// What the panel shows of a drawn picture at "How it works" and "In the code": its boxes, then its arrows, in the
// order of their numbers, the one the reader picked open. The participants of a sequence carry no number, so they are
// one line of names over its messages.
export function elementsView(home, diagram) {
	const path = diagramPath(diagram)
	const named = diagram.elements.filter((element) => !element.numbered)
	const at = placeOf(path, home.selected)
	const detail = shownDetail(home)
	const ctx = { detail, diagram }
	const items = path.map(
		(element, k) =>
			`<li class="path-step${k === at ? ' is-on' : ''}" id="path-${k}">${elementHtml(element, k, k === at, ctx)}</li>`,
	)
	// ken numbers the boxes first, so the arrows start where the boxes end.
	const boxes = path.filter((element) => element.label === null).length
	const [[names], [arrows, arrow]] = LISTS[diagram.kind]
	const listed = (title, rows, kind = '') =>
		rows.length === 0 ? '' : `<h3 class="insp-sub">${title}</h3><ol class="path${kind}">${rows.join('')}</ol>`
	const who =
		named.length === 0
			? ''
			: `<h3 class="insp-sub">${names}</h3><p>${named.map((element) => prose(element.text)).join(', ')}.</p>`
	// Back and Next name what they go to by its own noun: "Back to message 8".
	const nav = ['Back', 'Next'].map((way, side) => {
		const k = at + (side === 0 ? -1 : 1)
		if (at < 0 || !path[k]) return '<span></span>'
		const said = `${way}${side === 0 ? ' to' : ','} ${elementNoun(diagram, path[k])} ${path[k].number}`
		return `<button class="${side === 0 ? 'quiet-button' : 'primary'} nav-button" data-act="home-step" data-index="${k}" data-key="home-nav-${way}"><span class="nav-way">${said}</span><span class="nav-name">${prose(path[k].text)}</span></button>`
	})
	const start = `<button class="primary nav-button" data-act="home-step" data-index="0" data-key="home-nav-start"><span class="nav-way">Start at number 1</span><span class="nav-name">${prose(path[0]?.text ?? '')}</span></button>`
	const counted = named.length > 0 ? count(path.length, arrow, `${arrow}s`) : `${path.length} boxes and arrows`
	return {
		where:
			at >= 0
				? `${elementNoun(diagram, path[at]).replace(/^./, (c) => c.toUpperCase())} ${path[at].number}`
				: `${counted}, numbered as in the drawing`,
		picked: at >= 0,
		body: `${who}${listed(names, items.slice(0, boxes), detail === 'how' ? ' is-names' : '')}${listed(arrows, items.slice(boxes))}`,
		nav:
			path.length === 0
				? ''
				: `<div class="insp-nav">${at < 0 ? start : nav.join('')}</div><p class="insp-keys small muted">The arrow keys move between the numbers.</p>`,
	}
}

// The two quiet questions under a change's story or walkthrough. Each is a question of its own, answered in a thread.
export function asksHtml(off) {
	const chip = (kind, text) =>
		`<button class="chip" data-act="home-chip" data-chip="${kind}" data-key="chip-${kind}"${off ? ' disabled' : ''}>${text}</button>`
	return `<p class="insp-actions">${chip('decisions', 'Ask what it decided')}${chip('risks', 'Ask what could go wrong')}<span class="small muted">${off ? esc(off) : `Each is ${RUN_COST.replace(/^One/, 'one')}`}</span></p>`
}

// The reading path of a named level or of a change with a walkthrough: where the reader is on it, the path, and the
// buttons at its foot. A level with no tour yet shows each part's job in place of the tour's words. off is the reason
// no run of ken's model can start now, or null.
export function pathView(home, off) {
	const { look, content } = home
	const detail = shownDetail(home)
	const path = pathOf(look, content)
	const at = placeOf(path, home.selected)
	const tour = content.kind === 'level'
	const [word, Word] = WAY[tour ? 'tour' : 'walk']
	const stored = tour ? content.tour : content.walk
	const q = stored?.q ?? null
	const ctx = { home, detail, q }
	const items = path.map(
		(step, k) =>
			`<li class="path-step${k === at ? ' is-on' : ''}" id="path-${k}">${(tour ? stopHtml : stepHtml)(step, k, k === at, ctx)}</li>`,
	)
	const around = q ? wordsAround(q.reply) : { before: '', after: '' }
	let lead = around.before
	if (tour && !stored) {
		lead =
			look.at === look.head
				? `${runButton({ act: 'run-explain', key: 'run-explain', text: 'Ask ken to explain these parts', primary: true }, off)}
					<p class="small muted">Until then each part shows its job and its paths, as the picture does.</p>`
				: `<p class="small muted">ken's model reads the code that is checked out, so it cannot explain this older commit.</p>`
	}
	const titles = path.map((step) => (tour ? esc(step.part) : prose(stepWords(step).title)))
	const start = { word, k: tour ? firstUnseen(look, path) : 0 }
	return {
		where:
			at >= 0 ? `${Word} ${at + 1} of ${path.length}` : `${count(path.length, word, `${word}s`)}, in reading order`,
		picked: at >= 0,
		body: `${tour ? '' : storyLead(home)}
			${lead}
			<ol class="path">${items.join('')}</ol>
			${around.after}
			${!tour && q ? `${leftOutHtml(q.reply.change)}${outsideHtml(look)}${asksHtml(off)}` : ''}
			${tour && at < 0 && look.arrows.length > 0 ? `<div class="insp-arrows">${usesHtml(home, null)}</div>` : ''}`,
		nav: navHtml(path, at, titles, start),
	}
}
