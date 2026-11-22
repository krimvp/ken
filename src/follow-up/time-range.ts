import type { Commit, CommitHash, Repository } from '../repo/index.ts'
import { day } from './when.ts'

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

// A span of time the page offers to lay over the picture as a change, so the reader can catch up. change is the range
// as the layout takes it, and name is what the reader picks: the span, then the commits it holds.
export type SinceChoice = { kind: 'since'; change: string; name: string; commits: number }

const SPANS_DAYS = [7, 30, 90]
// shortcut: the reader's last commit is looked for among this many of the newest commits on HEAD's main line, and
// their last question among this many of the commits they last asked at. Walk further if a reader ever misses one.
const MAX_WALK = 200
const MAX_ASKED_AT = 20

// The spans that hold at least one commit, in this order: since the reader's last question at an older commit, since
// their own last commit, then the last 7, 30 and 90 days, without a span that holds the same commits as a shorter one.
// asked is the reader's questions, oldest first. landed says the choice in one sentence, such as "23 commits landed
// since your last commit, 14 Oct."
export async function sinceChoices(
	repo: Repository,
	asked: { askedAt: string; head: string | null }[],
	now: Date,
	signal?: AbortSignal,
): Promise<{ choice: SinceChoice; landed: string }[]> {
	const resolved = await repo.resolve('HEAD', signal)
	if (resolved.kind !== 'ok') return []
	const head = resolved.commit
	// A merge is left out of every count, as timeRange leaves it out: the commits it brings are counted themselves.
	const landedSince = async (base: CommitHash) => {
		const logged = await repo.log({ base, head }, signal)
		return logged.kind === 'ok' ? logged.commits.filter((commit) => commit.parents.length < 2).length : 0
	}
	// title heads the choice and clause says the same span inside a sentence.
	const spans: { title: string; clause: string; base: CommitHash; commits: number }[] = []
	const since = async (what: string, base: CommitHash) =>
		spans.push({ title: `Since ${what}`, clause: `since ${what}`, base, commits: await landedSince(base) })

	const question = await lastAskedBefore(repo, asked, head, signal)
	if (question) await since(`your last question to ken, ${day(question.askedAt, now)}`, question.head)
	const [email, line] = await Promise.all([repo.userEmail(signal), repo.mainLine(head, MAX_WALK, signal)])
	const own =
		email === null || line.kind !== 'ok'
			? undefined
			: line.commits.find((commit) => commit.email.toLowerCase() === email.toLowerCase())
	if (own && own.hash !== head) await since(`your last commit, ${day(own.date, now)}`, own.hash)
	const bases = new Set<CommitHash>()
	for (const days of SPANS_DAYS) {
		const range = await timeRange(repo, { kind: 'days', days }, now, signal)
		if (range.kind !== 'ok' || bases.has(range.range.base)) continue
		bases.add(range.range.base)
		spans.push({
			title: `The last ${days} days`,
			clause: `in the last ${days} days`,
			base: range.range.base,
			commits: range.range.commits.length,
		})
	}
	return spans
		.filter((span) => span.commits > 0)
		.map(({ title, clause, base, commits }) => {
			const count = commits === 1 ? '1 commit' : `${commits} commits`
			return {
				choice: { kind: 'since', change: `${base}..${head}`, name: `${title}: ${count}`, commits },
				landed: `${count} landed ${clause}.`,
			}
		})
}

// The newest question the reader asked while the project was at an older commit of HEAD's history.
async function lastAskedBefore(
	repo: Repository,
	asked: { askedAt: string; head: string | null }[],
	head: CommitHash,
	signal?: AbortSignal,
): Promise<{ askedAt: string; head: CommitHash } | null> {
	const tried = new Set<string>()
	for (const each of asked.toReversed()) {
		if (each.head === null || each.head === head || tried.has(each.head)) continue
		if (tried.size === MAX_ASKED_AT) return null
		tried.add(each.head)
		const commit = await repo.resolve(each.head, signal)
		if (commit.kind !== 'ok') continue
		const split = await repo.mergeBase(commit.commit, head, signal)
		if (split.kind === 'ok' && split.commit === commit.commit) return { askedAt: each.askedAt, head: commit.commit }
	}
	return null
}
