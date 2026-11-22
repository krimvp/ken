import { randomUUID } from 'node:crypto'
import {
	type Asking,
	BRIEF_BOUNDS,
	type CardKind,
	type Chat,
	type ChatEvent,
	DRAWINGS,
	firstWords,
	type Item,
	type Reply,
	WANTS,
	type Want,
} from '../agent/index.ts'
import { DIAGRAM_BOUNDS, deployFacts, drawn, LAYOUT_BOUNDS, VIEWS_BOUNDS } from '../diagram/index.ts'
import {
	answerQuestion,
	explainQuestion,
	type LensFacts,
	onDay,
	openItems,
	partsQuestion,
	personLens,
	rangeLens,
	topicQuestion,
	type ViewsAsk,
	viewQuestion,
	viewsQuestion,
} from '../follow-up/index.ts'
import { entryFrom, type History, type HistoryEntry, whyNoNote } from '../history/index.ts'
import { gaveWay, jobQueue, type Ran } from '../jobs/index.ts'
import {
	type Change,
	type LayoutSources,
	lookAtLayout,
	pullRequestOf,
	readLayoutAsk,
	tourOrder,
} from '../layout/index.ts'
import { type About, holdsSnapshot } from '../live/index.ts'
import { areaQuestion, catchUpQuestion, deeperQuestion, type TopicState, type UnderstandingMap } from '../map/index.ts'
import { type RecordStore, sameName } from '../record/index.ts'
import { parsePath, type Repository } from '../repo/index.ts'
import type { conceptReads } from './concepts/brief.ts'
import { partId, questionId } from './concepts/concept.ts'
import { type Layer, type Looking, type layerPlan, lensKey } from './concepts/layers.ts'
import { toldWithLines } from './concepts/told.ts'

const MAX_QUESTION_CHARS = 4000
const RAN: Ran = { kind: 'ran' }
const MAX_TOPICS = 20
// How much of a note's words the next question about it quotes back.
const NOTE_CHARS = 400

// One row in the page's list of questions. cards counts the checked cards of the reply, calls the decisions the model
// wants the reader to decide, and risks its risks. hunks is null when the reply was not about a range of commits.
// thread groups the rows the page shows as one thread. tour names the level and the parts a reply explains as briefs,
// so the page can open what it has already instead of asking again. change is the change the reply is about and steps the number of
// steps it walks through. want says the reader asked for the story of that change or a walk through it, so the page
// opens the stored one again and never takes a later reply about the same commits for it. snapshot is true when the
// change ends at a commit of ken's own snapshot store, which is uncommitted work and no range to look at again. view is there
// when the reader asked to see a level another way, and drew says what the reply drew for it: the parts again, a
// diagram, since a flow or the data is not a grouping of parts, or nothing. brief is the id of the concept whose brief
// the reply wrote: the question it answers, or the one part it explains, and null for any other reply.
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
	change: { base: string; head: string; snapshot: boolean } | null
	want: Want | null
	steps: number
	view: { within: string[]; asked: string; drew: 'parts' | 'diagram' | 'nothing' } | null
	brief: string | null
}

// An entry from the history, its diagrams with their drawings. head is the project's HEAD now, which the page
// compares with the entry's own. topics holds the state of each topic the reply names for this reader now, from the
// understanding map; the page folds the cards of a topic whose state is "unchanged" into one line. noNote says why a
// live note has no reply, and is null otherwise. brief is as on a row, so the page can open the brief a run wrote as
// soon as the run is saved.
export type QuestionView = {
	entry: HistoryEntry
	head: string | null
	topics: TopicState[]
	noNote: string | null
	brief: string | null
}

// What live mode's notes cost: how many there are and the tokens they took.
export type Spent = { notes: number; inputTokens: number; outputTokens: number }

type Replied = Extract<ChatEvent, { kind: 'replied' }>

// What the page receives while a question runs: "waiting" first when it waits for a free slot, then the question as
// ken asks it, which for a lens ken wrote itself, each chat event, then the saved entry as the last line. A diagram
// card carries its drawing, and the reply carries its topics' states as a view does.
export type QuestionLine =
	| { kind: 'waiting' }
	| { kind: 'asked'; question: string }
	| Exclude<ChatEvent, Replied>
	| (Replied & { topics: TopicState[] })
	| { kind: 'saved'; view: QuestionView }

// What a job runs: a question or a lens, in the reader's chat or in ken's own, or a live note in live mode's chat.
// asked is the question as ken wrote it when the reader sent it; a job ken queued writes its question when it starts,
// from the code as it is then. layer is there for a job that fills a layer of what ken knows.
type Work =
	| { kind: 'ask'; body: unknown; asked: Asked | null; chat: 'reader' | 'ken'; layer: Layer | null }
	| { kind: 'note'; chat: Chat; about: About; question: string }
type Asked = { text: string; as?: Asking }

// The chats jobs run in: the reader's own, and ken's for what it fills by itself, so the reader's thread holds only
// what they asked. null without a model.
export type DeskChats = { reader: Chat; ken: Chat } | null

// Runs the page's questions, live mode's notes and the layers ken fills by itself through one queue, and keeps each in
// the reader's history with what it ended in. parallel is how many model runs go at once. background says ken fills
// what is missing by itself.
export function questionDesk(
	history: History,
	record: RecordStore,
	repo: Repository,
	map: UnderstandingMap,
	layout: LayoutSources,
	concepts: ReturnType<typeof conceptReads>,
	jobs: { plan: ReturnType<typeof layerPlan>; chats: DeskChats; parallel: number; background: boolean },
) {
	const { plan, chats } = jobs
	const queue = jobQueue<Work, QuestionLine>({
		parallel: jobs.parallel,
		async run(job, signal, say, acted) {
			const { work } = job
			if (work.kind === 'note') {
				say({ kind: 'saved', view: await writeNote(work, signal) })
				return RAN
			}
			if (!chats) throw new Error('No model is set.')
			const asked = work.asked ?? (await askedOf(work.body))
			const chat = work.chat === 'reader' ? chats.reader : chats.ken
			const sent = (line: QuestionLine) => {
				if (line.kind === 'tool') acted()
				say(line)
			}
			const ran = await run(chat, asked.text, signal, sent, asked.as)
			if (ran.kind === 'model-error') return ran
			// A run can end without making its thing, such as a brief whose every point was sent back.
			if (work.layer !== null && !signal.aborted && !(await plan.fresh(job.key))) {
				throw new Error("ken's model ran, but made nothing that passed ken's checks.")
			}
			return RAN
		},
		fresh: async ({ key, work }) => work.kind === 'ask' && work.layer !== null && (await plan.fresh(key)),
		rankOf: ({ concept, work }) =>
			work.kind === 'ask' && work.layer !== null ? plan.rankOf({ layer: work.layer, concept }) : 2,
		ended: () => void refill(),
	})

	// Wants each job whose thing is missing. A job that waits or runs is that job, so this may run any number of times.
	let filling: Promise<void> = Promise.resolve()
	let closed = false
	function refill() {
		if (!jobs.background || !chats || closed) return filling
		filling = filling
			.then(async () => {
				const missing = await plan.missing(new Date())
				queue.wantAll(
					missing.map((job) => {
						const work = {
							kind: 'ask' as const,
							body: { lens: job.lens },
							asked: null,
							chat: 'ken' as const,
							layer: job.layer,
						}
						return { ...job, yields: true, work }
					}),
				)
			})
			.catch((error: unknown) => {
				process.stderr.write(
					`ken could not work out what to read next: ${error instanceof Error ? error.message : error}\n`,
				)
			})
		return filling
	}

	// A lens the server cannot write a question for ends the job with the reason.
	async function askedOf(body: unknown): Promise<Asked> {
		const asked = await questionOf(body)
		if (asked.kind === 'refused') throw new Error(asked.problem)
		if (asked.kind === 'empty') throw new Error("There is nothing here for ken's model to explain.")
		return asked
	}

	// The reader's question, as a job at the front of the line, or the job already running for the same thing. send
	// gets "waiting" while it waits for a free slot, then each line of the run. Stopping the request stops the job
	// unless ken started it, which then goes on by itself.
	async function ask(body: unknown, asked: Asked, stop: AbortSignal, send: (line: QuestionLine) => void) {
		const lens = fieldOf(body, 'lens')
		const key = (lens === undefined ? null : lensKey(lens)) ?? `ask:${randomUUID()}`
		const kind = String(fieldOf(lens, 'kind') ?? 'question')
		const concept = fieldOf(lens, 'concept') ?? null
		const title = asked.text.split('\n')[0] ?? ''
		const work = { kind: 'ask' as const, body, asked, chat: 'reader' as const, layer: null }
		const ask = {
			key,
			kind,
			concept: typeof concept === 'string' ? concept : null,
			title,
			order: 0,
			yields: true,
			work,
		}
		const job = queue.want(ask, 'reader')
		if (!job) return send({ kind: 'error', message: 'ken is closing.' })
		if (job.state.kind === 'waiting') send({ kind: 'waiting' })
		const leave = () => queue.stop(key, 'unfollow')
		if (stop.aborted) return leave()
		stop.addEventListener('abort', leave)
		let erred = false
		const ended = await queue.follow(key, (line) => {
			if (line.kind === 'error') erred = true
			send(line)
		})
		stop.removeEventListener('abort', leave)
		if (ended?.kind === 'failed' && !stop.aborted && !erred) send({ kind: 'error', message: ended.why })
	}

	async function run(
		chat: Chat,
		question: string,
		stop: AbortSignal,
		send: (line: QuestionLine) => void,
		as?: Asking,
	): Promise<Ran> {
		const asked = {
			id: randomUUID(),
			question,
			askedAt: new Date().toISOString(),
			head: await headNow(),
			thread: chat.thread,
		}
		send({ kind: 'asked', question })
		const events: ChatEvent[] = []
		for await (const event of chat.ask(question, stop, as)) {
			events.push(event)
			if (event.kind === 'item') send({ ...event, item: drawnItem(event.item) })
			else if (event.kind === 'replied') {
				send({ ...event, reply: drawnReply(event.reply), topics: await topicsOf(event.reply.topics) })
			} else send(event)
		}
		// A job that gave way to the reader runs again from the start, so this run leaves nothing in the history.
		if (gaveWay(stop)) return RAN
		const entry = entryFrom(asked, events, stop.aborted)
		await history.add(entry)
		send({ kind: 'saved', view: await viewOf(entry) })
		const last = events.at(-1)
		return last?.kind === 'error' && last.model ? { kind: 'model-error', why: last.message } : RAN
	}

	// A note ken writes by itself in live mode, saved in the history with what it is about. null when live mode was
	// turned off before the note started.
	async function note(chat: Chat, about: About, question: string, stop: AbortSignal): Promise<QuestionView | null> {
		const key = `note:${randomUUID()}`
		const work = { kind: 'note' as const, chat, about, question }
		queue.want({ key, kind: 'note', concept: null, title: 'Writing a live note', order: 0, yields: false, work }, 'ken')
		const off = () => queue.stop(key, 'stop')
		if (stop.aborted) off()
		stop.addEventListener('abort', off)
		let written: QuestionView | null = null
		await queue.follow(key, (line) => {
			if (line.kind === 'saved') written = line.view
		})
		stop.removeEventListener('abort', off)
		return written
	}

	async function writeNote(work: Extract<Work, { kind: 'note' }>, stop: AbortSignal): Promise<QuestionView> {
		const { chat, about, question } = work
		const asked = {
			id: randomUUID(),
			question,
			askedAt: new Date().toISOString(),
			head: await headNow(),
			thread: chat.thread,
			about,
		}
		const events: ChatEvent[] = []
		for await (const event of chat.ask(question, stop, { kind: 'note' })) events.push(event)
		const entry = entryFrom(asked, events, stop.aborted)
		await history.add(entry)
		return await viewOf(entry)
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
		return queue.view().some((job) => job.kind === 'note' && job.state.kind === 'running')
	}

	// The page says what the reader looks at now, which ranks the jobs ken queued by itself.
	function look(looking: Looking) {
		plan.look(looking)
		queue.refocus()
		void refill()
	}

	// The reader stopped a job, theirs or ken's. A job ken started is not tried again by itself until ken starts again.
	function stop(key: string) {
		queue.stop(key, 'stop')
	}

	async function close() {
		closed = true
		await queue.close()
		await filling
	}

	async function headNow(): Promise<string | null> {
		const resolved = await repo.resolve('HEAD')
		return resolved.kind === 'ok' ? resolved.commit : null
	}

	async function viewOf(entry: HistoryEntry): Promise<QuestionView> {
		const head = await headNow()
		if (entry.outcome !== 'answered') {
			return { entry, head, topics: [], noNote: entry.about ? whyNoNote(entry) : null, brief: null }
		}
		const shown = { ...entry, reply: drawnReply(entry.reply) }
		const topics = await topicsOf(entry.reply.topics)
		return { entry: shown, head, topics, noNote: null, brief: briefOf(entry.reply) }
	}

	// In the order the answer names them. A topic the record no longer has is left out.
	async function topicsOf(names: string[]): Promise<TopicState[]> {
		if (names.length === 0) return []
		const { states } = await map.read(new Date(), undefined, { names })
		return names.flatMap((name) => states.find((state) => sameName(state.topic, name)) ?? [])
	}

	async function rows(): Promise<QuestionRow[]> {
		await queue.settled()
		const asked = (await history.list()).filter((entry) => entry.about === undefined)
		return await Promise.all(
			asked.map(async (entry) => {
				const { id, question, askedAt, thread, outcome } = entry
				const row = { id, question, askedAt, thread, outcome }
				if (entry.outcome !== 'answered') {
					const none = { hunks: null, tour: null, change: null, want: null, steps: 0, view: null, brief: null }
					return { ...row, cards: 0, calls: 0, risks: 0, ...none }
				}
				const { items, change, tour, view, want } = entry.reply
				const snapshot = change !== null && (await holdsSnapshot(layout.snapshots, change.head))
				const cards = items.flatMap((item) => (item.kind === 'card' ? [item.card] : []))
				const has = (kind: CardKind) => cards.some((card) => card.kind === kind)
				const total = change ? change.covered.length + change.uncovered.length : 0
				const steps = items.filter((item) => item.kind === 'step').length
				return {
					...row,
					cards: cards.length,
					calls: cards.filter((card) => card.kind === 'decision' && card.decision.needsOwner).length,
					risks: cards.filter((card) => card.kind === 'risk').length,
					hunks: change && { uncovered: change.uncovered.length, total },
					tour: tour ? { within: tour.within, stops: tour.stops.map((each) => each.name) } : null,
					change: change && { base: change.base, head: change.head, snapshot },
					// A walkthrough saved before replies carried want still shows as one: a reply about a change with steps.
					want: want ?? (change && steps > 0 ? 'walk' : null),
					steps,
					view: view ? { ...view, drew: has('layout') ? 'parts' : has('diagram') ? 'diagram' : 'nothing' } : null,
					brief: briefOf(entry.reply),
				}
			}),
		)
	}

	async function view(id: string): Promise<QuestionView | null> {
		const entry = (await history.list()).find((each) => each.id === id)
		return entry ? await viewOf(entry) : null
	}

	async function lensFacts(): Promise<LensFacts> {
		const [{ states }, read, asked] = await Promise.all([map.read(new Date()), record.read(), history.list()])
		return { record: read, states, lastQuestion: asked.at(-1) }
	}

	// The level a parts or view lens names, as the reader sees it. The model draws parts at HEAD, so the starting point
	// is the level at HEAD whatever commit the page shows.
	async function levelOf(lens: unknown) {
		const within = fieldOf(lens, 'within')
		const ask = await readLayoutAsk(layout, { within: Array.isArray(within) ? within.map(String) : [] }, new Date())
		if (ask.kind !== 'ok') return { kind: 'refused' as const, problem: ask.message }
		const look = await lookAtLayout(layout, ask.ask, new Date())
		const name = fieldOf(lens, 'name')
		const level = {
			...look,
			name: typeof name === 'string' ? oneLine(name).slice(0, 80) || null : null,
			within: ask.ask.within,
			bounds: LAYOUT_BOUNDS,
		}
		return { kind: 'ok' as const, level }
	}

	// The part of the top level a level inside stands for, with what its brief says, for the run that names its parts.
	async function parentOf(within: string[]): Promise<{ parent?: { name: string; line: string; told: string[] } }> {
		const top = await levelOf({ within: [] })
		const box =
			top.kind === 'ok' ? top.level.boxes.find((each) => each.paths.toSorted().join() === within.join()) : null
		const brief = box ? await concepts.brief(partId([], box.name), new Date()) : null
		if (!brief?.explained || brief.staleFiles) return {}
		return { parent: { name: brief.name, line: brief.line, told: brief.points.map(toldWithLines) } }
	}

	async function viewsAsk(head: string): Promise<ViewsAsk> {
		const at = await repo.resolve(head)
		const deploy =
			at.kind === 'ok' ? await deployFacts(repo, at.commit) : { workloads: [], dockerfiles: [], unread: [] }
		return { deploy, bounds: VIEWS_BOUNDS }
	}

	// The page sends a question, or a lens for ken to write the question from: catch up, an area, "Go deeper" on the
	// topics of an answer, which also tells the map the reader needs more on them, a person, a time range, "Explain
	// what changed" on a topic of the open list, one change, another way to show a level, the brief of a part or of
	// every part of a level, or a question about one concept. "empty" is a lens whose list holds nothing to explain. as
	// is there when the question is asked in a way of its own: parts to explain, a question to answer as a brief, a
	// change plain code picked, or a level to show another way.
	async function questionOf(
		body: unknown,
	): Promise<{ kind: 'ok' | 'empty'; text: string; as?: Asking } | { kind: 'refused'; problem: string }> {
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
		// The parts of the top level are named with its two drawings, in one run.
		if (kind === 'parts') {
			const read = await levelOf(lens)
			if (read.kind !== 'ok') return read
			const { level } = read
			const top = level.within.length === 0 ? { drawings: await viewsAsk(level.head) } : await parentOf(level.within)
			const parts = level.boxes.filter((box) => box.state !== 'gone').map(({ name, paths }) => ({ name, paths }))
			const text = partsQuestion({ ...level, ...top }).text
			return { kind: 'ok', text, as: { kind: 'parts', within: level.within, parts } }
		}
		if (kind === 'views') {
			const read = await levelOf(lens)
			if (read.kind !== 'ok') return read
			const { level } = read
			if (level.within.length > 0) {
				return {
					kind: 'refused',
					problem: 'ken draws where a project runs for the whole project only: send within [].',
				}
			}
			if (!level.named) {
				const problem =
					"ken's model has not named the parts of this project yet. Ask ken to name them: that run draws these too."
				return { kind: 'refused', problem }
			}
			const text = viewsQuestion({ ...level, drawings: await viewsAsk(level.head) }).text
			return { kind: 'ok', text, as: { kind: 'views' } }
		}
		if (kind === 'view') {
			const said = fieldOf(lens, 'text')
			// The reader's words head the question, so they stay on one line.
			const text = typeof said === 'string' ? oneLine(said) : ''
			if (text === '' || text.length > LAYOUT_BOUNDS.asked) {
				const problem = `Say how ken should show it, in 1 to ${LAYOUT_BOUNDS.asked} characters.`
				return { kind: 'refused', problem }
			}
			const read = await levelOf(lens)
			if (read.kind !== 'ok') return read
			const { level } = read
			return {
				kind: 'ok',
				text: viewQuestion({ ...level, diagram: DIAGRAM_BOUNDS }, text).text,
				as: { kind: 'view', within: level.within, text },
			}
		}
		if (kind === 'explain') {
			const read = await levelOf(lens)
			if (read.kind !== 'ok') return read
			const { level } = read
			const part = fieldOf(lens, 'part') ?? null
			// The order a tour took: the order the parts were named in, with tests and upkeep last. Asked for the whole
			// level, the model explains the parts it has not explained yet, or all of them when none is left.
			const order = tourOrder(level.boxes.filter((box) => box.state !== 'gone'))
			const { explained } = await concepts.levelTold(level)
			const rest = order.filter((stop) => !explained.includes(stop.name))
			const stops = part === null ? (rest.length > 0 ? rest : order) : order.filter((stop) => stop.name === part)
			if (stops.length === 0) {
				const problem = part === null ? 'There is no part here to explain.' : `There is no part "${String(part)}" here.`
				return { kind: 'refused', problem }
			}
			const text = explainQuestion({
				name: level.name,
				about: level.named?.about ?? null,
				head: level.head,
				parts: stops,
				beside: order.filter((stop) => !stops.includes(stop)),
				arrows: level.arrows,
				bounds: BRIEF_BOUNDS,
				drawings: DRAWINGS,
			}).text
			return { kind: 'ok', text, as: { kind: 'explain', tour: { within: level.within, stops } } }
		}
		if (kind === 'answer') {
			const said = fieldOf(lens, 'text')
			const text = typeof said === 'string' ? oneLine(said) : ''
			if (text === '' || text.length > MAX_QUESTION_CHARS) {
				return { kind: 'refused', problem: `Ask the question in 1 to ${MAX_QUESTION_CHARS} characters.` }
			}
			const concept = fieldOf(lens, 'concept')
			const about = typeof concept === 'string' ? await concepts.brief(concept, new Date()) : null
			const head = await headNow()
			if (!about || head === null) return { kind: 'refused', problem: 'ken has no such concept here to ask about.' }
			// A brief whose quotes changed points at the changed files, so the answer reads them again.
			const paths = about.staleFiles ?? about.deeper?.within.split(',') ?? []
			const asked = answerQuestion({
				asked: text,
				head,
				about: {
					kind: about.kind,
					name: about.name,
					knows: about.knows,
					line: about.staleFiles ? '' : about.line,
					paths,
					told: about.staleFiles ? [] : about.points.map(toldWithLines),
				},
				bounds: BRIEF_BOUNDS,
				drawings: DRAWINGS,
			})
			return {
				kind: 'ok',
				text: asked.text,
				as: { kind: 'answer', concept: about.id, text, paths, typed: fieldOf(lens, 'typed') === true },
			}
		}
		if (kind === 'change') {
			const asked = fieldOf(lens, 'change')
			const want = [...WANTS, ...SIDE_WANTS].find((each) => each === fieldOf(lens, 'want'))
			if (typeof asked !== 'string' || want === undefined) {
				const wants = [...WANTS, ...SIDE_WANTS].join(', ')
				return { kind: 'refused', problem: `Send the change, and what you want of it: one of ${wants}.` }
			}
			// The layout reads the change, so the question is about the same commits the page lays over the picture.
			const ask = await readLayoutAsk(layout, { change: asked }, new Date())
			if (ask.kind !== 'ok') return { kind: 'refused', problem: ask.message }
			const { change } = ask.ask
			if (change === null) return { kind: 'refused', problem: 'Name the change to ask about.' }
			const own = change.kind === 'uncommitted' || (await holdsSnapshot(layout.snapshots, change.range.head))
			const landed = own ? null : await landedIn(layout.repo, change)
			const name = own ? 'your uncommitted work' : await changeName(layout.repo, change, landed?.commits ?? 0)
			const title = TITLES[want](name)
			if (change.range.base === change.range.head) return { kind: 'empty', text: title }
			const where = whereLine(change, own, landed)
			// A question beside a story is a question of its own: ken sets no scope for it and stores it as none of them.
			if (want === 'decisions' || want === 'risks') return { kind: 'ok', text: [title, where].join('\n') }
			const text = [title, where, ...changeLines(change, want)].join('\n')
			return { kind: 'ok', text, as: { kind: 'change', range: change.range, want } }
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
					'Send a question, or a lens: answer, catch-up, area with a path, change, deeper, explain, parts, person, range, topic, view, views or note.',
			}
		}
		await map.learn('deeper', names, new Date())
		return { kind: 'ok', text: deeperQuestion(names, asked.slice(0, MAX_QUESTION_CHARS)) }
	}

	return {
		// A stopped question can still be winding down: this waits for it, so the next request finds it in the history.
		settled: queue.settled,
		ask,
		note,
		notes,
		spentSince,
		writing,
		rows,
		view,
		questionOf,
		look,
		stop,
		refill,
		close,
		jobs: queue.view,
		subscribe: queue.subscribe,
	}
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

// The questions the page asks beside a change's story. Each is answered in a thread of its own.
const SIDE_WANTS = ['decisions', 'risks'] as const

// What the reader asks of a change, as the title of the question. name is the change inside a sentence, so every
// question ken writes about one change calls it the same.
const TITLES: Record<Want | (typeof SIDE_WANTS)[number], (name: string) => string> = {
	story: (name) => `What did ${name} do, and why?`,
	walk: (name) => `Walk me through ${name}`,
	decisions: (name) => `What did ${name} decide, and why?`,
	risks: (name) => `What could go wrong with ${name}? Show me the risks.`,
}

type LandedIn = { commits: number; merges: number }

// The commits of a change, counted as the layout counts them for the page: the commits themselves, and the merges
// apart. Null when git cannot list the range.
async function landedIn(repo: Repository, change: Change): Promise<LandedIn | null> {
	const listed = await repo.commitsIn(change.range, 0)
	return listed.kind === 'ok' ? { commits: listed.more, merges: listed.merges } : null
}

// The change as the layout names it to the reader, inside a sentence: a branch, the pull request a merge brought in,
// the subject of another merge or of one commit, or a count of commits.
async function changeName(repo: Repository, change: Change, commits: number): Promise<string> {
	if (change.kind === 'branch') return `the branch ${change.name}`
	const { base, head } = change.range
	const line = await repo.mainLine(head, 1)
	const newest = line.kind === 'ok' ? line.commits[0] : undefined
	if (newest?.hash === head && newest.parents[0] === base) {
		const pull = pullRequestOf(newest.subject)
		return pull ? `the merge of pull request ${pull}` : `"${newest.subject}"`
	}
	const count = commits === 1 ? 'the commit' : commits > 1 ? `the ${commits} commits` : 'the commits'
	return `${count} from ${base.slice(0, 7)} to ${head.slice(0, 7)}`
}

// Where the agent reads a change, under the title of every question about it. own says it is the reader's
// uncommitted work, which ends at ken's own copy of it.
function whereLine(change: Change, own: boolean, landed: LandedIn | null): string {
	const short = (hash: string) => hash.slice(0, 7)
	const { base, head } = change.range
	if (own) {
		return `ken copied that work into commit ${short(head)} in its own store, on top of HEAD ${short(base)}. Read it with diff from ${short(base)} to ${short(head)} and with read_file at ${short(head)}, as you would a commit.`
	}
	const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)
	const merges = landed && landed.merges > 0 ? ` and ${count(landed.merges, 'merge')}` : ''
	const counted = landed && landed.commits + landed.merges > 0 ? `: ${count(landed.commits, 'commit')}${merges}` : ''
	return `The change is the commits from ${short(base)} to ${short(head)}${counted}. Read them with log and diff over that range.`
}

// What the agent is told under that line for a story or a walkthrough: the page shows only the title, as with
// deeperOnNote. Plain code set the reply's scope to the range, so the model need not.
function changeLines(change: Change, want: Want): string[] {
	const short = (hash: string) => hash.slice(0, 7)
	const { base } = change.range
	return [
		'ken has set the scope of this reply to that range, so leave scope out of show.',
		...(want === 'walk'
			? [
					'Walk me through the change in steps, in the order a reviewer should read them. A step holds one change. Two changes make two steps.',
					'The first sentence of a step is its title, read alone in a list: say what changed, such as "The live suite no longer runs in npm test". Never a sentence that points elsewhere, such as "This is the one product fix".',
					'After the last step, and only there, write one line that names what the steps leave out and a reviewer should still open, such as a changed rule or boundary table, a test of new behaviour, or docs. If the steps leave nothing out, say so.',
				]
			: [
					'Tell its story in plain prose: what was wrong or missing before, what the change does now, and why. Five sentences is the most, so tell the main thing the change does and leave the smaller things out. I will ask for them. No list and no heading. No file names and no numbers unless one is the point.',
					"If most of the change is tests or upkeep, one of those sentences names the one change it makes to the product's own code.",
				]),
		`Before you say how something was before the change, read the code at ${short(base)}. A commit message can describe a state the code never had.`,
	]
}

// The concept whose brief a reply wrote: the question it answers, or the part it explains when it explains one.
function briefOf(reply: Reply): string | null {
	if (reply.answers) return questionId(reply.answers.concept, reply.answers.text)
	const [only, ...more] = reply.tour?.stops ?? []
	return reply.tour && only && more.length === 0 ? partId(reply.tour.within, only.name) : null
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

// Every run of white space, line breaks of any kind among them, is one space.
function oneLine(text: string): string {
	return text.replaceAll(/\s+/g, ' ').trim()
}
