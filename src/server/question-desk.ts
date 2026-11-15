import { randomUUID } from 'node:crypto'
import type { Chat, ChatEvent } from '../agent/index.ts'
import { withDrawings } from '../diagram/index.ts'
import { entryFrom, type History, type HistoryEntry } from '../history/index.ts'
import type { RecordEntry, RecordStore } from '../record/index.ts'

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

// An entry from the history, with the project record entries its answer added. Its diagrams carry their drawings.
export type QuestionView = { entry: HistoryEntry; recorded: RecordEntry[] }

// What the page receives while a question runs: each chat event, then the saved entry as the last line. An accepted
// answer's diagrams carry their drawings.
export type QuestionLine = ChatEvent | { kind: 'saved'; view: QuestionView }

// Runs the page's questions one at a time and keeps each in the reader's history, together with what it ended in.
export function questionDesk(history: History, record: RecordStore) {
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
			const asked = { id: randomUUID(), question, askedAt: new Date().toISOString() }
			const events: ChatEvent[] = []
			for await (const event of chat.ask(question, stop)) {
				events.push(event)
				send(event.kind === 'accepted' ? { ...event, answer: withDrawings(event.answer) } : event)
			}
			const entry = entryFrom(asked, events, stop.aborted)
			await history.add(entry)
			send({ kind: 'saved', view: await viewOf(entry) })
		} finally {
			running = null
			finish()
		}
	}

	async function viewOf(entry: HistoryEntry): Promise<QuestionView> {
		if (entry.outcome !== 'answered') return { entry, recorded: [] }
		const drawn = { ...entry, answer: withDrawings(entry.answer) }
		if (entry.recorded.length === 0) return { entry: drawn, recorded: [] }
		const { entries } = await record.read()
		return { entry: drawn, recorded: entries.filter((stored) => entry.recorded.includes(stored.id)) }
	}

	async function rows(): Promise<QuestionRow[]> {
		await settled()
		const [entries, { entries: recorded }] = await Promise.all([history.list(), record.read()])
		const decisions = new Set(recorded.filter((stored) => stored.kind === 'decision').map((stored) => stored.id))
		return entries.map((entry) => {
			const row = { id: entry.id, question: entry.question, askedAt: entry.askedAt, outcome: entry.outcome }
			if (entry.outcome !== 'answered') return { ...row, statements: 0, decisions: 0, hunks: null }
			const { statements, change } = entry.answer
			const total = change ? change.covered.length + change.uncovered.length : 0
			return {
				...row,
				statements: statements.length,
				decisions: entry.recorded.filter((id) => decisions.has(id)).length,
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
