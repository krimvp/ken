// The questions slice 6 writes for the agent, each a line the reader asks and ken's list under it, as the lenses of
// slice 4 do: the list speaks to the reader, and LIST_SAID tells the model who "you" is. The page and the terminal
// show the list before the agent explains it. empty says the list holds nothing to explain, so ken does not ask the
// agent at all.
import { LIST_SAID, linesText, type TopicState } from '../map/index.ts'
import type { RecordRead, Who } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import type { ChangeCommit, OpenItems, OpenTopic } from './open-items.ts'
import { authorsOf, findAuthor, type PersonChanges, personChanges } from './person.ts'
import { type Since, sinceOf, type TimeRange, timeRange } from './time-range.ts'
import { at, onDay } from './when.ts'

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
	owner: 'you',
	'owner-agent': 'your coding agent',
	collaborator: 'a collaborator',
	unknown: 'git cannot tell who',
}

export function openQuestion(open: OpenItems): LensQuestion {
	const decisions = open.decisions.map(
		(d) =>
			`- A decision needs your call: ${d.question} What was chosen: "${d.chosen}" It is decision ${d.id} in the record.`,
	)
	const topics = open.topics.map(
		({ state, commits }) =>
			`- ${state.topic} changed since you understood it ${onDay(state.entry.date)}: ${state.changed.map(linesText).join(', ')}. ${commitsSaid(commits)}`,
	)
	const list = [...decisions, ...topics]
	if (list.length === 0) {
		const none = '- Nothing is open: no decision waits on you, and no topic you understood has changed since.'
		return { text: ['What is open for me in this project?', LIST_SAID, none].join('\n'), empty: true }
	}
	return { text: ['What is open for me in this project?', LIST_SAID, ...list].join('\n'), empty: false }
}

// "Explain what changed" on one topic of the open list.
export function topicQuestion({ state, commits }: OpenTopic): LensQuestion {
	return {
		text: [
			`What changed in ${state.topic} since I understood it ${onDay(state.entry.date)}?`,
			LIST_SAID,
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
					...commits.slice(0, MAX_LISTED).map((c) => `- ${short(c.hash)} ${at(c.date)}: ${c.subject}`),
					...(commits.length > MAX_LISTED ? [`- and ${commits.length - MAX_LISTED} older ones`] : []),
					...(range.fromFirst ? [fromFirst(range)] : []),
				]
	const known = topics.map(
		({ state, commits: touched }) =>
			`- You understood ${state.topic} ${onDay(state.entry.date)}. ${author.name}'s ${touched.map(short).join(', ')} touched its files, and ${state.kind === 'unchanged' || state.changed.length === 0 ? 'its quoted lines are as you knew them' : `its code changed since: ${state.changed.map(linesText).join(', ')}`}.`,
	)
	return {
		text: [
			`What did ${author.name} change in the topics I know, ${when}?`,
			LIST_SAID,
			...made,
			...(known.length > 0 ? known : commits.length > 0 ? ['- None of their commits touched a topic you know.'] : []),
		].join('\n'),
		empty: known.length === 0,
	}
}

// The lens "a time range". The agent reads the record's pieces of work first, as its prompt says.
export function rangeQuestion(range: TimeRange, record: RecordRead, userEmail: string | null): LensQuestion {
	const when = sinceWords(range.since)
	if (range.commits.length === 0) {
		return { text: [`What happened ${when}?`, LIST_SAID, `- No commit landed ${when}.`].join('\n'), empty: true }
	}
	const authors = authorsOf(range.commits, userEmail)
	const inRange = new Set<string>(range.commits.map((commit) => commit.hash))
	const work = record.current.flatMap((entry) =>
		entry.kind === 'work' && entry.commits.some((commit) => inRange.has(commit.hash)) ? [entry] : [],
	)
	return {
		text: [
			`What happened ${when}, from ${short(range.base)} to ${short(range.head)}?`,
			LIST_SAID,
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

// "Ask ken to name these parts" and "Name them again" in the Project view. The level as the reader sees it now is the
// starting point, and the rules are those show's layout is checked against, so the model can pass the check first time.
// name is what the reader calls the level, such as the part they opened, or null for the whole project.
export type PartsLevel = {
	name: string | null
	within: string[]
	head: string
	bounds: { fewest: number; parts: number; arrows: number }
	boxes: { name: string; paths: string[]; files: number; job: string | null; state: 'same' | 'changed' | 'gone' }[]
	named: { drawnAt: string; added: string[] } | null
	loose: string[]
}

export function partsQuestion(level: PartsLevel): LensQuestion {
	const { within, head, bounds, boxes, named } = level
	const where = level.name ?? (within.length === 0 ? 'this project' : within.join(', '))
	const box = (each: PartsLevel['boxes'][number]) =>
		`${each.name} (${each.paths.join(', ')}, ${each.files === 1 ? '1 file' : `${each.files} files`})${each.job ? `: ${each.job}` : ''}`
	const changed = boxes.filter((each) => each.state !== 'same').map((each) => each.name)
	const moved = [
		...(changed.length > 0 ? [`${changed.join(', ')} changed since then`] : []),
		...(named && named.added.length > 0 ? [`${named.added.join(', ')} is new and in no part`] : []),
	]
	const shown = named
		? [
				`- ken's model named these parts at ${short(named.drawnAt)}: ${boxes.map(box).join('; ')}.`,
				...(moved.length > 0 ? [`- Since then: ${moved.join('; ')}.`] : []),
			]
		: [`- ken splits it by folder now: ${boxes.map(box).join('; ')}.`]
	return {
		text: [
			`${named ? 'Name again' : 'Name'} the main parts of ${where}`,
			LIST_SAID,
			...shown,
			...(level.loose.length > 0 ? [`- In no part now: ${level.loose.join(', ')}.`] : []),
			'',
			`Read the code at HEAD (${head}), then call show with layout, and within set to ${JSON.stringify(within)}.`,
			`Group the paths into ${bounds.fewest} to ${bounds.parts} parts the owner would name. Give each a short name, one line of about 80 characters on its job, and the folders or files it holds, each inside within. No two parts share a file. Leave out what is not code if it does not help, such as docs; ken lists it as in no part.`,
			`Add at most ${bounds.arrows} arrows for which part uses which, each with a short verb. Each arrow quotes lines from a file of the part it starts at that name a folder or file of the part it ends at: an import line does, a comment does not. Leave out an arrow you cannot quote that way.`,
			'Then say in two or three sentences how the parts fit together.',
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
	return `- ${short(commit.hash)} by ${commit.author} (${WHO[commit.by]}) ${at(commit.date)}: ${commit.subject}`
}

function count(commits: number): string {
	return commits === 1 ? '1 commit' : `${commits} commits`
}

function short(hash: string): string {
	return hash.slice(0, 7)
}
