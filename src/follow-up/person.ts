import type { TopicState } from '../map/index.ts'
import { type RecordRead, sameName, type Who } from '../record/index.ts'
import type { Commit, CommitHash } from '../repo/index.ts'
import { type ChangeCommit, changeCommit } from './open-items.ts'
import type { TimeRange } from './time-range.ts'

// A person or an agent as git names them, by email. by holds each "who did it" the record's rule gave their commits,
// such as "collaborator", or "owner-agent" and "unknown" for the owner's own email.
export type Author = { name: string; email: string; commits: number; by: Who[] }

export type KnownState = Extract<TopicState, { kind: 'unchanged' | 'changed' | 'long-ago' }>

// The lens "a person or agent": their commits in a range, newest first, and each topic the owner understood that those
// commits touched, with the commits that did. A topic the owner never met, or only asked about, is not listed.
export type PersonChanges = {
	author: Author
	range: TimeRange
	commits: ChangeCommit[]
	topics: { state: KnownState; commits: CommitHash[] }[]
}

// The authors of the commits, the one with the newest commit first.
export function authorsOf(commits: Commit[], userEmail: string | null): Author[] {
	const authors = new Map<string, Author>()
	for (const commit of commits) {
		const key = commit.email.toLowerCase()
		const author = authors.get(key) ?? { name: commit.author, email: commit.email, commits: 0, by: [] }
		const by = changeCommit(commit, userEmail).by
		authors.set(key, {
			...author,
			commits: author.commits + 1,
			by: author.by.includes(by) ? author.by : [...author.by, by],
		})
	}
	return [...authors.values()]
}

// The author the reader named: an email, or a part of a name or an email, in any case.
export function findAuthor(
	authors: Author[],
	named: string,
): { kind: 'ok'; author: Author } | { kind: 'refused'; problem: string } {
	const text = named.trim().toLowerCase()
	const exact = authors.find((author) => author.email.toLowerCase() === text)
	const found = exact
		? [exact]
		: authors.filter((author) => `${author.name} ${author.email}`.toLowerCase().includes(text))
	const [only] = found
	if (only && found.length === 1) return { kind: 'ok', author: only }
	const names = (list: Author[]) => list.map((author) => `${author.name} <${author.email}>`).join(', ')
	if (found.length > 1)
		return { kind: 'refused', problem: `"${named}" names ${found.length} authors: ${names(found)}. Give an email.` }
	const all = authors.length === 0 ? 'Nobody committed in that span.' : `The authors in that span: ${names(authors)}.`
	return { kind: 'refused', problem: `No commit in that span is by "${named}". ${all}` }
}

export function personChanges(
	range: TimeRange,
	author: Author,
	facts: { record: RecordRead; states: TopicState[]; userEmail: string | null },
): PersonChanges {
	const theirs = range.commits.filter((commit) => commit.email.toLowerCase() === author.email.toLowerCase())
	const topics = facts.record.current.flatMap((entry) => {
		if (entry.kind !== 'topic') return []
		const state = facts.states.find((each) => sameName(each.topic, entry.name))
		if (state?.kind !== 'unchanged' && state?.kind !== 'changed' && state?.kind !== 'long-ago') return []
		const files = entry.quotes.flatMap((quote) => quote.path ?? [])
		const touched = theirs.filter((commit) => commit.paths.some((path) => files.includes(path)))
		return touched.length === 0 ? [] : [{ state, commits: touched.map((commit) => commit.hash) }]
	})
	return { author, range, commits: theirs.map((commit) => changeCommit(commit, facts.userEmail)), topics }
}
