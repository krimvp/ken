// The change the reader has not reviewed yet, for the list of what to look at next: their uncommitted work, else the
// branch they are on against the main branch, else the newest merge on the main line when they have not walked
// through it.
import type { SeenLine } from '../../map/index.ts'
import type { CommitHash, FileDiff, Repository } from '../../repo/index.ts'
import { under } from '../folder-split.ts'
import type { Change } from '../layout-look.ts'
import type { ToReview } from './next-items.ts'

// The main line is read this far back for its newest merge, as the layout's own choice of changes reads it.
const MAIN_LINE = 100

// own is the reader's own work, and diff its changed files when the caller has read them already. boxes are the boxes
// of the level, so the change can name those it touched. lines are what the reader looked at.
export async function toReview(
	repo: Repository,
	{ own, diff }: { own: Change | null; diff: FileDiff[] | null },
	head: CommitHash,
	{ boxes, lines }: { boxes: { name: string; paths: string[] }[]; lines: SeenLine[] },
	signal?: AbortSignal,
): Promise<ToReview | null> {
	let files: Pick<FileDiff, 'path' | 'oldPath'>[]
	let range: Change['range']
	let change: string
	let what: string
	let title: string
	let why: string
	if (own) {
		const result = diff ? { kind: 'ok' as const, files: diff } : await repo.diffFiles(own.range, signal)
		if (result.kind !== 'ok') return null
		files = result.files
		range = own.range
		change = own.asked
		what = own.kind === 'uncommitted' ? 'your uncommitted work' : `your branch ${own.name}`
		title = `Review ${what}`
		why = own.kind === 'uncommitted' ? '' : 'It is ahead of the main branch.'
	} else {
		const line = await repo.mainLine(head, MAIN_LINE, signal)
		const merge = line.kind === 'ok' ? line.commits.find((commit) => commit.parents.length > 1) : undefined
		const base = merge?.parents[0]
		if (!merge || !base) return null
		range = { base, head: merge.hash }
		const result = await repo.diffFiles(range, signal)
		if (result.kind !== 'ok') return null
		files = result.files
		change = `${merge.hash}^1..${merge.hash}`
		const pull = pullRequestOf(merge.subject)
		what = pull ? `pull request ${pull}` : 'the newest merge'
		title = pull ? `Review the merge of pull request ${pull}` : 'Review the newest merge'
		why = pull
			? 'It is the newest merge and you have not walked through it.'
			: `It is "${merge.subject}", and you have not walked through it.`
	}

	// Reading the same file at another base or head can show a different diff.
	const seen = new Set(
		lines.flatMap((line) =>
			line.did === 'change' && line.change.base === range.base && line.change.head === range.head ? line.paths : [],
		),
	)
	const remaining = files.filter(({ path, oldPath }) => !covered(path, seen) && !covered(oldPath, seen))
	if (remaining.length === 0) return null
	const touches = (box: { paths: string[] }, file: Pick<FileDiff, 'path' | 'oldPath'>) =>
		box.paths.some((place) => under(file.path, place) || under(file.oldPath, place))
	const touched = boxes.filter((box) => remaining.some((file) => touches(box, file)))
	const parts = touched.map((box) => box.name)
	const size = { files: remaining.length, parts, change, what }
	if (remaining.length === files.length) return { ...size, title, why }
	const [last] = touched
	const part = last && touched.length === 1 && remaining.every((file) => touches(last, file)) ? last.name : undefined
	return {
		...size,
		title: `Continue reviewing ${what}`,
		why: part ? `You still have changes in ${part} to review.` : 'These changes are still to review.',
		...(part ? { part } : {}),
	}
}

// Each recorded path is a file or directory. Check its ancestors without scanning all the reader's past steps.
function covered(file: string, seen: Set<string>): boolean {
	while (!seen.has(file)) {
		const slash = file.lastIndexOf('/')
		if (slash < 0) return false
		file = file.slice(0, slash)
	}
	return true
}

// The number of the pull request a merge brought in, such as "#107", read from the subject GitHub writes for it. ken
// names such a merge by that number wherever it names the change, since the subject is mostly a branch name.
export function pullRequestOf(subject: string): string | null {
	return /^Merge pull request (#\d+) from \S+$/.exec(subject)?.[1] ?? null
}
