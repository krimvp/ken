// What an accepted answer adds to the project record: the piece of work it explains, with its statements and risks,
// the decisions it names, and its topics with a note each. Every entry goes through the record's own check first, and a
// refused entry rejects the whole answer, the same way a bad quote does. The record labels each decision from its
// reason's quotes, and checks each quote of a session again in the session itself.
//
// The draft rule lives here too. ken keeps snapshots of uncommitted work in its own store, which no collaborator has, so
// an answer that cites a commit the project's own git cannot find is a draft: it adds nothing to the project record,
// and the reader's history keeps it, decisions and all.
import { decisionLabel, gitQuotes, type Quote, type VerifiedQuote } from '../../checks/index.ts'
import { diagramDraft, diagramElements } from '../../diagram/index.ts'
import type { Decision, EntryDraft, EntryId, RecordEntry, RecordStore, Statement } from '../../record/index.ts'
import type { Repository } from '../../repo/index.ts'
import type { Answer } from './answer.ts'
import type { CheckedDecision } from './check-answer.ts'

export type RecordArgs = {
	work: { title: string } | null
	topics: { name: string; quotes: Quote[]; note: string; replaces: string | undefined }[]
}

// draft: the answer cites a commit only ken's store holds, so nothing was recorded and decisions are its decisions as
// ken checked and labelled them.
export type Recorded =
	| { kind: 'recorded'; entries: RecordEntry[]; kept: EntryId | null }
	| { kind: 'draft'; decisions: Decision[] }
	| { kind: 'refused'; problems: string[] }

// project reads the project's own git, never ken's snapshot store.
export async function recordAnswer(
	store: RecordStore,
	project: Repository,
	answer: Omit<Answer, 'topics'>,
	decisions: CheckedDecision[],
	args: RecordArgs,
	signal: AbortSignal,
): Promise<Recorded> {
	if (await citesUnshared(project, answer, decisions, signal)) {
		return { kind: 'draft', decisions: decisions.map(asDraft) }
	}
	const problems: string[] = []
	const pending: RecordEntry[] = []
	const drafts: EntryDraft[] = []
	const add = async (where: string, draft: EntryDraft) => {
		const checked = await store.check(draft, pending, signal)
		if (checked.kind === 'refused') {
			problems.push(...checked.problems.map((problem) => `${where}: ${problem}`))
			return null
		}
		pending.push(checked.entry)
		drafts.push(draft)
		return checked.entry
	}

	const range = answer.change && { base: answer.change.base, head: answer.change.head }
	// A range that already has a piece of work keeps it, so asking about the same change twice does not split it in two.
	const kept = range
		? ((await store.read()).current.find(
				(entry) => entry.kind === 'work' && entry.range.base === range.base && entry.range.head === range.head,
			)?.id ?? null)
		: null
	let work = kept
	if (args.work && !range) problems.push('Work: a piece of work needs a scope, the range of commits it covers.')
	if (args.work && range && !kept) {
		const claim = (s: Statement) => ({ text: s.text, label: s.label, quotes: s.quotes.map(raw) })
		const entry = await add('Work', {
			kind: 'work',
			title: args.work.title,
			summary: answer.summary,
			range,
			statements: answer.statements.map(claim),
			...(answer.risks === null ? {} : { risks: answer.risks.map(claim) }),
			diagrams: answer.diagrams.map(diagramDraft),
		})
		work = entry?.id ?? null
	}
	// Topics go first, so a decision can name a topic this answer adds.
	for (const [index, topic] of args.topics.entries()) {
		const where = `Topic ${index + 1}`
		const entry = await add(where, {
			kind: 'topic',
			name: topic.name,
			quotes: topic.quotes,
			replaces: topic.replaces,
		})
		if (entry) await add(`${where}, its note`, { kind: 'note', topic: entry.id, text: topic.note })
	}
	for (const [index, decision] of decisions.entries()) {
		await add(`Decision ${index + 1}`, {
			kind: 'decision',
			...decision,
			reason: { text: decision.reason.text, quotes: decision.reason.quotes.map(raw) },
			quotes: decision.quotes.map(raw),
			work,
		})
	}
	if (problems.length > 0) return { kind: 'refused', problems }

	const appended = await store.append(drafts, signal)
	if (appended.kind === 'refused') return appended
	const entries = appended.entries.filter((each) => each.written).map((each) => each.entry)
	return { kind: 'recorded', entries, kept: args.work ? kept : null }
}

async function citesUnshared(
	project: Repository,
	answer: Omit<Answer, 'topics'>,
	decisions: CheckedDecision[],
	signal: AbortSignal,
): Promise<boolean> {
	const claims = [...answer.statements, ...(answer.risks ?? [])]
	const quotes = [
		...claims.flatMap((claim) => claim.quotes),
		...decisions.flatMap((decision) => [...decision.reason.quotes, ...decision.quotes]),
		...answer.diagrams.flatMap((diagram) => diagramElements(diagram).flatMap((element) => element.quotes)),
	]
	const commits = new Set([
		...gitQuotes(quotes).map((quote) => quote.commit),
		...(answer.change ? [answer.change.base, answer.change.head] : []),
	])
	for (const commit of commits) {
		if ((await project.resolve(commit, signal)).kind !== 'ok') return true
	}
	return false
}

function asDraft(decision: CheckedDecision): Decision {
	const { topic, ...rest } = decision
	return {
		kind: 'decision',
		...rest,
		label: decisionLabel(decision.reason.quotes, false),
		work: null,
		topic: topic ?? null,
		answer: null,
	}
}

function raw(quote: VerifiedQuote): Quote {
	if ('session' in quote) return { session: quote.session, text: quote.text }
	return { path: quote.path, commit: quote.commit, text: quote.text, line: quote.startLine }
}
