// The gate in front of the project record. A writer hands in a draft, and this turns it into an entry or says what to
// fix: every text is present and short enough, every quote passes checkQuote and is stored as verified, commits and
// authors are read from git and never taken from the writer, and every id an entry names is in the record.
import { checkQuote, explainQuote, type Label, type Quote, type VerifiedQuote } from '../checks/index.ts'
import { checkDiagrams, type DiagramDraft } from '../diagram/index.ts'
import { type Repository, resolveRange } from '../repo/index.ts'
import {
	type Decision,
	type Entry,
	type EntryId,
	entryId,
	type Kind,
	type Note,
	type RecordEntry,
	type Topic,
	type Undo,
	type Work,
} from './entry.ts'
import { codeHash } from './note-freshness.ts'
import { whoDidIt } from './who-did-it.ts'

type Replaces = { replaces?: string | undefined }

export type EntryDraft =
	| ({
			kind: 'work'
			title: string
			summary: string
			range: { base: string; head: string }
			statements: { text: string; label: Label; quotes: Quote[] }[]
			diagrams?: DiagramDraft[]
	  } & Replaces)
	| ({
			kind: 'decision'
			question: string
			chosen: string
			rejected: { option: string; reason: string }[]
			undo: Undo
			needsOwner: boolean
			label: Decision['label']
			quotes: Quote[]
			work: string | null
	  } & Replaces)
	| ({ kind: 'topic'; name: string; quotes: Quote[] } & Replaces)
	| ({ kind: 'note'; topic: string; text: string } & Replaces)

export type EntryCheck =
	| { kind: 'ok'; entry: Entry; replaces: EntryId | null }
	| { kind: 'refused'; problems: string[] }

// Long enough for a plain answer, short enough that a model cannot pour a file into the record.
const MAX = { title: 120, summary: 1200, text: 1200, name: 80, note: 2000, option: 300, quotes: 12, list: 20 }

// known is every entry in the record plus those an append will write before this one; current is the newest entry of
// each chain among them.
export async function checkEntry(
	repo: Repository,
	record: { known: RecordEntry[]; current: RecordEntry[] },
	draft: EntryDraft,
	signal?: AbortSignal,
): Promise<EntryCheck> {
	const problems: string[] = []
	const text = (field: string, value: string, max: number) => {
		const trimmed = value.trim()
		if (trimmed === '') problems.push(`${field} is empty.`)
		else if (trimmed.length > max) problems.push(`${field} has ${trimmed.length} characters; keep it under ${max}.`)
		return trimmed
	}
	const quotes = async (field: string, raw: Quote[]) => {
		if (raw.length === 0) problems.push(`${field} needs at least one quote: the lines it rests on.`)
		if (raw.length > MAX.quotes) problems.push(`${field} has ${raw.length} quotes; keep it to ${MAX.quotes}.`)
		const checks = await Promise.all(raw.map((quote) => checkQuote(repo, quote, signal)))
		return checks.flatMap((check, index): VerifiedQuote[] => {
			if (check.kind === 'verified') return [check.quote]
			const quote = raw[index]
			problems.push(
				`${field}, quote ${index + 1} (${quote?.path} at ${quote?.commit}): ${explainQuote(check, quote?.text ?? '')}`,
			)
			return []
		})
	}
	const named = (field: string, id: string, kind: Kind): EntryId | null => {
		const found = record.known.find((entry) => entry.id === id)
		if (!found) problems.push(`${field} names "${id}", which is not in the record.`)
		else if (found.kind !== kind) problems.push(`${field} names "${id}", which is a ${found.kind}, not a ${kind}.`)
		return found?.id ?? null
	}
	const replaces = draft.replaces === undefined ? null : named('replaces', draft.replaces, draft.kind)

	let entry: Entry
	switch (draft.kind) {
		case 'work': {
			const work = await workFacts(repo, draft.range, signal)
			if (work.kind === 'refused') problems.push(work.problem)
			if (draft.statements.length === 0) problems.push('the piece of work needs at least one statement.')
			const statements = []
			for (const [index, statement] of draft.statements.slice(0, MAX.list).entries()) {
				const where = `statement ${index + 1}`
				statements.push({
					text: text(where, statement.text, MAX.text),
					label: statement.label,
					quotes: await quotes(where, statement.quotes),
				})
			}
			const diagrams = await checkDiagrams(repo, draft.diagrams ?? [], signal)
			if (diagrams.kind === 'refused') problems.push(...diagrams.problems)
			if (work.kind === 'refused') return { kind: 'refused', problems }
			entry = {
				kind: 'work',
				title: text('title', draft.title, MAX.title),
				summary: text('summary', draft.summary, MAX.summary),
				...work.facts,
				statements,
				diagrams: diagrams.kind === 'ok' ? diagrams.diagrams : [],
			} satisfies Work
			break
		}
		case 'decision': {
			if (draft.rejected.length > MAX.list) problems.push(`keep the rejected options to ${MAX.list}.`)
			entry = {
				kind: 'decision',
				question: text('question', draft.question, MAX.option),
				chosen: text('chosen', draft.chosen, MAX.text),
				rejected: draft.rejected.slice(0, MAX.list).map((rejected, index) => ({
					option: text(`rejected option ${index + 1}`, rejected.option, MAX.option),
					reason: text(`the reason for rejected option ${index + 1}`, rejected.reason, MAX.text),
				})),
				undo: draft.undo,
				needsOwner: draft.needsOwner,
				label: draft.label,
				quotes: await quotes('the decision', draft.quotes),
				work: draft.work === null ? null : named('work', draft.work, 'work'),
			} satisfies Decision
			break
		}
		case 'topic': {
			const topic: Topic = {
				kind: 'topic',
				name: text('name', draft.name, MAX.name),
				quotes: await quotes('the topic', draft.quotes),
			}
			const id = entryId(topic, replaces)
			const same = record.current.find(
				(other) =>
					other.kind === 'topic' && other.id !== id && other.id !== replaces && sameName(other.name, topic.name),
			)
			if (same) {
				problems.push(
					`the topic "${topic.name}" is already in the record as ${same.id}. Reuse it: leave it out if its note is still right, or send it with replaces "${same.id}" and quotes read at HEAD to update it.`,
				)
			}
			entry = topic
			break
		}
		case 'note': {
			const topic = record.known.find((other) => other.id === draft.topic)
			const note = text('the note', draft.text, MAX.note)
			if (topic?.kind !== 'topic') {
				problems.push(`topic names "${draft.topic}", which is not a topic in the record.`)
				return { kind: 'refused', problems }
			}
			entry = { kind: 'note', topic: topic.id, text: note, codeHash: codeHash(topic.quotes) } satisfies Note
			break
		}
		default:
			return draft satisfies never
	}
	return problems.length > 0 ? { kind: 'refused', problems } : { kind: 'ok', entry, replaces }
}

function sameName(a: string, b: string): boolean {
	const normal = (name: string) =>
		name
			.toLowerCase()
			.replaceAll(/[\s_-]+/g, ' ')
			.trim()
	return normal(a) === normal(b)
}

async function workFacts(
	repo: Repository,
	refs: { base: string; head: string },
	signal?: AbortSignal,
): Promise<
	{ kind: 'ok'; facts: Pick<Work, 'range' | 'commits' | 'first' | 'last'> } | { kind: 'refused'; problem: string }
> {
	const resolved = await resolveRange(repo, refs, signal)
	if (resolved.kind !== 'ok')
		return { kind: 'refused', problem: `the range ${refs.base}..${refs.head} does not resolve.` }
	const logged = await repo.log(resolved.range, signal)
	if (logged.kind === 'too-large') return { kind: 'refused', problem: 'the range is too large to read.' }
	if (logged.commits.length === 0) return { kind: 'refused', problem: 'the range holds no commits.' }
	const userEmail = await repo.userEmail(signal)
	const dates = logged.commits.map((commit) => commit.date).sort()
	return {
		kind: 'ok',
		facts: {
			range: resolved.range,
			commits: logged.commits.map((commit) => ({ hash: commit.hash, by: whoDidIt(commit, userEmail) })),
			first: dates[0] ?? '',
			last: dates.at(-1) ?? '',
		},
	}
}
