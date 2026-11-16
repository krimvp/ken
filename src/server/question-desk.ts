import { randomUUID } from 'node:crypto'
import type { Answer, Chat, ChatEvent } from '../agent/index.ts'
import { withDrawings } from '../diagram/index.ts'
import { type LensFacts, openItems, personLens, rangeLens, topicQuestion } from '../follow-up/index.ts'
import { entryFrom, type History, type HistoryEntry } from '../history/index.ts'
import { areaQuestion, catchUpQuestion, deeperQuestion, type TopicState, type UnderstandingMap } from '../map/index.ts'
import { type EntryId, type RecordEntry, type RecordRead, type RecordStore, sameName } from '../record/index.ts'
import { parsePath, type Repository } from '../repo/index.ts'

const MAX_QUESTION_CHARS = 4000
const MAX_TOPICS = 20

// One row in the page's list of questions. calls counts the decisions the agent wants the reader to decide. risks is
// null when the answer did not look for risks, and hunks when it was not about a range of commits.
export type QuestionRow = {
	id: string
	question: string
	askedAt: string
	outcome: HistoryEntry['outcome']
	statements: number
	decisions: number
	calls: number
	risks: number | null
	hunks: { uncovered: number; total: number } | null
}

// An entry from the history, with the project record entries its answer stands on (see entriesOf). Its diagrams carry
// their drawings. head is the project's HEAD now, which the page compares with the entry's own. topics holds the state
// of each topic the answer names for this reader now, from the understanding map; the page folds every entry of a
// topic whose state is "unchanged" into one line.
export type QuestionView = { entry: HistoryEntry; recorded: RecordEntry[]; head: string | null; topics: TopicState[] }

type Accepted = Extract<ChatEvent, { kind: 'accepted' }>

// What the page receives while a question runs: the question as ken asks it, which for a lens ken wrote itself, each
// chat event, then the saved entry as the last line. An accepted
// answer's diagrams carry their drawings, its recorded entries are the ones it stands on, and it carries its topics'
// states as a view does.
export type QuestionLine =
	| { kind: 'asked'; question: string }
	| Exclude<ChatEvent, Accepted>
	| (Accepted & { topics: TopicState[] })
	| { kind: 'saved'; view: QuestionView }

// Runs the page's questions one at a time and keeps each in the reader's history, together with what it ended in.
export function questionDesk(history: History, record: RecordStore, repo: Repository, map: UnderstandingMap) {
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
			send({ kind: 'asked', question })
			const events: ChatEvent[] = []
			for await (const event of chat.ask(question, stop)) {
				events.push(event)
				if (event.kind !== 'accepted') {
					send(event)
					continue
				}
				const added = event.recorded.map((stored) => stored.id)
				const recorded = entriesOf(event.answer, added, await record.read())
				const topics = await topicsOf(event.answer.topics)
				send({ ...event, answer: withDrawings(event.answer), recorded, topics })
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
		if (entry.outcome !== 'answered') return { entry, recorded: [], head, topics: [] }
		const drawn = { ...entry, answer: withDrawings(entry.answer) }
		const recorded = entriesOf(entry.answer, entry.recorded, await record.read())
		return { entry: drawn, recorded, head, topics: await topicsOf(entry.answer.topics) }
	}

	// In the order the answer names them. A topic the record no longer has is left out.
	async function topicsOf(names: string[]): Promise<TopicState[]> {
		const { states } = await map.read(new Date())
		return names.flatMap((name) => states.find((state) => sameName(state.topic, name)) ?? [])
	}

	async function rows(): Promise<QuestionRow[]> {
		await settled()
		const [entries, read] = await Promise.all([history.list(), record.read()])
		return entries.map((entry) => {
			const row = { id: entry.id, question: entry.question, askedAt: entry.askedAt, outcome: entry.outcome }
			if (entry.outcome !== 'answered')
				return { ...row, statements: 0, decisions: 0, calls: 0, risks: null, hunks: null }
			const { statements, risks, change } = entry.answer
			const total = change ? change.covered.length + change.uncovered.length : 0
			const decisions = entriesOf(entry.answer, entry.recorded, read).filter((stored) => stored.kind === 'decision')
			return {
				...row,
				statements: statements.length,
				decisions: decisions.length,
				calls: decisions.filter((decision) => decision.needsOwner).length,
				risks: risks === null ? null : risks.length,
				hunks: change && { uncovered: change.uncovered.length, total },
			}
		})
	}

	async function view(id: string): Promise<QuestionView | null> {
		const entry = (await history.list()).find((each) => each.id === id)
		return entry ? await viewOf(entry) : null
	}

	async function lensFacts(): Promise<LensFacts> {
		const [{ states }, read, asked] = await Promise.all([map.read(new Date()), record.read(), history.list()])
		return { record: read, states, lastQuestion: asked.at(-1) }
	}

	// The page sends a question, or a lens for ken to write the question from: catch up, an area, "Go deeper" on the
	// topics of an answer, which also tells the map the reader needs more on them, a person, a time range, or "Explain
	// what changed" on a topic of the open list. "empty" is a lens whose list holds nothing to explain.
	async function questionOf(
		body: unknown,
	): Promise<{ kind: 'ok' | 'empty'; text: string } | { kind: 'refused'; problem: string }> {
		const lens = fieldOf(body, 'lens')
		const kind = fieldOf(lens, 'kind')
		if (lens === undefined) {
			const text = fieldOf(body, 'question')
			if (typeof text !== 'string' || text.trim() === '') return { kind: 'refused', problem: 'The question is empty.' }
			if (text.length > MAX_QUESTION_CHARS) {
				return { kind: 'refused', problem: `Keep the question under ${MAX_QUESTION_CHARS} characters.` }
			}
			return { kind: 'ok', text: text.trim() }
		}
		if (kind === 'catch-up') {
			const [{ states }, read, asked] = await Promise.all([map.read(new Date()), record.read(), history.list()])
			return { kind: 'ok', text: catchUpQuestion({ states, record: read, asked, head: await headNow() }) }
		}
		if (kind === 'area') {
			const area = parsePath(String(fieldOf(lens, 'path') ?? ''))
			if (area.kind !== 'ok') return { kind: 'refused', problem: `Name a folder or a file: ${area.reason}.` }
			const [{ states }, read] = await Promise.all([map.read(new Date()), record.read()])
			return { kind: 'ok', text: areaQuestion(area.path, states, read) }
		}
		if (kind === 'person' || kind === 'range') {
			const since = String(fieldOf(lens, 'since') ?? '')
			const written =
				kind === 'person'
					? await personLens(
							repo,
							await lensFacts(),
							{ author: String(fieldOf(lens, 'author') ?? ''), since },
							new Date(),
						)
					: await rangeLens(repo, await lensFacts(), since, new Date())
			if (written.kind !== 'ok') return written
			return { kind: written.question.empty ? 'empty' : 'ok', text: written.question.text }
		}
		if (kind === 'topic') {
			const { record: read, states } = await lensFacts()
			const open = (await openItems(repo, read, states)).topics.find(({ state }) =>
				sameName(state.topic, String(fieldOf(lens, 'topic') ?? '')),
			)
			if (!open) return { kind: 'refused', problem: 'That topic has not changed since you understood it.' }
			return { kind: 'ok', text: topicQuestion(open).text }
		}
		const topics = fieldOf(lens, 'topics')
		const asked = fieldOf(lens, 'question')
		const names = Array.isArray(topics) ? topics.filter((topic) => typeof topic === 'string') : []
		if (kind !== 'deeper' || names.length === 0 || names.length > MAX_TOPICS || typeof asked !== 'string') {
			return {
				kind: 'refused',
				problem: 'Send a question, or a lens: catch-up, area with a path, deeper, person, range or topic.',
			}
		}
		await map.learn('deeper', names, new Date())
		return { kind: 'ok', text: deeperQuestion(names, asked.slice(0, MAX_QUESTION_CHARS)) }
	}

	return { settled, busy, ask, rows, view, questionOf }
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

// A field of a JSON body the page sent, or undefined.
export function fieldOf(body: unknown, name: string): unknown {
	return typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined
}
