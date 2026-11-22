// The inspector at "How it works" and "In the code": the whole reading path in order, numbered as the boxes of the
// picture are. For a level it is the stops of its tour, for a change the steps of its walkthrough. The stop or step
// the reader picked is open, with its cards and what the reader can do next, and the others show their title and, at
// "How it works", their words. So picking a box in the picture and picking a line here are the same act.
import { cardPaths, stepDiffHtml, stepTitle, stopTopics } from '../project/walk.js'
import { count, esc, prose, quoteBody, runButton } from '../views/format.js'
import { stepCardsHtml, storyHtml, wordsHtml } from '../views/reply.js'
import { colourOf, pathsLine } from './canvas.js'
import { firstUnseen, pathOf, placeOf, shownDetail, stoodOn } from './content.js'

// A boxed card of facts ken read from git. tag says how ken knows them.
export function factCard(title, tag, body) {
	return `<section class="fact-card"><h3 class="fact-head"><span>${title}</span><span class="fact-tag">${tag}</span></h3><div class="fact-body">${body}</div></section>`
}

// The arrows that start or end at a part, under the numbers the picture shows on them. A row opens the line of code
// its arrow rests on, and open shows them all.
export function usesHtml(home, name, open = false) {
	const { look } = home
	const colour = colourOf(home)
	const part = (each) => `<strong class="part-name ${colour(each)}">${esc(each)}</strong>`
	const rows = look.arrows.flatMap((arrow, i) => {
		if (arrow.from !== name && arrow.to !== name) return []
		const shown = open || home.openArrows.has(i)
		const quotes = shown
			? arrow.quotes
					.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, line ${quote.startLine}. `))
					.join('')
			: ''
		const stale = arrow.stale ? ' <span class="muted">Its part changed since, so it may be out of date.</span>' : ''
		return [
			`<li class="uses-item"><button class="uses-row" data-act="home-arrow" data-index="${i}" data-key="home-arrow-${i}" aria-expanded="${shown}"><span class="pv-num" aria-hidden="true">${i + 1}</span><span>${part(arrow.from)} ${esc(arrow.text)} ${part(arrow.to)}${stale}</span></button>${quotes}</li>`,
		]
	})
	const body =
		rows.length === 0
			? `<p>No arrow joins ${esc(name)} to another part here.</p>`
			: `<ul class="uses">${rows.join('')}</ul><p class="small muted">Each arrow rests on a line of code in the part it starts from. Pick one to see its line.</p>`
	return factCard('What it uses, and what uses it', 'Checked in git', body)
}

// What the reader's map says of a stop's part, and the button that says they know it.
function knowHtml(box, names) {
	const stood = stoodOn(box, names)
	if (stood === 'none')
		return '<span class="small muted">ken keeps no topic for this part, so your map cannot hold it.</span>'
	if (stood === 'known') return `<span class="small">Your map says you know ${esc(box.name)}.</span>`
	return '<button class="quiet-button" data-act="home-know" data-key="home-know">I know this part</button>'
}

const SEEN = { none: '', new: '', met: 'Seen', known: 'You know it' }

// The files a step changed, from the changed blocks its quotes fall on, each with its lines added and removed.
function stepFiles(step) {
	const files = new Map()
	for (const { path, hunk } of step.hunks) {
		const file = files.get(path) ?? { path, added: 0, removed: 0 }
		file.added += hunk.lines.filter((line) => line.startsWith('+')).length
		file.removed += hunk.lines.filter((line) => line.startsWith('-')).length
		files.set(path, file)
	}
	return [...files.values()]
}

function filesHtml(step) {
	const files = stepFiles(step)
	if (files.length === 0) {
		return '<p>No quote of this step falls on a changed line, so git cannot say which files it changed.</p>'
	}
	const rows = files.map(
		(file) =>
			`<li><code>${esc(file.path)}</code> <span class="home-plus">+${file.added}</span> <span class="home-minus">-${file.removed}</span></li>`,
	)
	return `<ul class="fact-list">${rows.join('')}</ul>`
}

// The file paths a step is about, for its line at "In the code".
function stepPaths(step) {
	const paths = [
		...new Set([...step.hunks.map((each) => each.path), ...step.cards.flatMap(({ card }) => cardPaths(card))]),
	]
	return paths.length === 0
		? '<span class="muted">This step quotes no file.</span>'
		: paths.map((path) => `<code class="pv-path">${esc(path)}</code>`).join(', ')
}

function stopHtml(step, k, on, ctx) {
	const { home, detail, q } = ctx
	const box = home.look.boxes.find((each) => each.name === step.part)
	const names = stopTopics(step)
	const stood = stoodOn(box, names)
	const text = step.text === null ? prose(box.job ?? '') : prose(step.text)
	const mark = SEEN[stood] === '' ? '' : `<span class="path-mark">${SEEN[stood]}</span>`
	const head = `<button class="path-head" data-act="home-step" data-index="${k}" data-key="home-step-${k}" aria-expanded="${on}">
			<span class="path-n">${k + 1}</span><span class="path-name part-name ${colourOf(home)(step.part)}">${esc(step.part)}</span>${mark}
		</button>`
	if (!on) {
		return `${head}<div class="path-body">${detail === 'how' ? `<p>${text}</p>` : `<p class="small">${pathsLine(box)}</p>`}</div>`
	}
	if (stood === 'known' && !home.unfolded.has(step.part)) {
		return `${head}<div class="path-body"><p class="insp-known">You said you know this part. Nothing in it changed since. <button class="link" data-act="home-unfold" data-name="${esc(step.part)}" data-key="home-unfold">Show it anyway</button></p></div>`
	}
	const inside = box.opens
		? `<button class="quiet-button" data-act="home-open" data-key="home-open">Look inside ${esc(step.part)}</button>`
		: ''
	if (detail === 'how') {
		return `${head}<div class="path-body">
				<p>${text}</p>
				${usesHtml(home, step.part)}
				<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">See its key lines</button>${inside}${knowHtml(box, names)}</p>
			</div>`
	}
	const cards =
		step.cards.length > 0
			? `<div class="path-cards">${stepCardsHtml(q, 'tour', step, home.ui)}</div>`
			: `<p class="small muted">${q ? "ken's model quoted no code at this stop." : "ken's model has not explained this part yet, so it has no quoted lines."}</p>`
	return `${head}<div class="path-body">
			<p class="small">${pathsLine(box)}</p>
			${cards}
			${usesHtml(home, step.part, true)}
			<p class="insp-actions">${inside}${knowHtml(box, names)}</p>
		</div>`
}

function stepHtml(step, k, on, ctx) {
	const { home, detail, q } = ctx
	const head = `<button class="path-head" data-act="home-step" data-index="${k}" data-key="home-step-${k}" aria-expanded="${on}">
			<span class="path-n">${k + 1}</span><span class="path-name">${esc(stepTitle(step))}</span>
		</button>`
	if (!on) {
		return `${head}<div class="path-body">${detail === 'how' ? `<p>${prose(step.text)}</p>` : `<p class="small">${stepPaths(step)}</p>`}</div>`
	}
	if (detail === 'how') {
		return `${head}<div class="path-body">
				<p>${prose(step.text)}</p>
				${factCard('Files in this step', 'From git', filesHtml(step))}
				<p class="insp-actions"><button class="quiet-button" data-act="detail" data-detail="code" data-key="to-code">See the diff for this step</button></p>
			</div>`
	}
	return `${head}<div class="path-body">
			<div class="path-diff">${stepDiffHtml(step, q.reply.change)}</div>
			<div class="path-cards">${stepCardsHtml(q, 'walk', step, home.ui)}</div>
		</div>`
}

// The words a reply says before its first step and after its last one.
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
		return `<div class="path-story">${storyHtml(q, 'story', home.ui)}<p><button class="link" data-act="home-story" data-key="home-story" aria-expanded="true">Fold the story</button></p></div>`
	}
	const first = q.reply.items
		.find((item) => item.kind === 'words')
		?.text.trim()
		.split(/\n\s*\n/)[0]
	if (!first) return ''
	return `<div class="path-story">${wordsHtml(first)}<p><button class="link" data-act="home-story" data-key="home-story" aria-expanded="false">Read the whole story</button></p></div>`
}

const WAY = { tour: ['stop', 'Stop'], walk: ['step', 'Step'] }

// Back and Next, each with the name of the stop or step it goes to. With nothing picked, one button starts the path,
// on a tour at the first stop the reader has not seen.
function navHtml(path, at, titles, start) {
	if (path.length === 0) return ''
	const button = (k, kind, way) =>
		`<button class="${kind} nav-button" data-act="home-step" data-index="${k}" data-key="home-nav-${way}"><span class="nav-way">${way}</span><span class="nav-name">${esc(titles[k])}</span></button>`
	if (at < 0) {
		return `<div class="insp-nav">${button(start.k, 'primary', start.k === 0 ? `Start at ${start.word} 1` : `Go on at ${start.word} ${start.k + 1}`)}</div>`
	}
	const back = at > 0 ? button(at - 1, 'quiet-button', `Back to ${start.word} ${at}`) : '<span></span>'
	const next = at < path.length - 1 ? button(at + 1, 'primary', `Next, ${start.word} ${at + 2}`) : '<span></span>'
	return `<div class="insp-nav">${back}${next}</div>`
}

// The two quiet questions under a change's story or walkthrough. Each is a question of its own in the thread.
export function asksHtml(off) {
	const chip = (kind, text) =>
		`<button class="chip" data-act="home-chip" data-chip="${kind}" data-key="chip-${kind}"${off ? ' disabled' : ''}>${text}</button>`
	return `<p class="insp-actions">${chip('decisions', 'Ask what it decided')}${chip('risks', 'Ask what could go wrong')}</p>`
}

// What the inspector shows at "How it works" and "In the code": where the reader is on the path, the path, and the
// buttons at its foot. off is the reason no run of ken's model can start now, or null.
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
	const here = look.at === look.head
	let lead
	if (stored && !q) lead = `<p class="muted">Reading what ken's model said.</p>`
	else if (q) lead = around.before
	else if (tour) {
		lead = here
			? `${runButton({ act: 'run-tour', key: 'run-tour', text: 'Ask ken to explain these parts', primary: true }, off)}
				<p class="small muted">Until then each part shows its job and its paths, as the picture does.</p>`
			: `<p class="small muted">ken's model reads the code that is checked out, so it cannot explain this older commit.</p>`
	} else {
		lead =
			look.change.files === 0
				? '<p class="muted">This change touched no file, so there is nothing to walk through.</p>'
				: `${runButton({ act: 'run-walk', key: 'run-walk', text: 'Ask ken to walk me through it', primary: true }, off)}
				<p class="small muted">ken's model orders the change into steps a reviewer can read one at a time, each with its diff.</p>`
	}
	const titles = path.map((step) => (tour ? step.part : stepTitle(step)))
	const start = { word, k: tour ? firstUnseen(look, path) : 0 }
	return {
		where:
			at >= 0
				? `${Word} ${at + 1} of ${path.length}`
				: path.length > 0
					? `${count(path.length, word, `${word}s`)}, in reading order`
					: 'Nothing is selected',
		picked: at >= 0,
		body: `${tour ? '' : storyLead(home)}
			${lead}
			${items.length > 0 ? `<ol class="path">${items.join('')}</ol>` : ''}
			${around.after}
			${!tour && q ? asksHtml(off) : ''}`,
		nav: navHtml(path, at, titles, start),
	}
}
