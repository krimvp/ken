import { randomUUID } from 'node:crypto'
import type { Answer, Chat, ChatEvent } from '../agent/index.ts'
import { withDrawings } from '../diagram/index.ts'
import { entryFrom, type History, type HistoryEntry } from '../history/index.ts'
import type { EntryId, RecordEntry, RecordRead, RecordStore } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'

// One row in the page's list of questions. hunks is null when the answer was not about a range of commits.
export type QuestionRow = {
	id: string
	question: string
	askedAt: string
	outcome: HistoryEntry['outcome']
	statements: number
	decisions: number
	hunks: { uncovered: number; total: number } | null
}

// An entry from the history, with the project record entries its answer stands on (see entriesOf). Its diagrams carry
// their drawings. head is the project's HEAD now, which the page compares with the entry's own.
export type QuestionView = { entry: HistoryEntry; recorded: RecordEntry[]; head: string | null }

// What the page receives while a question runs: each chat event, then the saved entry as the last line. An accepted
// answer's diagrams carry their drawings, and its recorded entries are the ones it stands on.
export type QuestionLine = ChatEvent | { kind: 'saved'; view: QuestionView }

// Runs the page's questions one at a time and keeps each in the reader's history, together with what it ended in.
export function questionDesk(history: History, record: RecordStore, repo: Repository) {
	let running: { stop: AbortSignal; done: Promise<void> } | null = null

	// A question the reader stopped can still be winding down. Wait for it, so the next request finds it in the history.
	async function settled() {
		while (running?.stop.aborted) await running.done
	}

	// Call busy right before ask, with no await between them, so two requests cannot both start a question.
	function busy() {
		return running !== null
	}

	async function ask(chat: Chat, question: string, stop: AbortSignal, send: (line: QuestionLine) => void) {
		let finish = () => {}
		running = { stop, done: new Promise((resolve) => (finish = resolve)) }
		try {
			const asked = { id: randomUUID(), question, askedAt: new Date().toISOString(), head: await headNow() }
			const events: ChatEvent[] = []
			for await (const event of chat.ask(question, stop)) {
				events.push(event)
				if (event.kind !== 'accepted') {
					send(event)
					continue
				}
				const added = event.recorded.map((stored) => stored.id)
				const recorded = entriesOf(event.answer, added, await record.read())
				send({ ...event, answer: withDrawings(event.answer), recorded })
			}
			const entry = entryFrom(asked, events, stop.aborted)
			await history.add(entry)
			send({ kind: 'saved', view: await viewOf(entry) })
		} finally {
			running = null
			finish()
		}
	}

	async function headNow(): Promise<string | null> {
		const resolved = await repo.resolve('HEAD')
		return resolved.kind === 'ok' ? resolved.commit : null
	}

	async function viewOf(entry: HistoryEntry): Promise<QuestionView> {
		const head = await headNow()
		if (entry.outcome !== 'answered') return { entry, recorded: [], head }
		const drawn = { ...entry, answer: withDrawings(entry.answer) }
		return { entry: drawn, recorded: entriesOf(entry.answer, entry.recorded, await record.read()), head }
	}

	async function rows(): Promise<QuestionRow[]> {
		await settled()
		const [entries, read] = await Promise.all([history.list(), record.read()])
		return entries.map((entry) => {
			const row = { id: entry.id, question: entry.question, askedAt: entry.askedAt, outcome: entry.outcome }
			if (entry.outcome !== 'answered') return { ...row, statements: 0, decisions: 0, hunks: null }
			const { statements, change } = entry.answer
			const total = change ? change.covered.length + change.uncovered.length : 0
			return {
				...row,
				statements: statements.length,
				decisions: entriesOf(entry.answer, entry.recorded, read).filter((stored) => stored.kind === 'decision').length,
				hunks: change && { uncovered: change.uncovered.length, total },
			}
		})
	}

	async function view(id: string): Promise<QuestionView | null> {
		const entry = (await history.list()).find((each) => each.id === id)
		return entry ? await viewOf(entry) : null
	}

	return { settled, busy, ask, rows, view }
}

// The record entries an answer stands on: the ones it added, and the current decisions of its piece of work. An answer
// about commits that already have a piece of work keeps it, so the decisions an earlier question found are not added
// again, and they would be missing from the answer if it showed only what it added.
function entriesOf(answer: Answer, added: EntryId[], record: RecordRead): RecordEntry[] {
	const range = answer.change
	const work =
		range &&
		record.current.find(
			(stored) => stored.kind === 'work' && stored.range.base === range.base && stored.range.head === range.head,
		)
	const own = record.entries.filter((stored) => added.includes(stored.id))
	const ofWork = work ? record.current.filter((stored) => stored.kind === 'decision' && stored.work === work.id) : []
	return [...own, ...ofWork.filter((stored) => !added.includes(stored.id))]
}
