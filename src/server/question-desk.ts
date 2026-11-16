import { randomUUID } from 'node:crypto'
import type { Answer, Chat, ChatEvent } from '../agent/index.ts'
import { withDrawings } from '../diagram/index.ts'
import { type LensFacts, onDay, openItems, personLens, rangeLens, topicQuestion } from '../follow-up/index.ts'
import { entryFrom, type History, type HistoryEntry, whyNoNote } from '../history/index.ts'
import type { About } from '../live/index.ts'
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
// topic whose state is "unchanged" into one line. noNote says why a live note has no answer, and is null otherwise.
export type QuestionView = {
	entry: HistoryEntry
	recorded: RecordEntry[]
	head: string | null
	topics: TopicState[]
	noNote: string | null
}

// What live mode's notes cost: how many there are and the tokens they took.
export type Spent = { notes: number; inputTokens: number; outputTokens: number }

type Accepted = Extract<ChatEvent, { kind: 'accepted' }>

// What the page receives while a question runs: "waiting" first when ken is writing a live note, then the question as
// ken asks it, which for a lens ken wrote itself, each chat event, then the saved entry as the last line. An accepted
// answer's diagrams carry their drawings, its recorded entries are the ones it stands on, and it carries its topics'
// states as a view does.
export type QuestionLine =
	| { kind: 'waiting' }
	| { kind: 'asked'; question: string }
	| Exclude<ChatEvent, Accepted>
	| (Accepted & { topics: TopicState[] })
	| { kind: 'saved'; view: QuestionView }

// Runs the page's questions and live mode's notes one model run at a time, and keeps each in the reader's history,
// together with what it ended in. A question asked while a note runs waits for it; a second question is refused.
export function questionDesk(history: History, record: RecordStore, repo: Repository, map: UnderstandingMap) {
	let running: { stop: AbortSignal; done: Promise<void> } | null = null
	let questions = 0
	let holder: 'question' | 'note' | null = null
	let last: Promise<void> = Promise.resolve()

	// One run at a time, in the order they came. waiting is told when the run must wait for another.
	async function inTurn<T>(who: 'question' | 'note', work: () => Promise<T>, waiting = () => {}): Promise<T> {
		const before = last
		let release = () => {}
		last = new Promise((resolve) => (release = resolve))
		if (holder !== null) waiting()
		await before
		holder = who
		try {
			return await work()
		} finally {
			holder = null
			release()
		}
	}

	// A question the reader stopped can still be winding down. Wait for it, so the next request finds it in the history.
	async function settled() {
		while (running?.stop.aborted) await running.done
	}

	// Call busy right before ask, with no await between them, so two requests cannot both start a question.
	function busy() {
		return questions > 0
	}

	async function ask(chat: Chat, question: string, stop: AbortSignal, send: (line: QuestionLine) => void) {
		let finish = () => {}
		questions += 1
		running = { stop, done: new Promise((resolve) => (finish = resolve)) }
		try {
			await inTurn(
				'question',
				() => run(chat, question, stop, send),
				() => send({ kind: 'waiting' }),
			)
		} finally {
			questions -= 1
			running = null
			finish()
		}
	}

	async function run(chat: Chat, question: string, stop: AbortSignal, send: (line: QuestionLine) => void) {
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
	}

	// A note ken writes by itself in live mode, saved in the history with what it is about.
	async function note(chat: Chat, about: About, question: string, stop: AbortSignal): Promise<QuestionView> {
		return await inTurn('note', async () => {
			const asked = { id: randomUUID(), question, askedAt: new Date().toISOString(), head: await headNow(), about }
			const events: ChatEvent[] = []
			for await (const event of chat.ask(question, stop, 'note')) events.push(event)
			const entry = entryFrom(asked, events, stop.aborted)
			await history.add(entry)
			return await viewOf(entry)
		})
	}

	// The notes of live mode, newest first.
	async function notes(limit: number): Promise<QuestionView[]> {
		const written = (await history.list()).filter((entry) => entry.about !== undefined)
		return await Promise.all(written.slice(-limit).reverse().map(viewOf))
	}

	// The notes written from the moment since on, all of them, not only the ones the page lists.
	async function spentSince(since: string | null): Promise<Spent> {
		const written = (await history.list()).filter(
			(entry) => entry.about !== undefined && since !== null && entry.askedAt >= since,
		)
		return {
			notes: written.length,
			inputTokens: written.reduce((n, entry) => n + (entry.usage?.inputTokens ?? 0), 0),
			outputTokens: written.reduce((n, entry) => n + (entry.usage?.outputTokens ?? 0), 0),
		}
	}

	function writing() {
		return holder === 'note'
	}

	async function headNow(): Promise<string | null> {
		const resolved = await repo.resolve('HEAD')
		return resolved.kind === 'ok' ? resolved.commit : null
	}

	async function viewOf(entry: HistoryEntry): Promise<QuestionView> {
		const head = await headNow()
		if (entry.outcome !== 'answered') {
			return { entry, recorded: [], head, topics: [], noNote: entry.about ? whyNoNote(entry) : null }
		}
		const drawn = { ...entry, answer: withDrawings(entry.answer) }
		const recorded = entriesOf(entry.answer, entry.recorded, await record.read())
		return { entry: drawn, recorded, head, topics: await topicsOf(entry.answer.topics), noNote: null }
	}

	// In the order the answer names them. A topic the record no longer has is left out.
	async function topicsOf(names: string[]): Promise<TopicState[]> {
		const { states } = await map.read(new Date())
		return names.flatMap((name) => states.find((state) => sameName(state.topic, name)) ?? [])
	}

	async function rows(): Promise<QuestionRow[]> {
		await settled()
		const [entries, read] = await Promise.all([history.list(), record.read()])
		return entries
			.filter((entry) => entry.about === undefined)
			.map((entry) => {
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
			return { kind: 'ok', text: catchUpQuestion({ states, record: read, asked, head: await headNow(), day: onDay }) }
		}
		if (kind === 'area') {
			const area = parsePath(String(fieldOf(lens, 'path') ?? ''))
			if (area.kind !== 'ok') return { kind: 'refused', problem: `Name a folder or a file: ${area.reason}.` }
			const [{ states }, read] = await Promise.all([map.read(new Date()), record.read()])
			return { kind: 'ok', text: areaQuestion(area.path, states, read, onDay) }
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
		if (kind === 'note') {
			const id = String(fieldOf(lens, 'id') ?? '')
			const note = (await history.list()).find((entry) => entry.id === id && entry.about !== undefined)
			if (note?.about === undefined || note.outcome !== 'answered') {
				return { kind: 'refused', problem: 'There is no such note.' }
			}
			const commits = note.answer.change?.commits.length ?? 0
			return { kind: 'ok', text: deeperOnNote(note.about, note.askedAt, note.answer.summary, commits) }
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
				problem: 'Send a question, or a lens: catch-up, area with a path, deeper, person, range, topic or note.',
			}
		}
		await map.learn('deeper', names, new Date())
		return { kind: 'ok', text: deeperQuestion(names, asked.slice(0, MAX_QUESTION_CHARS)) }
	}

	return { settled, busy, ask, note, notes, spentSince, writing, rows, view, questionOf }
}

// "Open as a question" on a live note: the full answer on the change the note was about. The first line is the title the
// page shows as the question. The page shows a line under it only when it starts with "- ", as a lens's list does, so
// the lines here are for the agent alone. The server runs on the reader's machine, so its clock is the reader's.
function deeperOnNote(about: About, at: string, summary: string, commits: number): string {
	const short = (hash: string) => hash.slice(0, 7)
	const time = new Date(at).toTimeString().slice(0, 5)
	const explain = `The note said: ${summary}\nExplain that change in full: what it does, why it was done this way, and what to watch now.`
	if (about.kind === 'commits') {
		const what =
			commits === 1
				? `commit ${short(about.head)}`
				: commits > 1
					? `${commits} commits, up to ${short(about.head)}`
					: `the commits up to ${short(about.head)}`
		return `Go deeper on the ${time} note about ${what}\nThe note was about the commits from ${short(about.base)} to ${short(about.head)}. Read them with log and diff over that range.\n${explain}`
	}
	return `Go deeper on the ${time} note about uncommitted work\nken copied that work into commit ${short(about.snapshot)} in its own store, on top of HEAD ${short(about.head)}. Read it with diff from ${short(about.base)} to ${short(about.snapshot)} and with read_file at ${short(about.snapshot)}, as you would a commit.\n${explain}`
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
