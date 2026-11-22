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
	const touched = (files: string[]) =>
		boxes.filter(({ paths }) => files.some((file) => paths.some((place) => under(file, place)))).map((box) => box.name)
	if (own) {
		const read = diff ? null : await repo.diff(own.range, signal)
		const files = diff ?? (read?.kind === 'ok' ? read.files : [])
		return {
			title: own.kind === 'uncommitted' ? 'Review your uncommitted work' : `Review your branch ${own.name}`,
			what: own.kind === 'uncommitted' ? 'your uncommitted work' : `your branch ${own.name}`,
			why: own.kind === 'uncommitted' ? '' : 'It is ahead of the main branch.',
			change: own.asked,
			files: files.length,
			parts: touched(files.flatMap((file) => [file.path, file.oldPath])),
		}
	}
	const line = await repo.mainLine(head, MAIN_LINE, signal)
	const merge = line.kind === 'ok' ? line.commits.find((commit) => commit.parents.length > 1) : undefined
	if (!merge || merge.paths.length === 0) return null
	// A step or a part shows only its own paths. Reading a span with a different base can also show a different diff.
	const seen = new Set(
		lines.flatMap((each) =>
			each.did === 'change' && each.change.base === merge.parents[0] && each.change.head === merge.hash
				? each.paths
				: [],
		),
	)
	const remaining = merge.paths.filter((file) => !covered(file, seen))
	if (remaining.length === 0) return null
	const pull = pullRequestOf(merge.subject)
	const what = pull ? `pull request ${pull}` : 'the newest merge'
	if (remaining.length < merge.paths.length) {
		const parts = touched(remaining)
		const last = parts.length === 1 ? boxes.find((box) => box.name === parts[0]) : undefined
		const part =
			last && remaining.every((file) => last.paths.some((place) => under(file, place))) ? last.name : undefined
		return {
			title: `Continue reviewing ${what}`,
			what,
			why: part ? `You still have changes in ${part} to review.` : 'These changes are still to review.',
			change: `${merge.hash}^1..${merge.hash}`,
			files: remaining.length,
			parts,
			...(part ? { part } : {}),
		}
	}
	return {
		title: pull ? `Review the merge of pull request ${pull}` : 'Review the newest merge',
		what,
		why: pull
			? 'It is the newest merge and you have not walked through it.'
			: `It is "${merge.subject}", and you have not walked through it.`,
		change: `${merge.hash}^1..${merge.hash}`,
		files: merge.paths.length,
		parts: touched(merge.paths),
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
