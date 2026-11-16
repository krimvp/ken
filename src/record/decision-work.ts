import type { Decision, EntryId, RecordEntry } from './entry.ts'
import type { RecordRead } from './file-record-store.ts'

// The piece of work a decision belongs to. A decision from an answer names it. A decision logged with ken decide while
// the work was still uncommitted cannot, so the piece of work whose range starts at, or passes through, the commit it
// was logged at adopts it: the code it is about came in the commits after that one. A range's last commit does not
// count, because its work was already done. When several pieces of work qualify, the one with the fewest commits is
// the closest to the task. Nothing is written: the tie is worked out on each read, so it holds for work added later.
export function decisionWork(decision: Decision, record: Pick<RecordRead, 'current'>): EntryId | null {
	const head = decision.logged?.head
	if (decision.work !== null || !head) return decision.work
	const covers = (entry: RecordEntry) =>
		entry.kind === 'work' &&
		head !== entry.range.head &&
		(head === entry.range.base || entry.commits.some((commit) => commit.hash === head))
	const size = (entry: RecordEntry) => (entry.kind === 'work' ? entry.commits.length : 0)
	const [closest] = record.current.filter(covers).sort((a, b) => size(a) - size(b))
	return closest?.id ?? null
}
