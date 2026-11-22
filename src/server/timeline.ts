// The commits of the last days, counted by day, for the line the reader drags across to pick a span. Merges are
// counted apart, since the commits a merge brings are counted themselves. A day is a day in UTC, as in a change
// asked for as "since:2026-11-01", so a span picked here asks for the same commits there.
import type { Commit, Repository } from '../repo/index.ts'

export type TimelineDay = { day: string; commits: number; merges: number }

const DAY_MS = 86_400_000
export const TIMELINE_DAYS = { fewest: 1, most: 3650, unasked: 90 } as const

// One entry for each day that has a commit, oldest first. too-large: the span holds more commits than git can list.
export async function timelineOf(
	repo: Repository,
	days: number,
	now: Date,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; days: TimelineDay[] } | { kind: 'too-large' }> {
	const head = await repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') return { kind: 'ok', days: [] }
	const start = new Date(now.getTime() - days * DAY_MS).toISOString()
	const before = await repo.before(head.commit, start, signal)
	const base = before ?? (await repo.firstCommit(signal))
	if (base === null) return { kind: 'ok', days: [] }
	// A span that reaches the project's start begins at its first commit, which a range from it leaves out.
	const [logged, first] = await Promise.all([
		base === head.commit ? null : repo.log({ base, head: head.commit }, signal),
		before === null ? repo.mainLine(base, 1, signal) : null,
	])
	if (logged?.kind === 'too-large' || first?.kind === 'too-large') return { kind: 'too-large' }
	const landed: Commit[] = [...(logged?.commits ?? []), ...(first?.commits ?? [])]
	const byDay = new Map<string, TimelineDay>()
	for (const commit of landed) {
		if (commit.date < start) continue
		const day = commit.date.slice(0, 10)
		const entry = byDay.get(day) ?? { day, commits: 0, merges: 0 }
		if (commit.parents.length > 1) entry.merges += 1
		else entry.commits += 1
		byDay.set(day, entry)
	}
	return { kind: 'ok', days: [...byDay.values()].toSorted((a, b) => a.day.localeCompare(b.day)) }
}
