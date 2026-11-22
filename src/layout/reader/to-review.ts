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
			why: own.kind === 'uncommitted' ? '' : 'It is ahead of the main branch.',
			change: own.asked,
			files: files.length,
			parts: touched(files.flatMap((file) => [file.path, file.oldPath])),
		}
	}
	const line = await repo.mainLine(head, MAIN_LINE, signal)
	const merge = line.kind === 'ok' ? line.commits.find((commit) => commit.parents.length > 1) : undefined
	if (!merge || lines.some((each) => each.did === 'change' && each.change.head === merge.hash)) return null
	const pull = pullRequestOf(merge.subject)
	return {
		title: pull ? `Review the merge of pull request ${pull}` : 'Review the newest merge',
		why: pull
			? 'It is the newest merge and you have not walked through it.'
			: `It is "${merge.subject}", and you have not walked through it.`,
		change: `${merge.hash}^1..${merge.hash}`,
		files: merge.paths.length,
		parts: touched(merge.paths),
	}
}

// The number of the pull request a merge brought in, such as "#107", read from the subject GitHub writes for it. ken
// names such a merge by that number wherever it names the change, since the subject is mostly a branch name.
export function pullRequestOf(subject: string): string | null {
	return /^Merge pull request (#\d+) from \S+$/.exec(subject)?.[1] ?? null
}
