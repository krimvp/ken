import { kenHome } from '../history/index.ts'
import { type LayoutLook, type LookBox, lookAtLayout, type Mark, type RawAsk, readLayoutAsk } from '../layout/index.ts'
import { openSnapshots } from '../live/index.ts'
import { openMap } from '../map/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'

// "ken layout" prints one level of the project's layout with no model. Exit code 0 means it printed, 2 means no
// repository, no commits, or an ask ken refused.
export async function printLayout(directory: string, raw: RawAsk, json: boolean): Promise<number> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') return refuse(`${directory} is not inside a git repository.`)
	const { root } = found
	const project = gitRepository(root)
	if ((await project.firstCommit()) === null) return refuse(`${root} has no commits yet.`)
	const home = kenHome(process.env)
	const snapshots = await openSnapshots(home, project, root)
	const repo = gitRepository(root, { alternate: snapshots.objects })
	const record = fileRecordStore(root, repo)
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') return refuse(`${root} has no commits yet.`)
	const sources = { root, repo, snapshots, record, map: opened.map }
	const read = await readLayoutAsk(sources, raw)
	if (read.kind !== 'ok') return refuse(read.message)
	const look = await lookAtLayout(sources, read.ask, new Date())
	process.stdout.write(json ? `${JSON.stringify(look, null, 2)}\n` : layoutText(look))
	return 0
}

function refuse(message: string): number {
	process.stderr.write(`${message}\n`)
	return 2
}

// A folder is compared with HEAD, a part ken's model named with the commit it was named at.
const STATES: Record<LookBox['state'], [string | null, string | null]> = {
	same: [null, null],
	changed: ['different at this commit', 'changed since it was named'],
	gone: ['not there at this commit', 'not there at this commit'],
}

const MARKS: Record<Mark, string> = {
	changed: 'you said you understood it, and its code changed since',
	new: 'you have not asked about it yet',
	met: 'you asked about it, and have not said you understand it',
	understood: 'you said you understand it',
}

function layoutText(look: LayoutLook): string {
	const where = look.within.length === 0 ? 'the whole project' : `inside ${list(look.within)}`
	const at =
		look.at === look.head
			? `${short(look.at)} (HEAD)`
			: `${short(look.at)}, in the folders of HEAD (${short(look.head)})`
	const change = look.change && `Change: ${look.change.name}, ${count(look.change.files, 'file')} changed.`
	const by = look.named
		? `Parts named by ken's model at ${short(look.named.drawnAt)}.`
		: "Split by folder. ken's model has not named these parts."
	const lines = [`At ${at}, ${where}.`, by, ...(change ? [change] : []), look.next.line, '']
	for (const box of look.boxes) {
		const [only] = box.paths
		const named =
			box.paths.length === 1 && only?.split('/').at(-1) === box.name ? only : `${box.name} (${box.paths.join(', ')})`
		lines.push(`  ${named}, ${count(box.files, 'file')}`)
		if (box.job) lines.push(`    ${box.job}`)
		const state = STATES[box.state][look.named ? 1 : 0]
		if (state) lines.push(`    ${state}`)
		if (box.touched) {
			const { files, added, removed } = box.touched
			lines.push(`    the change: ${count(files, 'file')}, ${count(added, 'line')} added, ${removed} removed`)
		}
		const marks = (Object.keys(MARKS) as Mark[]).flatMap((mark) => {
			const topics = box.topics.filter((topic) => topic.mark === mark).map((topic) => topic.topic)
			return topics.length === 0 ? [] : [`${MARKS[mark]}: ${topics.join(', ')}`]
		})
		if (marks.length > 0) lines.push(`    your map: ${marks.join('; ')}`)
	}
	if (look.arrows.length > 0) lines.push('', 'How the parts use each other, each from a quoted line:')
	for (const arrow of look.arrows) {
		const quote = arrow.quotes[0]
		const where = quote ? ` (${quote.path}:${quote.startLine})` : ''
		lines.push(`  ${arrow.from} ${arrow.text} ${arrow.to}${where}${arrow.stale ? ', may be out of date' : ''}`)
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
