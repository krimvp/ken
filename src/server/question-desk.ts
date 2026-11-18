import { randomUUID } from 'node:crypto'
import { type Chat, type ChatEvent, firstWords, type Item, type Reply, type Tour } from '../agent/index.ts'
import { drawn, LAYOUT_BOUNDS } from '../diagram/index.ts'
import {
	type LensFacts,
	onDay,
	openItems,
	partsQuestion,
	personLens,
	rangeLens,
	topicQuestion,
	tourQuestion,
} from '../follow-up/index.ts'
import { entryFrom, type History, type HistoryEntry, whyNoNote } from '../history/index.ts'
import { type LayoutSources, lookAtLayout, readLayoutAsk } from '../layout/index.ts'
import type { About } from '../live/index.ts'
import { areaQuestion, catchUpQuestion, deeperQuestion, type TopicState, type UnderstandingMap } from '../map/index.ts'
import { type RecordStore, sameName } from '../record/index.ts'
import { parsePath, type Repository } from '../repo/index.ts'

const MAX_QUESTION_CHARS = 4000
const MAX_TOPICS = 20
// How much of a note's words the next question about it quotes back.
const NOTE_CHARS = 400

// One row in the page's list of questions. cards counts the checked cards of the reply, calls the decisions the model
// wants the reader to decide, and risks its risks. hunks is null when the reply was not about a range of commits.
// thread groups the rows the page shows as one thread. tour names the level and the stops of a tour, so the page can
// open a tour it has already instead of asking again.
export type QuestionRow = {
	id: string
	question: string
	askedAt: string
	thread: string | null
	outcome: HistoryEntry['outcome']
	cards: number
	calls: number
	risks: number
	hunks: { uncovered: number; total: number } | null
	tour: { within: string[]; stops: string[] } | null
}

// An entry from the history, its diagrams with their drawings. head is the project's HEAD now, which the page
// compares with the entry's own. topics holds the state of each topic the reply names for this reader now, from the
// understanding map; the page folds the cards of a topic whose state is "unchanged" into one line. noNote says why a
// live note has no reply, and is null otherwise.
export type QuestionView = {
	entry: HistoryEntry
	head: string | null
	topics: TopicState[]
	noNote: string | null
}

// What live mode's notes cost: how many there are and the tokens they took.
export type Spent = { notes: number; inputTokens: number; outputTokens: number }

type Replied = Extract<ChatEvent, { kind: 'replied' }>

// What the page receives while a question runs: "waiting" first when ken is writing a live note, then the question as
// ken asks it, which for a lens ken wrote itself, each chat event, then the saved entry as the last line. A diagram
// card carries its drawing, and the reply carries its topics' states as a view does.
export type QuestionLine =
	| { kind: 'waiting' }
	| { kind: 'asked'; question: string }
	| Exclude<ChatEvent, Replied>
	| (Replied & { topics: TopicState[] })
	| { kind: 'saved'; view: QuestionView }

// Runs the page's questions and live mode's notes one model run at a time, and keeps each in the reader's history,
// together with what it ended in. A question asked while a note runs waits for it; a second question is refused.
export function questionDesk(
	history: History,
	record: RecordStore,
	repo: Repository,
	map: UnderstandingMap,
	layout: LayoutSources,
) {
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

	async function ask(
		chat: Chat,
		question: string,
		stop: AbortSignal,
		send: (line: QuestionLine) => void,
		tour: Tour | null = null,
	) {
		let finish = () => {}
		questions += 1
		running = { stop, done: new Promise((resolve) => (finish = resolve)) }
		try {
			await inTurn(
				'question',
				() => run(chat, question, stop, send, tour),
				() => send({ kind: 'waiting' }),
			)
		} finally {
			questions -= 1
			running = null
			finish()
		}
	}

	async function run(
		chat: Chat,
		question: string,
		stop: AbortSignal,
		send: (line: QuestionLine) => void,
		tour: Tour | null,
	) {
		const asked = {
			id: randomUUID(),
			question,
			askedAt: new Date().toISOString(),
			head: await headNow(),
			thread: chat.thread,
		}
		send({ kind: 'asked', question })
		const events: ChatEvent[] = []
		for await (const event of chat.ask(question, stop, tour ? { tour } : 'question')) {
			events.push(event)
			if (event.kind === 'item') send({ ...event, item: drawnItem(event.item) })
			else if (event.kind === 'replied') {
				send({ ...event, reply: drawnReply(event.reply), topics: await topicsOf(event.reply.topics) })
			} else send(event)
		}
		const entry = entryFrom(asked, events, stop.aborted)
		await history.add(entry)
		send({ kind: 'saved', view: await viewOf(entry) })
	}

	// A note ken writes by itself in live mode, saved in the history with what it is about.
	async function note(chat: Chat, about: About, question: string, stop: AbortSignal): Promise<QuestionView> {
		return await inTurn('note', async () => {
			const asked = {
				id: randomUUID(),
				question,
				askedAt: new Date().toISOString(),
				head: await headNow(),
				thread: chat.thread,
				about,
			}
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
			return { entry, head, topics: [], noNote: entry.about ? whyNoNote(entry) : null }
		}
		const shown = { ...entry, reply: drawnReply(entry.reply) }
		return { entry: shown, head, topics: await topicsOf(entry.reply.topics), noNote: null }
	}

	// In the order the answer names them. A topic the record no longer has is left out.
	async function topicsOf(names: string[]): Promise<TopicState[]> {
		const { states } = await map.read(new Date())
		return names.flatMap((name) => states.find((state) => sameName(state.topic, name)) ?? [])
	}

	async function rows(): Promise<QuestionRow[]> {
		await settled()
		return (await history.list())
			.filter((entry) => entry.about === undefined)
			.map((entry) => {
				const { id, question, askedAt, thread, outcome } = entry
				const row = { id, question, askedAt, thread, outcome }
				if (entry.outcome !== 'answered') return { ...row, cards: 0, calls: 0, risks: 0, hunks: null, tour: null }
				const { items, change, tour } = entry.reply
				const cards = items.flatMap((item) => (item.kind === 'card' ? [item.card] : []))
				const total = change ? change.covered.length + change.uncovered.length : 0
				return {
					...row,
					cards: cards.length,
					calls: cards.filter((card) => card.kind === 'decision' && card.decision.needsOwner).length,
					risks: cards.filter((card) => card.kind === 'risk').length,
					hunks: change && { uncovered: change.uncovered.length, total },
					tour: tour ? { within: tour.within, stops: tour.stops.map((each) => each.name) } : null,
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
	): Promise<{ kind: 'ok' | 'empty'; text: string; tour?: Tour } | { kind: 'refused'; problem: string }> {
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
			const commits = note.reply.change?.commits.length ?? 0
			const said = firstWords(note.reply.items, NOTE_CHARS)
			return { kind: 'ok', text: deeperOnNote(note.about, note.askedAt, said, commits) }
		}
		if (kind === 'parts') {
			const within = fieldOf(lens, 'within')
			const paths = Array.isArray(within) ? within.map(String) : []
			// The model names parts at HEAD, so the starting point is the level at HEAD whatever commit the page shows.
			const ask = await readLayoutAsk(layout, { within: paths })
			if (ask.kind !== 'ok') return { kind: 'refused', problem: ask.message }
			const look = await lookAtLayout(layout, ask.ask, new Date())
			const name = fieldOf(lens, 'name')
			const level = {
				...look,
				name: typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : null,
				within: ask.ask.within,
				bounds: LAYOUT_BOUNDS,
			}
			return { kind: 'ok', text: partsQuestion(level).text }
		}
		if (kind === 'tour') {
			const within = fieldOf(lens, 'within')
			const ask = await readLayoutAsk(layout, { within: Array.isArray(within) ? within.map(String) : [] })
			if (ask.kind !== 'ok') return { kind: 'refused', problem: ask.message }
			const look = await lookAtLayout(layout, ask.ask, new Date())
			if (!look.tour) {
				return { kind: 'refused', problem: "ken's model has not named the parts here yet. Name them first." }
			}
			const name = fieldOf(lens, 'name')
			const stops = look.tour.map(({ name, job, paths }) => ({ name, job, paths }))
			const text = tourQuestion({
				name: typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : null,
				head: look.head,
				stops,
				arrows: look.arrows,
			}).text
			return { kind: 'ok', text, tour: { within: ask.ask.within, stops } }
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
				problem:
					'Send a question, or a lens: catch-up, area with a path, deeper, parts, person, range, topic, tour or note.',
			}
		}
		await map.learn('deeper', names, new Date())
		return { kind: 'ok', text: deeperQuestion(names, asked.slice(0, MAX_QUESTION_CHARS)) }
	}

	return { settled, busy, ask, note, notes, spentSince, writing, rows, view, questionOf }
}

// "Open as a question" on a live note: the full reply on the change the note was about. The first line is the title the
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

// A diagram card leaves ken with its drawing.
function drawnItem(item: Item): Item {
	if (item.kind !== 'card' || item.card.kind !== 'diagram') return item
	return { kind: 'card', card: { kind: 'diagram', diagram: drawn(item.card.diagram) } }
}

function drawnReply(reply: Reply): Reply {
	return { ...reply, items: reply.items.map(drawnItem) }
}

// A field of a JSON body the page sent, or undefined.
export function fieldOf(body: unknown, name: string): unknown {
	return typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined
}
