// What landed in each box since the reader last looked at it. The boxes may have been looked at at different commits,
// and one read of git answers for all of them.
import { commitsSince } from '../../follow-up/index.ts'
import type { Looks, Since, TopicState } from '../../map/index.ts'
import type { RecordRead } from '../../record/index.ts'
import type { Commit, CommitHash, Repository } from '../../repo/index.ts'
import { under } from '../folder-split.ts'

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
			if (looks.lookedAt.length > 0) return { looked: looks.lookedAt, any: [] }
			const changed = inBox.flatMap(({ state }) =>
				(state.kind === 'changed' || state.kind === 'long-ago') && state.changed.length > 0 ? [startOf(state)] : [],
			)
			return { looked: [], any: (await Promise.all(changed)).flatMap((commit) => commit ?? []) }
		}),
	)
	const commits = [...new Set(asked.flatMap(({ looked, any }) => [...looked.flat(), ...any]))]
	if (commits.length === 0) return drawn.map(() => null)
	const listed = await repo.landedAfter(head, commits, signal)
	// shortcut: a log past git's output limit counts no commit since the reader looked. Say so on the box if a
	// project ever reaches it.
	if (listed.kind !== 'ok') return drawn.map(() => null)
	return drawn.map(({ box }, index) => {
		const { looked, any } = asked[index] ?? { looked: [], any: [] }
		if (looked.length > 0) return sinceOf(box.paths, looked, listed.landed)
		const counted = any.flatMap((commit) => {
			const since = sinceOf(box.paths, [[commit]], listed.landed)
			return since === null || since === 'gone' ? [] : [since]
		})
		return counted.toSorted((a, b) => b.commits - a.commits)[0] ?? null
	})
}

// landed is the repository's answer for every commit asked, null where HEAD does not reach it. Of each line's commits
// the first HEAD reaches counts, and of the lines the one the reader saw the box newest at: the fewest commits landed
// after it. So a change read today that ended a week ago does not undo the code read at HEAD yesterday. When HEAD
// does not reach the newest line, ken cannot tell what the reader saw last.
function sinceOf(paths: string[], lookedAt: string[][], landed: Map<string, Commit[] | null>): Since {
	if (lookedAt.length === 0) return null
	const reached = lookedAt.map((line) => line.find((each) => landed.get(each)))
	if (reached[0] === undefined) return 'gone'
	const after = reached
		.flatMap((commit) => {
			const list = commit === undefined ? null : landed.get(commit)
			return commit === undefined || !list ? [] : [{ commit, list }]
		})
		.toSorted((a, b) => a.list.length - b.list.length)[0]
	if (!after) return 'gone'
	const touched = (each: Commit) => each.paths.some((file) => paths.some((place) => under(file, place)))
	return { commit: after.commit, commits: after.list.filter(touched).length }
}
