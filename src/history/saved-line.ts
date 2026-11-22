// The read boundary for history lines. A line saved before ken replied in words holds an "answer": a summary,
// statements, risks, diagrams and a closing note. This is the one place that knows that shape. It turns such a line
// into the reply the page and the terminal show now: the summary and the note become words, everything checked
// becomes a card, in the order the page showed them. ken does not check an old card again: it passed when it was saved.
import {
	briefCoverage,
	type Card,
	type Change,
	type Claim,
	type Item,
	type Reply,
	type Risk,
	type Step,
	unverifiedSource,
	type Withdrawn,
} from '../agent/index.ts'
import type { Decision, RecordEntry } from '../record/index.ts'
import type { HistoryEntry } from './history-entry.ts'

type Diagram = Extract<Card, { kind: 'diagram' }>['diagram']

type OldAnswer = {
	summary: string
	statements: Claim[]
	risks?: Risk[] | null
	topics?: string[]
	diagrams?: Diagram[]
	change: (Omit<Change, 'messages' | 'usedElsewhere' | 'stepHunks'> & Partial<Change>) | null
	leftOutPoints?: string[]
	withdrawn?: Withdrawn[]
}

const OUTCOMES = new Set([
	'answered',
	'unverified',
	'rejected',
	'no-answer',
	'incomplete',
	'partial',
	'out-of-turns',
	'stopped',
	'error',
])

// shortcut: checks only the fields the list of questions shows and trusts the rest of the line, because only add
// writes this file. Check every field if people start to edit it by hand. decisions are the record's entries, for
// the decisions an old answer stored there and named by id.
export function parseLine(line: string, decisions: RecordEntry[]): HistoryEntry | null {
	if (line.trim() === '') return null
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return null
	}
	if (!isObject(value)) return null
	const { id, question, askedAt, outcome, steps } = value
	const fine =
		typeof id === 'string' &&
		typeof question === 'string' &&
		typeof askedAt === 'string' &&
		typeof outcome === 'string' &&
		OUTCOMES.has(outcome) &&
		Array.isArray(steps)
	if (!fine) return null
	if (typeof value.head !== 'string') value.head = null
	if (typeof value.thread !== 'string') value.thread = null
	value.steps = steps.map(stepOf)
	// A question whose every answer ken rejected showed no reply, and its steps say why.
	if (outcome === 'rejected') value.outcome = 'no-answer'
	if (isObject(value.answer)) {
		const { answer, note, draft, recorded, ...rest } = value
		const named = Array.isArray(recorded) ? recorded : []
		const stored = decisions.flatMap((entry) => (entry.kind === 'decision' && named.includes(entry.id) ? [entry] : []))
		const kept = Array.isArray(draft) ? (draft as Decision[]) : []
		const reply = replyOf(answer as OldAnswer, typeof note === 'string' ? note : '', [...stored, ...kept])
		return { ...rest, outcome: 'answered', reply, recorded: named } as HistoryEntry
	}
	if (outcome === 'answered' || outcome === 'unverified' || outcome === 'partial') {
		const reply = value.reply
		if (!isObject(reply) || !Array.isArray(reply.items) || !strings(reply.topics)) return null
		if (reply.tour !== undefined || reply.answers !== undefined) {
			const { tour, answers } = reply
			if (
				tour !== undefined &&
				(!isObject(tour) ||
					!strings(tour.within) ||
					!Array.isArray(tour.stops) ||
					!tour.stops.every(
						(stop) =>
							isObject(stop) && typeof stop.name === 'string' && typeof stop.job === 'string' && strings(stop.paths),
					))
			)
				return null
			if (
				answers !== undefined &&
				(!isObject(answers) || typeof answers.concept !== 'string' || typeof answers.text !== 'string')
			)
				return null
			if (!reply.items.every(briefItem)) return null
		}
	}
	// A change saved before ken had walkthrough steps has none.
	const change = isObject(value.reply) ? value.reply.change : null
	if (isObject(change) && !Array.isArray(change.stepHunks)) change.stepHunks = []
	const entry = value as HistoryEntry
	if (entry.outcome === 'answered' && (entry.reply?.answers || entry.reply?.tour)) {
		const { reply, recorded: _recorded, ...base } = entry
		const { answers, tour } = reply
		const { outcome, missing } = briefCoverage(reply.items, tour?.stops.map((part) => part.name) ?? ['answer'])
		if (outcome === 'answered') return entry
		if (answers) return { ...base, outcome: 'incomplete', retry: { kind: 'answer', ...answers } }
		if (tour) {
			const retry = {
				kind: 'explain' as const,
				within: tour.within,
				part: tour.stops.length === 1 ? (tour.stops[0]?.name ?? null) : null,
			}
			return outcome === 'partial'
				? { ...entry, outcome: 'partial', reply: { ...reply, missingParts: missing }, retry }
				: { ...base, outcome: 'incomplete', retry }
		}
	}
	if (entry.outcome === 'answered' && unverifiedSource(entry.focus, entry.reply.items))
		return { ...entry, outcome: 'unverified' }
	return entry
}

function strings(value: unknown): boolean {
	return Array.isArray(value) && value.every((line) => typeof line === 'string')
}

function savedQuote(value: unknown): boolean {
	if (
		!isObject(value) ||
		typeof value.text !== 'string' ||
		!Number.isInteger(value.startLine) ||
		!Number.isInteger(value.endLine)
	)
		return false
	return (
		typeof value.session === 'string' ||
		(typeof value.commit === 'string' && (value.path === null || typeof value.path === 'string'))
	)
}

// The numbered steps and checked claims that older replies use as their brief.
function briefItem(value: unknown): boolean {
	if (!isObject(value)) return false
	if (value.kind === 'words') return typeof value.text === 'string'
	if (value.kind === 'step')
		return (
			Number.isInteger(value.number) &&
			typeof value.text === 'string' &&
			(value.questions === undefined || strings(value.questions))
		)
	const card = value.card
	if (value.kind !== 'card' || !isObject(card) || typeof card.kind !== 'string') return false
	const data = card[card.kind]
	if (!isObject(data)) return false
	if (card.kind !== 'topic' && card.kind !== 'claim') return true
	if (!Array.isArray(data.quotes) || !data.quotes.length || !data.quotes.every(savedQuote)) return false
	if (card.kind === 'topic') return typeof data.name === 'string'
	const point = data.point
	return (
		typeof data.text === 'string' &&
		(point === undefined ||
			(isObject(point) && typeof point.line === 'string' && typeof point.long === 'string' && isObject(point.drawing)))
	)
}

function stepOf(step: unknown): Step {
	if (isObject(step) && step.kind === 'rejected') {
		const problems = Array.isArray(step.problems) ? step.problems.map(String) : []
		return { kind: 'sent-back', what: `Answer ${step.attempt}`, problems }
	}
	return step as Step
}

// The page's old order: the summary, the diagrams, then for a change the risks, the decisions and what it did, and
// for any other question the decisions, the risks and the statements, then the withdrawn risks, the points left out,
// and the note. The decisions that need the owner come first.
function replyOf(old: OldAnswer, note: string, decisions: Decision[]): Reply {
	const card = (each: Card): Item => ({ kind: 'card', card: each })
	const words = (text: string): Item[] => (text.trim() === '' ? [] : [{ kind: 'words', text: text.trim() }])
	const risks = (old.risks ?? []).map((risk) => card({ kind: 'risk', risk: unmarked(risk) }))
	const ordered = [...decisions.filter((each) => each.needsOwner), ...decisions.filter((each) => !each.needsOwner)]
	const decided = ordered.map((decision) => card({ kind: 'decision', decision }))
	const claims = old.statements.map((claim) => card({ kind: 'claim', claim }))
	const left = old.leftOutPoints ?? []
	const items = [
		...words(old.summary),
		...(old.diagrams ?? []).map((diagram) => card({ kind: 'diagram', diagram })),
		...(old.change ? [...risks, ...decided, ...claims] : [...decided, ...risks, ...claims]),
		...(old.withdrawn ?? []).map((withdrawn) => card({ kind: 'withdrawn', withdrawn })),
		...words(left.length === 0 ? '' : `Left out, with no line to quote: ${left.join('; ')}.`),
		...words(note),
	]
	const change = old.change && { messages: null, usedElsewhere: null, stepHunks: [], ...old.change }
	return { items, change, topics: old.topics ?? [] }
}

// A risk saved before ken left the mark off a risk that quotes no file carries "Quotes only the changed lines", which
// says nothing true of it, so it reads with no mark.
function unmarked(risk: Risk): Risk {
	if (risk.quotes.some((quote) => !('session' in quote) && quote.path !== null)) return risk
	const { checked: _, ...rest } = risk
	return rest
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
