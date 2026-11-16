// The questions slice 6 writes for the agent, each a line the reader asks and ken's list under it, as the lenses of
// slice 4 do. The page and the terminal show the list before the agent explains it. empty says the list holds nothing
// to explain, so ken does not ask the agent at all.
import { linesText, type TopicState } from '../map/index.ts'
import type { RecordRead, Who } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import type { ChangeCommit, OpenItems, OpenTopic } from './open-items.ts'
import { authorsOf, findAuthor, type PersonChanges, personChanges } from './person.ts'
import { type Since, sinceOf, type TimeRange, timeRange } from './time-range.ts'

export type LensQuestion = { text: string; empty: boolean }

// What a lens reads besides git: the record, the reader's map now, and the reader's last question, if any.
export type LensFacts = {
	record: RecordRead
	states: TopicState[]
	lastQuestion: { askedAt: string; head: string | null } | undefined
}

type Written = { kind: 'ok'; question: LensQuestion } | { kind: 'refused'; problem: string }

// since is what the reader typed or picked: "14d", "2026-11-01" or "question".
export async function personLens(
	repo: Repository,
	facts: LensFacts,
	asked: { author: string; since: string },
	now: Date,
	signal?: AbortSignal,
): Promise<Written> {
	const since = sinceOf(asked.since, facts.lastQuestion)
	if (since.kind !== 'ok') return since
	const range = await timeRange(repo, since.since, now, signal)
	if (range.kind !== 'ok') return range
	const userEmail = await repo.userEmail(signal)
	const author = findAuthor(authorsOf(range.range.commits, userEmail), asked.author)
	if (author.kind !== 'ok') return author
	const changes = personChanges(range.range, author.author, { ...facts, userEmail })
	return { kind: 'ok', question: personQuestion(changes) }
}

export async function rangeLens(
	repo: Repository,
	facts: LensFacts,
	asked: string,
	now: Date,
	signal?: AbortSignal,
): Promise<Written> {
	const since = sinceOf(asked, facts.lastQuestion)
	if (since.kind !== 'ok') return since
	const range = await timeRange(repo, since.since, now, signal)
	if (range.kind !== 'ok') return range
	return { kind: 'ok', question: rangeQuestion(range.range, facts.record, await repo.userEmail(signal)) }
}

const MAX_LISTED = 20

const WHO: Record<Who, string> = {
	owner: 'me',
	'owner-agent': 'my agent',
	collaborator: 'a collaborator',
	unknown: 'git cannot tell who',
}

export function openQuestion(open: OpenItems): LensQuestion {
	const decisions = open.decisions.map(
		(d) => `- A decision needs my call: ${d.question} Chosen: ${d.chosen} It is decision ${d.id} in the record.`,
	)
	const topics = open.topics.map(
		({ state, commits }) =>
			`- ${state.topic} changed since I understood it on ${state.entry.date}: ${state.changed.map(linesText).join(', ')}. ${commitsSaid(commits)}`,
	)
	const list = [...decisions, ...topics]
	if (list.length === 0) {
		const none = '- Nothing is open: no decision waits on me, and no topic I understood has changed since.'
		return { text: ['What is open for me in this project?', none].join('\n'), empty: true }
	}
	return { text: ['What is open for me in this project?', ...list].join('\n'), empty: false }
}

// "Explain what changed" on one topic of the open list.
export function topicQuestion({ state, commits }: OpenTopic): LensQuestion {
	return {
		text: [
			`What changed in ${state.topic} since I understood it on ${state.entry.date}?`,
			`- Its code changed since: ${state.changed.map(linesText).join(', ')}.`,
			...(commits.length === 0 ? ['- ken found no commit to its files since then.'] : commits.map(commitLine)),
		].join('\n'),
		empty: false,
	}
}

export function personQuestion({ author, range, commits, topics }: PersonChanges): LensQuestion {
	const when = sinceWords(range.since)
	const who = author.by.map((by) => WHO[by]).join(' or ')
	const made =
		commits.length === 0
			? [`- ${author.name} made no commit ${when}.`]
			: [
					`- ${author.name} <${author.email}> (${who}) made ${count(commits.length)} from ${short(range.base)} to ${short(range.head)}:`,
					...commits.slice(0, MAX_LISTED).map((c) => `- ${short(c.hash)} on ${c.date.slice(0, 10)}: ${c.subject}`),
					...(commits.length > MAX_LISTED ? [`- and ${commits.length - MAX_LISTED} older ones`] : []),
					...(range.fromFirst ? [fromFirst(range)] : []),
				]
	const known = topics.map(
		({ state, commits: touched }) =>
			`- ${state.topic}, which I understood on ${state.entry.date}: their ${touched.map(short).join(', ')} touched its files, and ${state.kind === 'unchanged' || state.changed.length === 0 ? 'its quoted lines are as I knew them' : `its code changed since: ${state.changed.map(linesText).join(', ')}`}.`,
	)
	return {
		text: [
			`What did ${author.name} change in the topics I know, ${when}?`,
			...made,
			...(known.length > 0 ? known : commits.length > 0 ? ['- None of their commits touched a topic I know.'] : []),
		].join('\n'),
		empty: known.length === 0,
	}
}

// The lens "a time range". The agent reads the record's pieces of work first, as its prompt says.
export function rangeQuestion(range: TimeRange, record: RecordRead, userEmail: string | null): LensQuestion {
	const when = sinceWords(range.since)
	if (range.commits.length === 0) {
		return { text: [`What happened ${when}?`, `- No commit landed ${when}.`].join('\n'), empty: true }
	}
	const authors = authorsOf(range.commits, userEmail)
	const inRange = new Set<string>(range.commits.map((commit) => commit.hash))
	const work = record.current.flatMap((entry) =>
		entry.kind === 'work' && entry.commits.some((commit) => inRange.has(commit.hash)) ? [entry] : [],
	)
	return {
		text: [
			`What happened ${when}, from ${short(range.base)} to ${short(range.head)}?`,
			`- ${count(range.commits.length)}: ${authors.map((author) => `${author.commits} by ${author.name}`).join(', ')}.`,
			...(range.fromFirst ? [fromFirst(range)] : []),
			...(work.length === 0
				? ['- The record has no piece of work in this range yet.']
				: work
						.slice(-MAX_LISTED)
						.map(
							(each) =>
								`- Work the record has in this range: "${each.title}", ${short(each.range.base)}..${short(each.range.head)}`,
						)),
		].join('\n'),
		empty: false,
	}
}

export function sinceWords(since: Since): string {
	if (since.kind === 'days') return since.days === 1 ? 'in the last day' : `in the last ${since.days} days`
	if (since.kind === 'day') return `since ${since.day}`
	return 'since my last question'
}

function fromFirst(range: TimeRange): string {
	return `- No commit is older than the start, so the range starts at the first commit, ${short(range.base)}, and leaves it out.`
}

function commitsSaid(commits: ChangeCommit[]): string {
	if (commits.length === 0) return 'ken found no commit to its files since then.'
	return `Commits to its files since then: ${commits.map((c) => `${short(c.hash)} by ${c.author} (${WHO[c.by]})`).join(', ')}.`
}

function commitLine(commit: ChangeCommit): string {
	return `- ${short(commit.hash)} by ${commit.author} (${WHO[commit.by]}) on ${commit.date.slice(0, 10)}: ${commit.subject}`
}

function count(commits: number): string {
	return commits === 1 ? '1 commit' : `${commits} commits`
}

function short(hash: string): string {
	return hash.slice(0, 7)
}
