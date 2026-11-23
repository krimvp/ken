// One block of the canvas: a part as a big shape in its colour, with its icon, its name, its job in one line, and the
// mark for what ken thinks the reader knows of it. A press on the block opens its brief, and the corner goes inside
// it. A layer changes what the block says under its name, never where it stands. Nothing a block says rests on
// colour alone: a level is a mark and its words, a change is a count, and a block that steps back says why.
import { partId } from '../brief/concept-id.js'
import { KNOWN, levelLabel } from '../level/level-state.js'
import { icon, levelMark, partIcon } from '../shell/icons.js'
import { count, esc, prose } from '../views/format.js'

// A block is a file where git lists the level and the box holds that one file. A part ken's model named is a part,
// also when one file is all it holds.
// A box that is one file and nothing else.
const isFile = (box) => box.files === 1 && box.paths.length === 1 && box.paths[0].split('/').at(-1) === box.name

// At the commit checked out now, a named part says whether it changed since ken's model named it. At an older commit,
// every block says whether it was different then from now.
function stateLine(box, look) {
	if (box.state === 'gone') return '<span class="k-blk-state">Not there at this commit</span>'
	if (box.state !== 'changed') return ''
	const said = look.at === look.head ? "Changed since ken's model named these parts" : 'Different then from now'
	return `<span class="k-blk-state">${said}</span>`
}

export const isFileBlock = (box, look) => !look.named && isFile(box)

// The icon of a block: the part's own, or a file or a folder where nobody named the parts.
function iconOf(box, look) {
	if (look.named) return partIcon(box.name)
	return isFile(box) ? 'file' : 'folder'
}

const sinceBadge = (knows) =>
	knows.stale
		? `<span class="k-badge">${icon('changed')}<span class="k-num">${knows.since}</span><span class="visually-hidden"> ${knows.since === 1 ? 'commit' : 'commits'} since you looked</span></span>`
		: ''

function footHtml(box, { home, layer, stops }) {
	const { knows, touched } = box
	if (layer === 'changes') {
		if (!touched) return '<span class="k-blk-level"><span class="k-blk-words">No change</span></span>'
		return `<span class="k-blk-level">${icon('changed')}<b class="k-num">${touched.files}</b> <span class="k-blk-words">${touched.files === 1 ? 'file' : 'files'}</span></span><span class="k-blk-lines k-num"><span class="visually-hidden">lines added: </span>+${touched.added} <span class="visually-hidden">removed: </span>&minus;${touched.removed}</span>`
	}
	if (layer === 'processes' && stops.length === 0) {
		return '<span class="k-blk-level"><span class="k-blk-words">Not in this process</span></span>'
	}
	const mark = levelMark(knows.level, layer === 'know' ? 30 : 20)
	return `<span class="k-blk-level">${mark}<span class="k-blk-words">${esc(levelLabel(home, knows.level))}</span></span>${sinceBadge(knows)}`
}

// i is the block's place in the level, at where it stands, and view what the canvas shows: the home's state, the
// layer, the numbers of the block's stops in the process on show, the class of its colour and whether its brief is
// open.
export function blockHtml(box, i, at, view) {
	const { home, layer, stops, colour, picked } = view
	const { look } = home
	const file = isFileBlock(box, look)
	const quiet = (layer === 'changes' && !box.touched) || (layer === 'processes' && stops.length === 0)
	const classes = [
		'k-blk',
		colour,
		`knows-${box.knows.level}`,
		file ? 'is-file' : '',
		picked ? 'is-picked' : '',
		quiet ? 'is-quiet' : '',
		box.state === 'gone' ? 'is-gone' : '',
	]
	const beads =
		layer === 'processes'
			? `<span class="k-beads">${stops.map((n) => `<span class="k-bead k-num"><span class="visually-hidden">, step </span>${n}</span>`).join('')}</span>`
			: ''
	const job = look.named
		? prose(box.job ?? '')
		: file
			? `${box.lines ? `<b class="k-num">${count(box.lines, 'line', 'lines')}</b>. ` : ''}${box.told ? prose(box.told) : `<span class="k-mono">${esc(box.paths[0])}</span>`}`
			: `${count(box.files, 'file', 'files')} in ${esc(box.paths.slice(0, 2).join(', '))}${box.paths.length > 2 ? ` and ${box.paths.length - 2} more` : ''}`
	const state = stateLine(box, look)
	const known = KNOWN.indexOf(box.knows.level) / (KNOWN.length - 1)
	const inside = box.opens
		? `<button class="k-blk-in" data-act="arch-inside" data-index="${i}" data-key="blk-in-${i}" aria-label="Go inside ${esc(box.name)}" title="Go inside">${icon('inside')}</button>`
		: ''
	const id = partId(look.within, box.name)
	return `<div class="${classes.filter(Boolean).join(' ')}" style="left:${at.x}px;top:${at.y}px;width:${at.w}px;height:${at.h}px;--known:${known}" data-glide="part:${esc(box.name)}">
		<button class="k-blk-face" data-act="arch-pick" data-index="${i}" data-concept="${esc(id)}" data-key="blk-${i}" aria-pressed="${picked}">
			<span class="k-blk-head"><span class="k-blk-icon">${icon(iconOf(box, look))}</span><span class="k-blk-name${file ? ' k-mono' : ''}">${esc(box.name)}</span></span>
			${beads}
			<span class="k-blk-job">${job}</span>
			${state}
			<span class="k-blk-foot">${footHtml(box, view)}</span>
		</button>
		${inside}
	</div>`
}

// A block shows as many whole lines of its job as it has room for under its name, and none when it has no room for
// one: a long name takes two or three lines of its own. Called after the canvas is drawn.
export function fitJobs(root) {
	for (const face of root.querySelectorAll('.k-blk-face')) {
		const job = face.querySelector('.k-blk-job')
		const others = [...face.children].filter((each) => each !== job && each.offsetHeight > 0)
		const style = getComputedStyle(face)
		const used =
			others.reduce((sum, each) => sum + each.offsetHeight, 0) + Number.parseFloat(style.rowGap) * others.length
		const free = face.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom) - used
		const lines = Math.min(3, Math.floor(free / Number.parseFloat(getComputedStyle(job).lineHeight)))
		job.style.setProperty('--lines', String(Math.max(lines, 1)))
		job.classList.toggle('is-out', lines < 1)
	}
}
