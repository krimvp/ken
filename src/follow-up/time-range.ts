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

// A choice with the same fact said two more ways: landed as a sentence, such as "23 commits landed since your last
// commit, 14 Oct.", and short in a few words, such as "23 commits since 14 Oct".
export type Landed = { choice: SinceChoice; landed: string; short: string }

const SPANS_DAYS = [7, 30, 90]
// shortcut: the reader's last commit is looked for among this many of the newest commits on HEAD's main line. Walk
// further if a reader ever misses one.
const MAX_WALK = 200

// The spans that hold at least one commit, in this order: since the reader's last question, since their own last
// commit, then the last 7, 30 and 90 days, without a span that holds the same commits as a shorter one. asked is the
// reader's questions, oldest first.
export async function sinceChoices(
	repo: Repository,
	asked: { askedAt: string; head: string | null }[],
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
	const spans: { title: string; clause: string; short: string; base: CommitHash; commits: number }[] = []
	const since = async (what: string, moment: string, base: CommitHash) => {
		const when = day(moment, now)
		const [title, clause, short] = [`Since ${what}, ${when}`, `since ${what}, ${when}`, `since ${when}`]
		spans.push({ title, clause, short, base, commits: await landedSince(base) })
	}

	const question = await lastAskedBefore(repo, asked, head, signal)
	if (question) await since('your last question to ken', question.askedAt, question.head)
	const [email, line] = await Promise.all([repo.userEmail(signal), repo.mainLine(head, MAX_WALK, signal)])
	const own =
		email === null || line.kind !== 'ok'
			? undefined
			: line.commits.find((commit) => commit.email.toLowerCase() === email.toLowerCase())
	if (own && own.hash !== head) await since('your last commit', own.date, own.hash)
	const bases = new Set<CommitHash>()
	for (const days of SPANS_DAYS) {
		const range = await timeRange(repo, { kind: 'days', days }, now, signal)
		if (range.kind !== 'ok' || bases.has(range.range.base)) continue
		bases.add(range.range.base)
		spans.push({
			title: `The last ${days} days`,
			clause: `in the last ${days} days`,
			short: `in the last ${days} days`,
			base: range.range.base,
			commits: range.range.commits.length,
		})
	}
	return spans
		.filter((span) => span.commits > 0)
		.map(({ title, clause, short, base, commits }) => {
			const count = commits === 1 ? '1 commit' : `${commits} commits`
			return {
				choice: { kind: 'since', change: `${base}..${head}`, name: `${title}: ${count}`, commits },
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
