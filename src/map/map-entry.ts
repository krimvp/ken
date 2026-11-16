// One line of the understanding map, as the plan names its parts: the topic, how deep the reader knows it, what showed
// it, the day, and the hash of the topic's quoted code that day. A person reads and types these lines, so each field
// is a plain word or a date, and a line is read the same way whoever wrote it.

export const DEPTHS = ['heard-of', 'can-follow', 'could-change'] as const
export type Depth = (typeof DEPTHS)[number]

// asked: a question named the topic. read: the reader read an answer on it and found it too much. said: the reader
// said "I know this". wrote: the reader wrote the code by hand. Only said and wrote mean the reader understands it.
export const EVIDENCE = ['asked', 'read', 'said', 'wrote'] as const
export type Evidence = (typeof EVIDENCE)[number]

// date is a day, such as 2026-11-16. hash is the topic's codeHash at HEAD that day: see topicCode in the record.
export type MapEntry = { topic: string; depth: Depth; evidence: Evidence; date: string; hash: string }

export type ParsedLine = { kind: 'ok'; entry: MapEntry } | { kind: 'skipped'; problem: string }

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
	const { topic, depth, evidence, date, hash } = value as Record<string, unknown>
	const knownDepth = DEPTHS.find((each) => each === depth)
	const knownEvidence = EVIDENCE.find((each) => each === evidence)
	if (typeof topic !== 'string' || topic.trim() === '') return { kind: 'skipped', problem: 'it names no topic' }
	if (!knownDepth) return { kind: 'skipped', problem: `its depth is not one of ${DEPTHS.join(', ')}` }
	if (!knownEvidence) return { kind: 'skipped', problem: `its evidence is not one of ${EVIDENCE.join(', ')}` }
	if (typeof date !== 'string' || !DAY.test(date) || Number.isNaN(Date.parse(date))) {
		return { kind: 'skipped', problem: 'its date is not a day such as 2026-11-16' }
	}
	if (typeof hash !== 'string' || hash.trim() === '') {
		return { kind: 'skipped', problem: 'it has no hash; copy the one ken map shows for the topic' }
	}
	return { kind: 'ok', entry: { topic: topic.trim(), depth: knownDepth, evidence: knownEvidence, date, hash } }
}

export function mapLine(entry: MapEntry): string {
	const { topic, depth, evidence, date, hash } = entry
	return JSON.stringify({ topic, depth, evidence, date, hash })
}
