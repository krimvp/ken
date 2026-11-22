import { kenHome } from '../history/index.ts'
import {
	type LayoutLook,
	type LayoutSources,
	type LookBox,
	lookAtLayout,
	type RawAsk,
	readLayoutAsk,
} from '../layout/index.ts'
import { openSnapshots } from '../live/index.ts'
import { openMap, openSeen } from '../map/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'

// "ken layout" prints one level of the project's layout with no model. Exit code 0 means it printed, 2 means no
// repository, no commits, or an ask ken refused.
export async function printLayout(directory: string, raw: RawAsk, json: boolean): Promise<number> {
	const opened = await layoutSources(directory)
	if (opened.kind !== 'ok') return refuse(opened.message)
	const { sources } = opened
	const read = await readLayoutAsk(sources, raw, new Date())
	if (read.kind !== 'ok') return refuse(read.message)
	const look = await lookAtLayout(sources, read.ask, new Date())
	process.stdout.write(json ? `${JSON.stringify(look, null, 2)}\n` : layoutText(look))
	return 0
}

// What the layout reads for the project in this directory: its git, the record, and the reader's own files.
export async function layoutSources(
	directory: string,
): Promise<{ kind: 'ok'; sources: LayoutSources } | { kind: 'refused'; message: string }> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') return { kind: 'refused', message: `${directory} is not inside a git repository.` }
	const { root } = found
	const project = gitRepository(root)
	const none = { kind: 'refused', message: `${root} has no commits yet.` } as const
	if ((await project.firstCommit()) === null) return none
	const home = kenHome(process.env)
	const snapshots = await openSnapshots(home, project, root)
	const repo = gitRepository(root, { alternate: snapshots.objects })
	const record = fileRecordStore(root, repo)
	const [map, seen] = await Promise.all([openMap(home, repo, record), openSeen(home, repo)])
	if (map.kind !== 'ok' || seen.kind !== 'ok') return none
	return { kind: 'ok', sources: { root, repo, snapshots, record, map: map.map, seen: seen.seen } }
}

function refuse(message: string): number {
	process.stderr.write(`${message}\n`)
	return 2
}

// At HEAD a named part is compared with the commit it was named at. At an older commit every box is compared with HEAD.
const STATES: Record<LookBox['state'], [string | null, string | null]> = {
	same: [null, null],
	changed: ['changed since it was named', 'different then from now'],
	gone: ['not there at this commit', 'not there at this commit'],
}

function layoutText(look: LayoutLook): string {
	const where = look.within.length === 0 ? 'the whole project' : `inside ${list(look.within)}`
	const at =
		look.at === look.head
			? `${short(look.at)} (HEAD)`
			: look.named
				? short(look.at)
				: `${short(look.at)}, in the folders of HEAD (${short(look.head)})`
	const change = look.change && `Change: ${look.change.name}, ${count(look.change.files, 'file')} changed.`
	const changed = look.boxes.filter((box) => box.state !== 'same').map((box) => box.name)
	const stale =
		look.named?.stale && look.at === look.head && changed.length > 0
			? ` Since then ${changed.join(', ')} changed, so the arrows from ${changed.length === 1 ? 'it' : 'them'} may be out of date.`
			: ''
	const by = look.named
		? `Parts named by ken's model at ${short(look.named.drawnAt)}.${stale}`
		: "Split by folder. ken's model has not named these parts."
	const lines = [`At ${at}, ${where}.`, by, ...(change ? [change] : []), look.next.line, '']
	for (const box of look.boxes) {
		const [only] = box.paths
		const named =
			box.paths.length === 1 && only?.split('/').at(-1) === box.name ? only : `${box.name} (${box.paths.join(', ')})`
		lines.push(`  ${named}, ${count(box.files, 'file')}`)
		if (box.job) lines.push(`    ${box.job}`)
		const state = STATES[box.state][look.at === look.head ? 0 : 1]
		if (state) lines.push(`    ${state}`)
		if (box.touched) {
			const { files, added, removed } = box.touched
			lines.push(`    the change: ${count(files, 'file')}, ${count(added, 'line')} added, ${removed} removed`)
		}
		const topics = box.topics.length === 0 ? '' : ` Topics: ${box.topics.map((topic) => topic.topic).join(', ')}.`
		if (box.map.line !== '') lines.push(`    ${box.map.line}${topics}`)
	}
	if (look.arrows.length > 0) lines.push('', 'How the parts use each other, each from a quoted line:')
	for (const arrow of look.arrows) {
		const quote = arrow.quotes[0]
		const where = quote ? ` (${quote.path}:${quote.startLine})` : ''
		lines.push(`  ${arrow.from} ${arrow.text} ${arrow.to}${where}`)
	}
	lines.push('')
	const added = look.named?.added ?? []
	if (added.length > 0) lines.push(`${list(added)} ${added.length === 1 ? 'is' : 'are'} new and in no part.`)
	const left = look.loose.filter((entry) => !added.includes(entry))
	if (left.length > 0) lines.push(`Also at this commit, in no box: ${list(left)}.`)
	if (look.change && look.change.outside.length > 0)
		lines.push(`Changed outside these boxes: ${list(look.change.outside)}.`)
	if (look.boxes.some((box) => box.opens)) lines.push('Open a box with --within and each of its paths.')
	return `${lines.join('\n')}\n`
}

function list(paths: string[]): string {
	const shown = paths.slice(0, 4).join(', ')
	return paths.length > 4 ? `${shown} and ${paths.length - 4} more` : shown
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function short(hash: string): string {
	return hash.slice(0, 7)
}
