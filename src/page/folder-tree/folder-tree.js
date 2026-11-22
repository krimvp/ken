// A level of folders and files, before ken's model has named its parts. Folders are not parts, so they are drawn as
// git keeps them: an indented tree, each row with a bar for its lines, its files, how busy it was lately, and what ken
// thinks the reader knows of it. The arrow opens a folder in place, and the name opens its brief.
import { partId } from '../brief/concept-id.js'
import { levelLabel } from '../level/level-state.js'
import { icon, levelMark } from '../shell/icons.js'
import { count, esc } from '../views/format.js'

// What the tree holds of its own: the folders the reader opened, by their paths joined, each { kind: 'reading' },
// { kind: 'ok', boxes } or { kind: 'failed', message }.
export const freshTree = () => new Map()

const treeKey = (paths) => paths.join(',')

function rowHtml(box, within, depth, view) {
	const { home, tree, brief, most } = view
	const key = treeKey(box.paths)
	const id = partId(within, box.name)
	const open = tree.get(key)
	const twist = box.opens
		? `<button class="k-tree-twist" data-act="tree-open" data-paths="${esc(key)}" data-key="tree-${esc(key)}" aria-expanded="${Boolean(open)}" aria-label="${open ? 'Close' : 'Open'} ${esc(box.name)} here">${icon('chevron')}</button>`
		: '<span class="k-tree-twist" aria-hidden="true"></span>'
	const lines = box.size?.lines ?? 0
	const recent = box.size?.commits
		? `<span class="k-tree-recent">${count(box.size.commits, 'commit', 'commits')} lately</span>`
		: '<span class="k-tree-recent"></span>'
	const files = box.opens ? `${count(box.files, 'file', 'files')}, ` : ''
	const row = `<div class="k-tree-row" style="--depth:${depth}">${twist}
		<button class="k-tree-name" data-act="brief-open" data-concept="${esc(id)}" data-key="tree-brief-${esc(key)}" aria-pressed="${brief === id}">${icon(box.opens ? 'folder' : 'file')}<span class="k-tree-label">${esc(box.name)}</span></button>
		<span class="k-size-bar" style="--size:${Math.round((lines / most) * 100)}%" aria-hidden="true"></span>
		<span class="k-tree-size k-num">${files}${count(lines, 'line', 'lines')}</span>${recent}
		<span class="k-tree-knows">${levelMark(box.knows.level, 16)}<span class="k-tree-level">${esc(levelLabel(home, box.knows.level))}</span></span></div>`
	return `<li>${row}${open ? insideHtml(open, box.paths, depth + 1, view) : ''}</li>`
}

function insideHtml(open, within, depth, view) {
	if (open.kind === 'reading') {
		return `<p class="k-tree-note" style="--depth:${depth}" role="status">Reading the folder from git.</p>`
	}
	if (open.kind === 'failed') {
		return `<p class="k-tree-note" style="--depth:${depth}" role="alert">ken could not open it. ${esc(open.message)}</p>`
	}
	return `<ul class="k-tree">${open.boxes.map((box) => rowHtml(box, within, depth, view)).join('')}</ul>`
}

// view is { home, tree, brief, crumb, said }: the level, the folders open in it, the id of the open brief, the
// breadcrumb, and what ken says over the tree: the run of its model, or the way to start one.
export function folderTreeHtml({ home, tree, brief, crumb, said }) {
	const { look } = home
	const most = Math.max(1, ...look.boxes.map((box) => box.size?.lines ?? 0))
	const rows = look.boxes.map((box) => rowHtml(box, look.within, 0, { home, tree, brief, most }))
	return `<div class="k-tree-page${brief ? ' has-brief' : ''}" id="arch-tree">
		<header class="k-tree-head">${crumb}
			<h2>Folders and files, as git keeps them</h2>
			<p class="k-tree-why">ken's model has not named the main parts here yet, so these are not parts. Press a name for its brief, or the arrow to open a folder here.</p>
			${said}
		</header>
		<ul class="k-tree is-top" aria-label="Folders and files">${rows.join('')}</ul>
	</div>`
}
