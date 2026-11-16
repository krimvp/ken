// The four kinds of entry in the project record, as the plan names them: a piece of work, a decision, a topic and a
// note. An entry holds only checked facts. Its quotes passed checkQuote, and its commits and authors come from git.
import { createHash } from 'node:crypto'
import type { Label, VerifiedQuote } from '../checks/index.ts'
import type { Diagram } from '../diagram/index.ts'
import type { Range } from '../repo/index.ts'

// A short hash of the entry's content, so the same entry written twice has the same id.
export type EntryId = string & { readonly __brand: 'EntryId' }

export type Statement = { text: string; label: Label; quotes: VerifiedQuote[] }

// Git tells the owner from a collaborator by the author's email. It cannot tell the owner from the owner's agent
// without evidence such as a Co-authored-by trailer, so git alone never yields "owner": see whoDidIt.
export type Who = 'owner' | 'owner-agent' | 'collaborator' | 'unknown'

export const UNDO = ['easy', 'some-work', 'hard'] as const
export type Undo = (typeof UNDO)[number]

// The accepted answer that explained the work is kept as its summary, statements, risks and diagrams, so it can be
// shown again without a model. risks is null in a piece of work written before ken asked for them. first and last are
// the dates of the oldest and newest commit.
export type Work = {
	kind: 'work'
	title: string
	summary: string
	range: Range
	commits: { hash: string; by: Who }[]
	first: string
	last: string
	statements: Statement[]
	risks: Statement[] | null
	diagrams: Diagram[]
}

// reason is why the option was chosen, with the lines it rests on, kept apart from quotes, which show what was chosen.
// It is null in a decision written before ken asked for one. ken sets the label from the reason's quotes (see
// decisionLabel), never the writer. A decision says why, which is never a relation found by searching, so it is never
// "found-by-search". Slice 5 adds decisions a coding agent logs as it makes them, also "recorded". topic names the
// topic the decision belongs to, as the record names it, or is null. answer is the owner's "I have decided" on a decision
// that needed them: when, and their note. ken writes it as a new entry that replaces the old one with the same content.
export type Decision = {
	kind: 'decision'
	question: string
	chosen: string
	reason: { text: string; quotes: VerifiedQuote[] } | null
	rejected: { option: string; reason: string }[]
	undo: Undo
	needsOwner: boolean
	label: Exclude<Label, 'found-by-search'>
	quotes: VerifiedQuote[]
	work: EntryId | null
	topic: string | null
	answer: { at: string; note: string | null } | null
}

export type Topic = { kind: 'topic'; name: string; quotes: VerifiedQuote[] }

// codeHash is a hash over the topic's quoted lines when the note was written. See noteFreshness.
export type Note = { kind: 'note'; topic: EntryId; text: string; codeHash: string }

export type Entry = Work | Decision | Topic | Note
export type Kind = Entry['kind']

// What the store holds. at is when ken wrote the entry and is not part of the id. replaces names the entry this one
// corrects; the old entry stays readable.
export type RecordEntry = Entry & { id: EntryId; at: string; replaces: EntryId | null }

// The id hashes the content and the entry it replaces, with keys in a fixed order, and leaves out at. So writing the
// same entry again gives the same id, and the store keeps one copy.
export function entryId(entry: Entry, replaces: EntryId | null): EntryId {
	return contentId({ ...entry, replaces })
}

// The store also hashes each line it reads, to find lines that were not written through append.
export function contentId(content: unknown): EntryId {
	return createHash('sha256').update(canonical(content)).digest('hex').slice(0, 12) as EntryId
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value === 'object' && value !== null) {
		const pairs = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${pairs.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
	}
	return JSON.stringify(value)
}
