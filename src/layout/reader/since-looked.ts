// What landed in each box since the reader last looked at it. The boxes may have been looked at at different commits,
// and one read of git answers for all of them.
import { commitsSince } from '../../follow-up/index.ts'
import type { TopicState } from '../../map/index.ts'
import type { RecordRead } from '../../record/index.ts'
import type { Commit, CommitHash, Repository } from '../../repo/index.ts'
import { under } from '../folder-split.ts'
import type { Looks } from './box-knows.ts'

// The commit the reader last looked at a box, as its full hash, and how many commits touched the box after it, merges
// left out. gone: HEAD does not reach that commit. null: ken holds no such commit for the box.
export type Since = { commit: string; commits: number } | 'gone' | null

type Drawn = { box: { paths: string[] }; inBox: { state: TopicState }[]; looks: Looks }

// A line on what the reader looked at keeps the commit. The map keeps a day and no commit, so for a box only the map
// speaks of, ken finds where the reader's understanding of each changed topic starts, and counts from the one with
// the most commits since.
export async function sinceLooked(
	repo: Repository,
	record: RecordRead,
	head: CommitHash,
	drawn: Drawn[],
	signal?: AbortSignal,
): Promise<Since[]> {
	const starts = new Map<string, Promise<CommitHash | null>>()
	const startOf = (state: Extract<TopicState, { kind: 'changed' | 'long-ago' }>) => {
		const found = starts.get(state.topic) ?? commitsSince(repo, record, state, signal).then((each) => each.since)
		starts.set(state.topic, found)
		return found
	}
	const asked = await Promise.all(
		drawn.map(async ({ inBox, looks }) => {
			if (looks.lookedAt.length > 0) return { first: looks.lookedAt, any: [] }
			const changed = inBox.flatMap(({ state }) =>
				(state.kind === 'changed' || state.kind === 'long-ago') && state.changed.length > 0 ? [startOf(state)] : [],
			)
			return { first: [], any: (await Promise.all(changed)).flatMap((commit) => commit ?? []) }
		}),
	)
	const commits = [...new Set(asked.flatMap(({ first, any }) => [...first, ...any]))]
	if (commits.length === 0) return drawn.map(() => null)
	const listed = await repo.landedAfter(head, commits, signal)
	// shortcut: a log past git's output limit counts no commit since the reader looked. Say so on the box if a
	// project ever reaches it.
	if (listed.kind !== 'ok') return drawn.map(() => null)
	return drawn.map(({ box }, index) => {
		const { first, any } = asked[index] ?? { first: [], any: [] }
		if (first.length > 0) return sinceOf(box.paths, first, listed.landed)
		const counted = any.flatMap((commit) => {
			const since = sinceOf(box.paths, [commit], listed.landed)
			return since === null || since === 'gone' ? [] : [since]
		})
		return counted.toSorted((a, b) => b.commits - a.commits)[0] ?? null
	})
}

// landed is the repository's answer for every commit asked, null where HEAD does not reach it. Of lookedAt, the first
// commit HEAD reaches counts.
function sinceOf(paths: string[], lookedAt: string[], landed: Map<string, Commit[] | null>): Since {
	if (lookedAt.length === 0) return null
	const commit = lookedAt.find((each) => landed.get(each))
	const after = commit === undefined ? null : landed.get(commit)
	if (commit === undefined || !after) return 'gone'
	const commits = after.filter((each) => each.paths.some((file) => paths.some((place) => under(file, place)))).length
	return { commit, commits }
}
