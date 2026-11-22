// The gate in front of the project record. A writer hands in a draft, and this turns it into an entry or says what to
// fix: every text is present and short enough, every quote passes verifyQuote and is stored as verified, commits and
// authors are read from git and never taken from the writer, and every id an entry names is in the record. ken sets
// every decision's label: the writer has no say.
import {
	checkAbsent,
	decisionLabel,
	gitQuotes,
	type Label,
	type Quote,
	type QuoteSources,
	type VerifiedGitQuote,
	type VerifiedQuote,
	verifyGitQuote,
	verifyQuote,
} from '../checks/index.ts'
import { checkDiagram, checkLayout, type Diagram, type DiagramDraft, type LayoutDraft } from '../diagram/index.ts'
import { type CommitHash, type Repository, resolveRange } from '../repo/index.ts'
import {
	type Decision,
	type Entry,
	type EntryId,
	entryId,
	type Kind,
	type Note,
	type Outcome,
	type RecordEntry,
	type Topic,
	UNDO,
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
			risks?: { text: string; label: Label; quotes: Quote[] }[]
			diagrams?: DiagramDraft[]
	  } & Replaces)
	| ({
			kind: 'decision'
			question: string
			chosen: string
			// null only in the answer to a decision written before ken asked for reasons.
			reason: { text: string; quotes: Quote[] } | null
			rejected: { option: string; reason: string }[]
			// One of UNDO. ken decide passes what its caller typed, so the gate checks it.
			undo: string
			needsOwner: boolean
			quotes: Quote[]
			work: string | null
			// Only ken decide sends this. by is the name its caller gave, or null.
			logged?: { by: string | null }
			topic?: string | undefined
			answer?: { at: string; note: string | null; outcome: Outcome }
			// The text the decision says is missing, searched again at the commit it was searched at.
			absent?: { text: string; under: string | null; commit: string }
	  } & Replaces)
	| ({ kind: 'topic'; name: string; quotes: Quote[] } & Replaces)
	| ({ kind: 'note'; topic: string; text: string } & Replaces)
	| ({ kind: 'layout' } & LayoutDraft & Replaces)

export type EntryCheck =
	| { kind: 'ok'; entry: Entry; replaces: EntryId | null }
	| { kind: 'refused'; problems: string[] }

// Long enough for a plain answer, short enough that a model cannot pour a file into the record. show holds its cards
// to the same limits, so a card the reader sees is one the record can keep.
const MAX = {
	title: 120,
	summary: 1200,
	text: 1200,
	reason: 600,
	name: 80,
	note: 2000,
	option: 300,
	quotes: 12,
	list: 20,
}

export { MAX as RECORD_LIMITS }

// known is every entry in the record plus those an append will write before this one; current is the newest entry of
// each chain among them.
export async function checkEntry(
	sources: QuoteSources,
	record: { known: RecordEntry[]; current: RecordEntry[] },
	draft: EntryDraft,
	signal?: AbortSignal,
): Promise<EntryCheck> {
	const problems: string[] = []
	const text = (field: string, value: string, max: number) => {
		const problem = textProblem(field, value, max)
		if (problem) problems.push(problem)
		return value.trim()
	}
	const { repo } = sources
	const counted = (field: string, raw: Quote[], needed: boolean) => {
		if (needed && raw.length === 0) problems.push(`${field} needs at least one quote: the lines it rests on.`)
		if (raw.length > MAX.quotes) problems.push(`${field} has ${raw.length} quotes; keep it to ${MAX.quotes}.`)
	}
	const quotes = async (field: string, raw: Quote[], needed = true) => {
		counted(field, raw, needed)
		const verdicts = await Promise.all(raw.map((quote) => verifyQuote(sources, quote, signal)))
		return verdicts.flatMap((verdict, index): VerifiedQuote[] => {
			if (verdict.kind === 'verified') return [verdict.quote]
			problems.push(`${field}, quote ${index + 1}: ${verdict.problem}`)
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
	// A name, not an id, so it keeps naming the topic after a newer entry replaces it.
	const topicNamed = (name: string): string | null => {
		const found = record.current.find((other) => other.kind === 'topic' && sameName(other.name, name))
		if (found?.kind !== 'topic') problems.push(`topic names "${name}", which is not a topic in the record.`)
		return found?.kind === 'topic' ? found.name : null
	}

	let entry: Entry
	switch (draft.kind) {
		case 'work': {
			const work = await workFacts(repo, draft.range, signal)
			if (work.kind === 'refused') problems.push(work.problem)
			if (draft.statements.length === 0) problems.push('the piece of work needs at least one statement.')
			const claims = async (what: string, drafts: { text: string; label: Label; quotes: Quote[] }[]) => {
				if (drafts.length > MAX.list) problems.push(`keep the ${what}s to ${MAX.list}; there are ${drafts.length}.`)
				const checked = []
				for (const [index, claim] of drafts.slice(0, MAX.list).entries()) {
					const where = `${what} ${index + 1}`
					checked.push({
						text: text(where, claim.text, MAX.text),
						label: claim.label,
						quotes: await quotes(where, claim.quotes),
					})
				}
				return checked
			}
			const statements = await claims('statement', draft.statements)
			const risks = draft.risks === undefined ? null : await claims('risk', draft.risks)
			const diagrams: Diagram[] = []
			for (const [index, each] of (draft.diagrams ?? []).entries()) {
				const checked = await checkDiagram(repo, each, `Diagram ${index + 1}`, signal)
				if (checked.kind === 'refused') problems.push(...checked.problems)
				else diagrams.push(checked.diagram)
			}
			if (work.kind === 'refused') return { kind: 'refused', problems }
			entry = {
				kind: 'work',
				title: text('title', draft.title, MAX.title),
				summary: text('summary', draft.summary, MAX.summary),
				...work.facts,
				statements,
				risks,
				diagrams,
			} satisfies Work
			break
		}
		case 'decision': {
			if (draft.rejected.length > MAX.list) problems.push(`keep the rejected options to ${MAX.list}.`)
			const answered = record.known.find((other) => other.id === replaces)
			if (draft.answer && (answered?.kind !== 'decision' || !answered.needsOwner)) {
				problems.push('the decision does not wait on the owner, so it takes no answer.')
			}
			if (draft.reason === null && !draft.answer) problems.push('the decision needs a reason: why this option.')
			if (draft.answer?.outcome === 'change' && draft.answer.note === null) {
				problems.push('an answer that wants the decision changed says in its note what to change.')
			}
			const reasonQuotes = await quotes('the reason', draft.reason?.quotes ?? [], false)
			// An answer keeps the log of the decision it answers: who logged it and the commit checked out then are facts of
			// that decision, and reading HEAD again now would move it.
			const logged =
				draft.answer && answered?.kind === 'decision'
					? answered.logged
					: draft.logged && {
							by: draft.logged.by === null ? null : text('by', draft.logged.by, MAX.name),
							head: await headNow(repo, signal),
						}
			const absent = draft.absent && (await searched(repo, draft.absent, signal))
			if (absent?.kind === 'refused') problems.push(`the decision: ${absent.problem}`)
			const undo = UNDO.find((known) => known === draft.undo)
			const given = draft.undo.trim() === '' ? '' : `, not "${draft.undo}"`
			if (undo === undefined) problems.push(`say how easy it is to undo: easy, some-work or hard${given}.`)
			entry = {
				kind: 'decision',
				question: text('question', draft.question, MAX.option),
				chosen: text('chosen', draft.chosen, MAX.text),
				reason: draft.reason && { text: text('the reason', draft.reason.text, MAX.reason), quotes: reasonQuotes },
				rejected: draft.rejected.slice(0, MAX.list).map((rejected, index) => ({
					option: text(`rejected option ${index + 1}`, rejected.option, MAX.option),
					reason: text(`the reason for rejected option ${index + 1}`, rejected.reason, MAX.text),
				})),
				// An unknown undo is refused above, so this entry is never written.
				undo: undo ?? 'hard',
				// An answered decision no longer waits on the owner, whatever the draft says.
				needsOwner: draft.answer === undefined && draft.needsOwner,
				label: decisionLabel(reasonQuotes, logged !== undefined),
				...(logged && { logged }),
				// A decision logged as it is made often comes before the code it is about, so it may quote nothing.
				quotes: await quotes('the decision', draft.quotes, !logged),
				work: draft.work === null ? null : named('work', draft.work, 'work'),
				topic: draft.topic === undefined ? null : topicNamed(draft.topic),
				answer: draft.answer
					? {
							at: draft.answer.at,
							note: draft.answer.note === null ? null : text("the owner's note", draft.answer.note, MAX.text),
							outcome: draft.answer.outcome,
						}
					: null,
				...(absent?.kind === 'absent' && { absent: absent.absence }),
			} satisfies Decision
			break
		}
		case 'topic': {
			// A note goes stale when its topic's lines change at HEAD, and a commit message or a session never changes, so
			// a topic quotes files only.
			if (draft.quotes.some((quote) => 'session' in quote || quote.path === null)) {
				problems.push(
					'the topic quotes a commit message or a saved session. A topic rests on lines of files: give each quote its path.',
				)
			}
			counted('the topic', draft.quotes, true)
			const verdicts = await Promise.all(gitQuotes(draft.quotes).map((quote) => verifyGitQuote(repo, quote, signal)))
			const topic: Topic = {
				kind: 'topic',
				name: text('name', draft.name, MAX.name),
				quotes: verdicts.flatMap((verdict, index): VerifiedGitQuote[] => {
					if (verdict.kind === 'verified') return [verdict.quote]
					problems.push(`the topic, quote ${index + 1}: ${verdict.problem}`)
					return []
				}),
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
		case 'layout': {
			const checked = await checkLayout(repo, draft, { where: 'the layout', needsAbout: false }, signal)
			if (checked.kind === 'refused') return checked
			entry = checked.layout
			break
		}
		default:
			return draft satisfies never
	}
	return problems.length > 0 ? { kind: 'refused', problems } : { kind: 'ok', entry, replaces }
}

export function textProblem(field: string, value: string, max: number): string | null {
	const trimmed = value.trim()
	if (trimmed === '') return `${field} is empty.`
	if (trimmed.length > max) return `${field} has ${trimmed.length} characters; keep it under ${max}.`
	return null
}

async function searched(
	repo: Repository,
	absent: { text: string; under: string | null; commit: string },
	signal?: AbortSignal,
) {
	const commit = await repo.resolve(absent.commit, signal)
	if (commit.kind !== 'ok')
		return { kind: 'refused', problem: `absent names "${absent.commit}", which is not a commit.` } as const
	return await checkAbsent(repo, commit.commit, absent, signal)
}

async function headNow(repo: Repository, signal?: AbortSignal): Promise<CommitHash | null> {
	const head = await repo.resolve('HEAD', signal)
	return head.kind === 'ok' ? head.commit : null
}

export function sameName(a: string, b: string): boolean {
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
