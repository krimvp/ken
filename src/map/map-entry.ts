// The personal map stores two kinds of line. Knowledge evidence is tied to the quoted code the reader knew that day.
// A reply-length preference applies to the topic across changes to its code.
import type { Topic } from '../record/index.ts'

export const DEPTHS = ['heard-of', 'can-follow', 'could-change'] as const
export type Depth = (typeof DEPTHS)[number]

// asked: a question named the topic. read: the reader read an answer on it and found it too much. said: the reader
// said "I know this". wrote: the reader wrote the code by hand. forgot: the reader said they do not know it any more.
// toured: the reader reached its stop on a tour of the project. Only said and wrote mean the reader understands it.
export const EVIDENCE = ['asked', 'read', 'said', 'wrote', 'forgot', 'toured'] as const
export type Evidence = (typeof EVIDENCE)[number]

// date is a day, such as 2026-11-16. hash is the topic's codeHash at HEAD that day: see topicCode in the record. quotes
// are the lines of a topic the record does not hold, such as one a reply kept in the reader's history, as that reply
// quoted them. A topic of the record has none, since the record holds its lines.
export type MapEntry = {
	topic: string
	depth: Depth
	evidence: Evidence
	date: string
	hash: string
	quotes?: Topic['quotes']
}

export type DetailEntry = { topic: string; detail: 'shorter' | 'usual'; date: string }
export type MapLine = MapEntry | DetailEntry
export type ParsedLine = { kind: 'ok'; entry: MapLine } | { kind: 'skipped'; problem: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function parseMapLine(line: string): ParsedLine {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return { kind: 'skipped', problem: 'it is not JSON' }
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { kind: 'skipped', problem: 'it is not a JSON object' }
	}
	const { topic, depth, evidence, date, hash, detail, quotes } = value as Record<string, unknown>
	const knownDepth = DEPTHS.find((each) => each === depth)
	const knownEvidence = EVIDENCE.find((each) => each === evidence)
	if (typeof topic !== 'string' || topic.trim() === '') return { kind: 'skipped', problem: 'it names no topic' }
	const day = typeof date === 'string' && DAY.test(date) && !Number.isNaN(Date.parse(date)) ? date : null
	const badDay = { kind: 'skipped', problem: 'its date is not a day such as 2026-11-16' } as const
	if (detail === 'shorter' || detail === 'usual') {
		return day === null ? badDay : { kind: 'ok', entry: { topic: topic.trim(), detail, date: day } }
	}
	if (!knownDepth) return { kind: 'skipped', problem: `its depth is not one of ${DEPTHS.join(', ')}` }
	if (!knownEvidence) return { kind: 'skipped', problem: `its evidence is not one of ${EVIDENCE.join(', ')}` }
	if (day === null) return badDay
	if (typeof hash !== 'string' || hash.trim() === '') {
		return { kind: 'skipped', problem: 'it has no hash; copy the one ken map shows for the topic' }
	}
	// Earlier versions raised the depth when the reader asked for less detail.
	if (knownEvidence === 'read') return { kind: 'ok', entry: { topic: topic.trim(), detail: 'shorter', date: day } }
	// An older "Go deeper" on a topic above heard-of copied its depth into an asked line.
	if (knownEvidence === 'asked' && knownDepth !== 'heard-of') {
		return { kind: 'ok', entry: { topic: topic.trim(), detail: 'usual', date: day } }
	}
	if (quotes !== undefined && !(Array.isArray(quotes) && quotes.every(isQuote))) {
		return { kind: 'skipped', problem: 'its quotes are not lines of files, each with a path, commit, lines and text' }
	}
	const level = knownEvidence === 'said' || knownEvidence === 'wrote' ? knownDepth : 'heard-of'
	const entry = { topic: topic.trim(), depth: level, evidence: knownEvidence, date: day, hash }
	return { kind: 'ok', entry: quotes === undefined ? entry : { ...entry, quotes } }
}

function isQuote(value: unknown): value is Topic['quotes'][number] {
	if (typeof value !== 'object' || value === null) return false
	const { path, commit, startLine, endLine, text } = value as Record<string, unknown>
	return (
		typeof path === 'string' &&
		typeof commit === 'string' &&
		Number.isSafeInteger(startLine) &&
		Number.isSafeInteger(endLine) &&
		typeof text === 'string'
	)
}
