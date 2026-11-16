import { decisionWork, type EntryId, type RecordEntry, type RecordRead, sameName } from '../record/index.ts'

// One row of the page's Decisions view: a current decision of the record, logged with ken decide or found by an
// answer, and the piece of work it belongs to. For a decision logged before its commits, decisionWork works that out
// on each read, so a piece of work added later takes it in. replacedBy names the newest decision on the same question
// when this one is older: two notes on two commits can each find a decision on one question, and the later stands.
export type DecisionRow = {
	decision: Extract<RecordEntry, { kind: 'decision' }>
	work: { id: EntryId; title: string } | null
	replacedBy: EntryId | null
}

// Newest first, by when ken wrote each one, since two clones' lines can merge out of order.
export function decisionRows(record: RecordRead): DecisionRow[] {
	const rows = record.current.flatMap((decision) => {
		if (decision.kind !== 'decision') return []
		const id = decisionWork(decision, record)
		const work = record.current.find((entry) => entry.id === id)
		return [{ decision, work: work?.kind === 'work' ? { id: work.id, title: work.title } : null, replacedBy: null }]
	})
	rows.sort((a, b) => b.decision.at.localeCompare(a.decision.at))
	return rows.map((row) => {
		const newest = rows.find((other) => sameName(other.decision.question, row.decision.question))
		return newest === undefined || newest === row ? row : { ...row, replacedBy: newest.decision.id }
	})
}
