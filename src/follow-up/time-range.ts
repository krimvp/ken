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

// Reads "14", "14d" or "2026-11-01" as the reader types it, and "question" as since their last question.
export function sinceOf(
	text: string,
	lastQuestion: { askedAt: string; head: string | null } | undefined,
): { kind: 'ok'; since: Since } | { kind: 'refused'; problem: string } {
	const days = /^(\d+)d?$/.exec(text.trim())
	if (days && Number(days[1]) >= 1 && Number(days[1]) <= MAX_DAYS) {
		return { kind: 'ok', since: { kind: 'days', days: Number(days[1]) } }
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
		// Date reads 2026-02-30 as the second of March, so a day counts only when it reads back as written.
		const read = new Date(`${text.trim()}T00:00:00Z`)
		if (Number.isNaN(read.getTime()) || read.toISOString().slice(0, 10) !== text.trim()) {
			return { kind: 'refused', problem: `${text.trim()} is not a day in the calendar. Name one that is.` }
		}
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
		problem: `Name a day such as 2026-11-01, or a number of days such as 14, up to ${MAX_DAYS}.`,
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

// A choice with the same fact said two more ways: landed as a sentence, such as "23 commits landed since your last
// commit, 14 Oct.", and short in a few words, such as "23 commits since 14 Oct". anchor is what the span starts at: when
// the reader last looked, their last question, their own last commit, or a number of days ago.
export type Landed = { choice: SinceChoice; anchor: Anchor; landed: string; short: string }
export type Anchor = 'visit' | 'question' | 'commit' | 'days'

const SPANS_DAYS = [7, 30, 90]

// The spans that hold at least one commit, in this order: since the reader last looked, since their own last commit,
// then the last 7, 30 and 90 days, without a span that holds the same commits as one before it. visit is when ken last
// recorded that the reader looked at the project and the commit it was at then. Without one, their last question
// stands for it: asked is the reader's questions, oldest first.
export async function sinceChoices(
	repo: Repository,
	asked: { askedAt: string; head: string | null }[],
	visit: { at: string; head: string } | null,
	now: Date,
	signal?: AbortSignal,
): Promise<Landed[]> {
	const resolved = await repo.resolve('HEAD', signal)
	if (resolved.kind !== 'ok') return []
	const head = resolved.commit
	// A merge is left out of every count, as timeRange leaves it out: the commits it brings are counted themselves.
	const landedSince = async (base: CommitHash) => {
		const logged = await repo.log({ base, head }, signal)
		return logged.kind === 'ok' ? logged.commits.filter((commit) => commit.parents.length < 2).length : 0
	}
	// title heads the choice, clause says the same span inside a sentence, and short says it in the fewest words.
	const spans: { anchor: Anchor; title: string; clause: string; short: string; base: CommitHash; commits: number }[] =
		[]
	const since = async (anchor: Anchor, what: string, moment: string, base: CommitHash) => {
		const when = day(moment, now)
		const [title, clause, short] = [`Since ${what}, ${when}`, `since ${what}, ${when}`, `since ${when}`]
		spans.push({ anchor, title, clause, short, base, commits: await landedSince(base) })
	}

	const looked = await lastAskedBefore(repo, visit ? [{ askedAt: visit.at, head: visit.head }] : asked, head, signal)
	if (looked && visit) await since('visit', 'you last looked', looked.askedAt, looked.head)
	else if (looked) await since('question', 'your last question to ken', looked.askedAt, looked.head)
	const email = await repo.userEmail(signal)
	const own = email === null ? null : await repo.lastCommitBy(head, email, signal)
	if (own && own.hash !== head) await since('commit', 'your last commit', own.date, own.hash)
	const bases = new Set(spans.map((span) => span.base))
	for (const days of SPANS_DAYS) {
		const range = await timeRange(repo, { kind: 'days', days }, now, signal)
		if (range.kind !== 'ok' || bases.has(range.range.base)) continue
		bases.add(range.range.base)
		spans.push({
			anchor: 'days',
			title: `The last ${days} days`,
			clause: `in the last ${days} days`,
			short: `in the last ${days} days`,
			base: range.range.base,
			commits: range.range.commits.length,
		})
	}
	return spans
		.filter((span) => span.commits > 0)
		.map(({ anchor, title, clause, short, base, commits }) => {
			const count = commits === 1 ? '1 commit' : `${commits} commits`
			return {
				choice: { kind: 'since', change: `${base}..${head}`, name: `${title}: ${count}`, commits },
				anchor,
				landed: `${count} landed ${clause}.`,
				short: `${count} ${short}`,
			}
		})
}

// The reader's newest question that has a head, when the project was at an older commit of HEAD's history then. Asked
// at HEAD, nothing landed since it. Asked at a commit HEAD's history does not hold, as after a rebase, there is no base.
async function lastAskedBefore(
	repo: Repository,
	asked: { askedAt: string; head: string | null }[],
	head: CommitHash,
	signal?: AbortSignal,
): Promise<{ askedAt: string; head: CommitHash } | null> {
	const newest = asked.findLast((each) => each.head !== null)
	if (!newest?.head) return null
	const commit = await repo.resolve(newest.head, signal)
	if (commit.kind !== 'ok' || commit.commit === head) return null
	const split = await repo.mergeBase(commit.commit, head, signal)
	return split.kind === 'ok' && split.commit === commit.commit ? { askedAt: newest.askedAt, head: commit.commit } : null
}
