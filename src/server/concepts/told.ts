// What ken's model has told this reader about a concept, found among their saved replies with no model: the brief of
// a part, and the answers to questions about a concept. A reply saved while ken still gave tours explains its parts
// too, as a paragraph and a card or two for each stop, and reads here as a brief of what it kept.
import type { Claim, Drawing, Item, Reply } from '../../agent/index.ts'
import type { HistoryEntry } from '../../history/index.ts'
import { sameName, topicCode } from '../../record/index.ts'
import type { CommitHash, Repository } from '../../repo/index.ts'
import { questionId } from './concept.ts'

export type BriefQuote = { path: string; commit: CommitHash; startLine: number; endLine: number; text: string }

// A thing to know as the page gets it: line in at most ten words, more in one sentence, long in two or three.
export type BriefPoint = { line: string; more: string; long: string; drawing: Drawing; quotes: BriefQuote[] }

// line is the brief's own one line, null when the reply kept none for it. terms are names of topics in the record.
export type Told = { line: string | null; points: BriefPoint[]; terms: string[]; questions: string[] }

// Quotes already checked at this commit still match. A tour can quote the same line in more than one point.
export async function staleFiles(repo: Repository, head: CommitHash | undefined, quotes: BriefQuote[]) {
	const older = new Map<string, BriefQuote>()
	for (const quote of quotes) {
		if (quote.commit !== head) older.set(JSON.stringify([quote.path, quote.text]), quote)
	}
	if (older.size === 0) return undefined
	const { gone } = await topicCode(repo, { quotes: [...older.values()] }, undefined, head)
	return gone.length ? [...new Set(gone.flatMap((quote) => quote.path ?? []))] : undefined
}

type Answered = Extract<HistoryEntry, { outcome: 'answered' }>

// Newest first, live notes left out: a note explains a change, never a concept.
export function answeredOf(history: HistoryEntry[]): Answered[] {
	return history
		.flatMap((entry) => (entry.outcome === 'answered' && entry.about === undefined ? [entry] : []))
		.reverse()
}

// The newest reply that explains the part, by the level it was asked for and the part's name. A reply that sent
// nothing to know for the part does not explain it, so an older one that did still stands.
export function toldOfPart(answered: Answered[], within: string[], name: string): Told | null {
	for (const { reply } of answered) {
		const { tour } = reply
		if (!tour || tour.within.join('\n') !== within.join('\n')) continue
		const stop = tour.stops.findIndex((each) => sameName(each.name, name))
		const told = stop === -1 ? null : toldAt(reply, stop + 1)
		if (told && told.points.length > 0) return told
	}
	return null
}

// A question about a concept with its answer, as the reply to it holds them.
export type Answer = { id: string; concept: string; text: string; entry: string; told: Told }

// Every answered question about any concept, newest first, the newest answer to each question only.
export function answersOf(answered: Answered[]): Answer[] {
	const answers = answered.flatMap(({ id: entry, reply }) => {
		const told = reply.answers ? toldAt(reply, 1) : null
		if (!reply.answers || !told || told.points.length === 0) return []
		const { concept, text } = reply.answers
		return [{ id: questionId(concept, text), concept, text, entry, told }]
	})
	return answers.filter((answer, at) => answers.findIndex((other) => other.id === answer.id) === at)
}

// What the reply holds under one number: the step and the cards that carry it.
function toldAt(reply: Reply, number: number): Told | null {
	const step = reply.items.find((item) => item.kind === 'step' && item.number === number)
	const cards = reply.items.flatMap((item) => (item.kind === 'card' && item.step === number ? [item.card] : []))
	const claims = cards.flatMap((card) => (card.kind === 'claim' ? [card.claim] : []))
	const terms = cards.flatMap((card) => (card.kind === 'topic' ? [card.topic.name] : []))
	if (step?.kind !== 'step') return null
	const points = claims.flatMap((claim) => (claim.point ? [pointOf(claim, claim.point)] : []))
	// Only a brief keeps questions, so a step with them is a brief even when none of its things to know passed.
	if (points.length > 0 || step.questions) return { line: step.text, points, terms, questions: step.questions ?? [] }
	return { line: null, points: fromTour(step.text, claims), terms: namedBy(reply.items, number), questions: [] }
}

function pointOf(claim: Claim, point: NonNullable<Claim['point']>): BriefPoint {
	return {
		line: point.line,
		more: claim.text,
		long: point.long,
		drawing: point.drawing,
		quotes: fileQuotes(claim.quotes),
	}
}

// A tour stop kept a paragraph and one or two cards. The paragraph is the first thing to know, resting on the lines
// of its cards, as the tour showed it. Each card is one more. A line is a whole sentence as the model wrote it, never
// cut to ten words: plain code cannot tell whether a shorter one would still be true. A stop none of whose cards
// passed has nothing ken checked, so it explains nothing.
function fromTour(text: string, claims: Claim[]): BriefPoint[] {
	if (claims.length === 0) return []
	const dot: Drawing = { kind: 'dot' }
	const stop = { line: firstSentence(text), more: firstSentence(text), long: text.trim(), drawing: dot }
	return [
		{ ...stop, quotes: claims.flatMap((claim) => fileQuotes(claim.quotes)) },
		...claims.map((claim) => ({
			line: firstSentence(claim.text),
			more: claim.text.trim(),
			long: claim.text.trim(),
			drawing: dot,
			quotes: fileQuotes(claim.quotes),
		})),
	]
}

function namedBy(items: Item[], number: number): string[] {
	const names = items.flatMap((item) =>
		item.kind === 'card' && item.step === number && item.card.kind === 'claim' && item.card.claim.topic
			? [item.card.claim.topic]
			: [],
	)
	return [...new Set(names)]
}

// Up to the first full stop, question mark or exclamation mark that ends a word. "src/engine.ts" holds none.
function firstSentence(text: string): string {
	return /^.*?[.!?](?=\s|$)/s.exec(text.trim())?.[0] ?? text.trim()
}

// The lines of files a statement rests on. A quote of a commit message or of a saved session has no file to open.
export function fileQuotes(quotes: Claim['quotes']): BriefQuote[] {
	return quotes.flatMap((quote) => {
		if ('session' in quote || quote.path === null) return []
		const { path, commit, startLine, endLine, text } = quote
		return [{ path, commit, startLine, endLine, text }]
	})
}
