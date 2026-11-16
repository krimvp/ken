import { decisionWork, type EntryId, type RecordEntry, type RecordRead } from '../record/index.ts'

// One row of the page's Decisions view: a current decision of the record, logged with ken decide or found by an
// answer, and the piece of work it belongs to. For a decision logged before its commits, decisionWork works that out
// on each read, so a piece of work added later takes it in.
export type DecisionRow = {
	decision: Extract<RecordEntry, { kind: 'decision' }>
	work: { id: EntryId; title: string } | null
}

// Newest first, by when ken wrote each one, since two clones' lines can merge out of order.
export function decisionRows(record: RecordRead): DecisionRow[] {
	const rows = record.current.flatMap((decision) => {
		if (decision.kind !== 'decision') return []
		const id = decisionWork(decision, record)
		const work = record.current.find((entry) => entry.id === id)
		return [{ decision, work: work?.kind === 'work' ? { id: work.id, title: work.title } : null }]
	})
	return rows.sort((a, b) => b.decision.at.localeCompare(a.decision.at))
}
