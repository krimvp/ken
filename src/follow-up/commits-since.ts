import type { MapEntry } from '../map/index.ts'
import { codeHash, type RecordRead, sameName, topicCode } from '../record/index.ts'
import type { Commit, CommitHash, Repository } from '../repo/index.ts'

// Main-line commits ken hashes the topic at, at most, while it looks for where the owner's understanding starts.
const MAX_WALK = 200

// The commits that touched a topic's files since the owner understood it, oldest last. The map line keeps a day and the
// hash of the topic's quoted code that day, not a commit, so ken finds the start in git: the newest main-line commit
// at which the quoted code hashes to the map's hash, or else the last commit before that day. since is that start, or
// null when there is no commit before it.
export async function commitsSince(
	repo: Repository,
	record: RecordRead,
	known: { topic: string; entry: MapEntry },
	signal?: AbortSignal,
): Promise<{ since: CommitHash | null; commits: Commit[] }> {
	const head = await repo.resolve('HEAD', signal)
	const versions = record.entries.flatMap((entry) =>
		entry.kind === 'topic' && sameName(entry.name, known.topic) ? [entry] : [],
	)
	const current = versions.at(-1)
	if (head.kind !== 'ok' || current === undefined) return { since: null, commits: [] }
	// The version the owner knew is the one whose quotes hash to the map's hash. When none does, ken uses the newest.
	const knew = versions.find((version) => codeHash(version.quotes) === known.entry.hash) ?? current
	const files = new Set([knew, current].flatMap((version) => version.quotes.flatMap((quote) => quote.path ?? [])))
	const touches = (commit: Commit) => commit.paths.some((path) => files.has(path))

	const dayBefore = await repo.before(head.commit, `${known.entry.date}T00:00:00Z`, signal)
	let since = dayBefore
	const line = await repo.mainLine(head.commit, MAX_WALK, signal)
	for (const commit of line.kind === 'ok' ? line.commits : []) {
		if (commit.hash === dayBefore) break
		if (touches(commit) && (await topicCode(repo, knew, signal, commit.hash)).hash === known.entry.hash) {
			since = commit.hash
			break
		}
	}
	const base = since ?? (await repo.firstCommit(signal))
	if (base === null || base === head.commit) return { since, commits: [] }
	const logged = await repo.log({ base, head: head.commit }, signal)
	// shortcut: a log past git's 16 MB output limit lists no commits. Say so on the page if a project ever reaches it.
	return { since, commits: logged.kind === 'ok' ? logged.commits.filter(touches) : [] }
}
