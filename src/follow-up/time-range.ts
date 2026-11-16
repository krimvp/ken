import type { Commit, CommitHash, Repository } from '../repo/index.ts'

// days: the last N days. day: since the start of a day, in UTC. question: since the owner's last question, from the
// commit the project was at then, or from its time when the history did not keep the commit.
export type Since =
	| { kind: 'days'; days: number }
	| { kind: 'day'; day: string }
	| { kind: 'question'; askedAt: string; head: string | null }

// A span of time as a range of commits: what landed on the main line after base, up to head. start is when the span
// begins. fromFirst says no commit is older than the start, so the range begins at the project's first commit and
// leaves that one commit out. commits leaves out merges, since the commits a merge brings are listed themselves.
export type TimeRange = {
	since: Since
	start: string
	base: CommitHash
	head: CommitHash
	fromFirst: boolean
	commits: Commit[]
}

const DAY_MS = 86_400_000
const MAX_DAYS = 3650

// Reads "14d" or "2026-11-01" as the reader types it, and "question" as since their last question.
export function sinceOf(
	text: string,
	lastQuestion: { askedAt: string; head: string | null } | undefined,
): { kind: 'ok'; since: Since } | { kind: 'refused'; problem: string } {
	const days = /^(\d+)d$/.exec(text.trim())
	if (days && Number(days[1]) >= 1 && Number(days[1]) <= MAX_DAYS) {
		return { kind: 'ok', since: { kind: 'days', days: Number(days[1]) } }
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !Number.isNaN(Date.parse(text.trim()))) {
		return { kind: 'ok', since: { kind: 'day', day: text.trim() } }
	}
	if (text.trim() === 'question') {
		if (lastQuestion) return { kind: 'ok', since: { kind: 'question', ...lastQuestion } }
		return {
			kind: 'refused',
			problem: 'You have asked no question in this project yet, so name a day or a number of days.',
		}
	}
	return {
		kind: 'refused',
		problem: `Name a day such as 2026-11-01, or a number of days such as 14d, up to ${MAX_DAYS}d.`,
	}
}

export async function timeRange(
	repo: Repository,
	since: Since,
	now: Date,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; range: TimeRange } | { kind: 'refused'; problem: string }> {
	const head = await repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') return { kind: 'refused', problem: 'The project has no commits yet.' }
	const start =
		since.kind === 'days'
			? new Date(now.getTime() - since.days * DAY_MS).toISOString()
			: since.kind === 'day'
				? `${since.day}T00:00:00.000Z`
				: since.askedAt
	const asked = since.kind === 'question' && since.head ? await repo.resolve(since.head, signal) : null
	const before = asked?.kind === 'ok' ? asked.commit : await repo.before(head.commit, start, signal)
	const base = before ?? (await repo.firstCommit(signal))
	if (base === null) return { kind: 'refused', problem: 'The project has no commits yet.' }
	const logged = base === head.commit ? null : await repo.log({ base, head: head.commit }, signal)
	if (logged?.kind === 'too-large') {
		return { kind: 'refused', problem: 'That span holds too many commits to read. Pick a shorter one.' }
	}
	const commits = (logged?.commits ?? []).filter((commit) => commit.parents.length < 2)
	return { kind: 'ok', range: { since, start, base, head: head.commit, fromFirst: before === null, commits } }
}
