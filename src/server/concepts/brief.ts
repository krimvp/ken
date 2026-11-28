// The brief of one concept, as the page opens it in its drawer. Plain code builds it on every read from what ken
// holds: the layout for a part's job, its arrows and what is inside it, the record for decisions and terms, the
// reader's saved replies for what ken's model told them, and what they looked at for what ken thinks they know. No
// model runs here. A part the model has not explained still has a brief, with the lens that asks for the rest.
import { wordCount } from '../../agent/index.ts'
import type { History } from '../../history/index.ts'
import {
	knowsOf,
	type LayoutLook,
	type LayoutSources,
	type LookBox,
	lookAtLayout,
	readLayoutAsk,
	under,
} from '../../layout/index.ts'
import type { Knows } from '../../map/index.ts'
import { decisionMark, type RecordRead, sameName } from '../../record/index.ts'
import { type CommitHash, parsePath } from '../../repo/index.ts'
import {
	arrowId,
	type Concept,
	type ConceptKind,
	decisionId,
	parseConcept,
	partId,
	processId,
	questionId,
	stepId,
	termId,
} from './concept.ts'
import { drawnOf, type PartRef, type Process, processOf } from './processes.ts'
import {
	type Answer,
	answeredOf,
	answersOf,
	type BriefPoint,
	type BriefQuote,
	fileQuotes,
	staleFiles,
	type Told,
	toldOfPart,
} from './told.ts'
import { viewBrief, viewRows } from './views-brief.ts'

export const TRUST = "ken's model wrote the words. ken found each quoted line in git."
// What a brief says of its words while ken's model has said nothing of the concept.
export const GIT_TRUST = "ken found this in git. ken's model has not explained it yet."

// The same evidence goes to a scoped question and to an agent that recalls this part later.
export function readerLine(knows: Knows | null): string | null {
	return knows ? knows.why + (knows.since ? ' The code has changed since you looked.' : '') : null
}

type Named = { id: string; name: string }
type Neighbour = Named & { verb: string }

// explained is false while nothing from the model is here: points, terms and questions are then empty, and explain is
// what to send to /api/questions to have ken's model write them. quotes is there for a decision, an arrow and a step,
// about for a question and a step, usedIn for a term and, before ken's model explains it, note with what the record
// holds of its meaning, and why for a decision. A frame, a store, an outside system and a
// crossing of the drawings of the top level have quotes, and as their kind has them inside, parts, gaps and topics.
export type Brief = {
	id: string
	// A part is a file where nobody named the parts and git lists one file.
	kind: ConceptKind | 'file'
	name: string
	line: string
	minutes: number
	explained: boolean
	explain: { lens: Record<string, unknown> } | null
	points: BriefPoint[]
	terms: Named[]
	questions: { id: string; text: string; answered: boolean }[]
	decisions: { id: string; question: string; chosen: string; why: string; reasonSource: string }[]
	sideways: { uses: Neighbour[]; usedBy: Neighbour[]; processes: { id: string; name: string; steps: number }[] }
	source?: { path: string; commit: CommitHash }
	deeper: { within: string; parts: number; files: number } | null
	steps: { n: number; part: string | null; line: string; quotes: BriefQuote[] }[] | null
	knows: Knows | null
	trust: string
	staleFiles?: string[] | undefined
	checkedAt?: string
	about?: Named
	usedIn?: Named[]
	note?: string
	// For a question: the parts of the top level its answer quotes, which its picture lights.
	lit?: string[]
	quotes?: BriefQuote[]
	why?: string
	replacedBy?: string
	reasonSource?: string
	reasonQuotes?: NonNullable<Decided['reason']>['quotes']
	inside?: Named[]
	parts?: Named[]
	gaps?: string[]
	topics?: string[]
}

// One row of what search can find. level is what ken thinks the reader knows of it, null when ken holds nothing.
export type ConceptRow = {
	id: string
	kind: ConceptKind
	name: string
	line: string
	minutes: number
	level: Knows['level'] | null
}

// A part of a level that is one file: its lines at HEAD, and the sentence ken's model wrote of it, or null.
export type FileTold = { name: string; lines: number; line: string | null }

// The question that asks ken's model what a term means.
const meansWhat = (term: string) => `What does "${term}" mean in this project?`

// A reader reads about this many words a minute when the words are short and a drawing sits beside them.
const WORDS_A_MINUTE = 150
// A term's brief shows this many of the places the code uses it.
const TERM_PLACES = 2

export function conceptReads(layout: LayoutSources, history: History) {
	const { record } = layout

	// One level as the reader sees it at HEAD, with no change laid over it. null when the paths are not in the project.
	async function levelAt(within: string[], now: Date): Promise<LayoutLook | null> {
		const ask = await readLayoutAsk(layout, { within, change: 'none' }, now)
		return ask.kind === 'ok' ? await lookAtLayout(layout, ask.ask, now) : null
	}

	async function held(now: Date) {
		const [read, asked] = await Promise.all([record.read(), history.list()])
		const answered = answeredOf(asked)
		return { read, answered, answers: answersOf(answered), drawn: drawnOf(answered, read), now }
	}
	type Held = Awaited<ReturnType<typeof held>>

	// A single scan shares the saved replies across its parts. The next scan checks the new head and replies again.
	async function levelProgress(look: LayoutLook, now: Date) {
		const all = await held(now)
		return {
			hasProcess: all.drawn.length > 0,
			async firstQuestions(name: string, limit: number) {
				const told = toldOfPart(all.answered, look.within, name)
				if (!told || (await stalePoints(look.head, told.points))) return null
				if (limit === 0) return []
				const concept = partId(look.within, name)
				const first = questionsAbout(concept, told.questions, all.answers).slice(0, limit)
				// Reader-written questions stay private. Only questions from the brief can need another background run.
				for (const question of first.slice(0, told.questions.length)) {
					if (!question.answered) continue
					const answer = all.answers.find((each) => each.id === question.id)
					if (answer && (await stalePoints(look.head, answer.told.points))) question.answered = false
				}
				return first
			},
		}
	}

	function stalePoints(head: CommitHash | undefined, points: BriefPoint[]) {
		return staleFiles(
			layout.repo,
			head,
			points.flatMap((point) => point.quotes),
		)
	}

	async function brief(id: string, now: Date): Promise<Brief | null> {
		const made = await briefOf(id, now)
		return made && !made.explained ? { ...made, trust: GIT_TRUST } : made
	}

	async function briefOf(id: string, now: Date): Promise<Brief | null> {
		const concept = parseConcept(id)
		if (concept === null) return null
		const all = await held(now)
		switch (concept.kind) {
			case 'part':
				return await partBrief(concept, all)
			case 'arrow':
				return await arrowBrief(concept, all)
			case 'term':
				return await termBrief(concept.name, all)
			case 'process':
			case 'step':
				return await processBrief(concept, all)
			case 'decision':
				return decisionBrief(concept.id, all)
			case 'question':
				return await questionBrief(concept.id, all)
			case 'frame':
			case 'store':
			case 'outside':
			case 'crossing': {
				const top = await levelAt([], all.now)
				const views = top?.views
				const found = views && viewBrief(concept.kind, concept.id, views)
				if (!top || !views || !found) return null
				const { id: named, kind, name, line, sideways, ...rest } = found
				const stale = views.stale?.find((item) => item.id === concept.id)
				return {
					...blank(named, kind, name, line),
					explained: true,
					sideways: { ...sideways, processes: [] },
					...(stale && {
						staleFiles: stale.files,
						checkedAt: top.head,
						explain: { lens: { kind: 'views', within: [] } },
					}),
					...rest,
				}
			}
			default:
				return concept satisfies never
		}
	}

	async function partBrief(concept: Extract<Concept, { kind: 'part' }>, all: Held): Promise<Brief | null> {
		const look = await levelAt(concept.within, all.now)
		const box = look?.boxes.find((each) => each.name === concept.name)
		if (!look || !box) return null
		const id = partId(look.within, box.name)
		const told = toldOfPart(all.answered, look.within, box.name)
		const other = (name: string) => ({ id: partId(look.within, name), name })
		const processes = all.drawn.map((each) => processOf(each, partsOf(look)))
		const inPart = (path: string) => box.paths.some((place) => under(path, place))
		const through = processes.filter(
			(process) =>
				process.lanes.some((lane) => lane.part === id) ||
				process.messages.some((message) => message.part === id || message.quotes.some((quote) => inPart(quote.path))),
		)
		// A box of one file has no level inside, only the file.
		const inside = box.opens ? (box.inside ?? (await levelAt(box.paths, all.now))?.boxes.length ?? 0) : 0
		const file = box.file
		const line = told?.line ?? box.job ?? (file ? `The file ${file}.` : folderLine(box))
		const uses = look.arrows.flatMap((arrow) =>
			arrow.from === box.name ? [{ ...other(arrow.to), verb: arrow.text }] : [],
		)
		const usedBy = look.arrows.flatMap((arrow) =>
			arrow.to === box.name ? [{ ...other(arrow.from), verb: arrow.text }] : [],
		)
		// Before ken's model explains a part, plain code asks what its arrows and its files raise.
		const written = told?.questions ?? (told ? [] : codeQuestions(box.name, uses, usedBy, box.files))
		const fields = toldFields(told, all.read)
		const connections = [
			...uses.map((to) => `${box.name} ${to.verb} ${to.name}.`),
			...usedBy.map((by) => `${by.name} ${by.verb} ${box.name}.`),
		]
		return {
			...blank(id, file ? 'file' : 'part', box.name, line),
			...fields,
			staleFiles: await stalePoints(look.head, fields.points),
			minutes: told ? fields.minutes : minutesFor([line, ...connections, ...written]),
			explain: { lens: { kind: 'explain', within: look.within, part: box.name } },
			questions: questionsAbout(id, written, all.answers),
			decisions: decisionsOf(all.read, (decision) => fileQuotes(decision.quotes).some((quote) => inPart(quote.path))),
			sideways: {
				uses,
				usedBy,
				processes: through.map(({ id: process, name, steps }) => ({ id: processId(process), name, steps })),
			},
			// Sorted, as a level's own paths are, so the page asks for the level inside by the same text.
			deeper: file ? null : { within: box.paths.toSorted().join(','), parts: inside, files: box.files },
			...(file ? { source: { path: file, commit: look.head } } : {}),
			knows: box.knows,
		}
	}

	async function arrowBrief(concept: Extract<Concept, { kind: 'arrow' }>, all: Held): Promise<Brief | null> {
		const look = await levelAt(concept.within, all.now)
		const arrow = look?.arrows[concept.n - 1]
		if (!look || !arrow) return null
		const line = `${arrow.from} ${arrow.text} ${arrow.to}.`
		return {
			...blank(arrowId(look.within, concept.n), 'arrow', `${arrow.from} to ${arrow.to}`, line),
			explained: true,
			trust:
				arrow.text === 'imports'
					? 'The quoted import shows a dependency. It does not show which operation runs.'
					: 'ken checked the quoted lines in git. The arrow describes what its model inferred from them.',
			quotes: fileQuotes(arrow.quotes),
		}
	}

	async function termBrief(name: string, all: Held): Promise<Brief | null> {
		const topic = all.read.current.find((entry) => entry.kind === 'topic' && sameName(entry.name, name))
		if (topic?.kind !== 'topic') return null
		const id = termId(topic.name)
		const quotes = fileQuotes(topic.quotes)
		const top = await levelAt([], all.now)
		const outdatedPlaces = await staleFiles(layout.repo, top?.head, quotes)
		const places = quotes.filter((quote) => !outdatedPlaces?.includes(quote.path))
		const parts = top ? partsOf(top) : []
		const [knows = null] = await knowsOf(layout, [knownTerm(topic.name, quotes)], all.now)
		const meaning = meaningOf(all.read, topic.id)
		// ken's model explains a term by answering what it means here, and its newest answer is the term's brief.
		const told = all.answers.find((answer) => answer.concept === id && answer.text === meansWhat(topic.name))?.told
		const words = told ? toldFields(told, all.read) : null
		const usedIn = parts
			.filter((part) => places.some((quote) => part.paths.some((place) => under(quote.path, place))))
			.map(({ id: part, name: called }) => ({ id: part, name: called }))
		// Before ken's model explains a term, its line says where the project uses it, and what the record holds of its
		// meaning, often dense with code, follows as a note.
		const where = usedIn.length > 0 ? usedIn.map((part) => part.name) : [...new Set(places.map((quote) => quote.path))]
		const plain = where.length
			? `A term the project uses in ${listed(where.slice(0, 3))}.`
			: 'A term in the project record.'
		return {
			...blank(id, 'term', topic.name, told?.line ?? plain),
			...(told || outdatedPlaces || !meaning ? {} : { note: meaning }),
			// What the record says a term means is its line; the things to know are the model's alone.
			explained: told !== undefined,
			staleFiles: told
				? await staleFiles(
						layout.repo,
						top?.head,
						told.points.flatMap((point) => point.quotes),
					)
				: outdatedPlaces,
			explain: { lens: { kind: 'answer', concept: id, text: meansWhat(topic.name) } },
			points: [...(words?.points ?? []), ...places.slice(0, TERM_PLACES).map(placePoint)],
			terms: words?.terms.filter((term) => term.id !== id) ?? [],
			minutes: Math.max(words?.minutes ?? 1, minutesFor([meaning ?? ''])),
			questions: questionsAbout(id, [], all.answers),
			decisions: decisionsOf(all.read, (decision) => decision.topic !== null && sameName(decision.topic, topic.name)),
			knows,
			usedIn,
		}
	}

	async function processBrief(
		concept: Extract<Concept, { kind: 'process' | 'step' }>,
		all: Held,
	): Promise<Brief | null> {
		const wanted = concept.kind === 'process' ? concept.id : concept.process
		const drawn = all.drawn.find((each) => each.id === wanted)
		const look = drawn && ((await levelAt(drawn.within, all.now)) ?? (await levelAt([], all.now)))
		if (!drawn || !look) return null
		const process = processOf(drawn, partsOf(look))
		const lane = (at: number) => process.lanes[at]?.name ?? ''
		const steps = process.messages.map(({ n, part, line, quotes }) => ({ n, part, line, quotes }))
		const about = { id: processId(process.id), name: process.name }
		if (concept.kind === 'step') {
			const message = process.messages[concept.n - 1]
			if (!message) return null
			const line = `${lane(message.from)} to ${lane(message.to)}: ${message.line}`
			return {
				...blank(stepId(process.id, message.n), 'step', message.line, line),
				explained: true,
				quotes: message.quotes,
				about,
			}
		}
		const [knows = null] = await knowsOf(layout, [{ thing: 'process', paths: filesOf(process), topic: null }], all.now)
		return {
			...blank(about.id, 'process', process.name, processLine(process)),
			minutes: minutesFor(steps.map((step) => step.line)),
			explained: true,
			questions: questionsAbout(about.id, [], all.answers),
			steps,
			knows,
		}
	}

	function decisionBrief(id: string, all: Held): Brief | null {
		const decision = all.read.entries.find((entry) => entry.kind === 'decision' && entry.id === id)
		if (decision?.kind !== 'decision') return null
		const later = all.read.entries.find((entry) => entry.replaces === decision.id)
		return {
			...blank(decisionId(decision.id), 'decision', decision.question, decision.chosen),
			explained: true,
			quotes: fileQuotes(decision.quotes),
			why: decision.reason?.text ?? '',
			reasonSource: decisionMark(decision),
			...(later ? { replacedBy: decisionId(later.id) } : {}),
			reasonQuotes: decision.reason?.quotes ?? [],
		}
	}

	// A question with an answer opens as the answer. One without is found among the questions ken's model wrote in the
	// briefs of parts, and opens with the lens that asks it.
	async function questionBrief(id: string, all: Held): Promise<Brief | null> {
		const full = `question:${id}`
		const answer = all.answers.find((each) => each.id === full)
		const written = answer ?? writtenQuestion(full, all)
		if (!written) return null
		const of = parseConcept(written.concept)?.kind === 'question' ? null : await brief(written.concept, all.now)
		const about = { id: written.concept, name: of?.name ?? (await nameOf(written.concept, all)) ?? written.concept }
		const base = blank(full, 'question', written.text, answer?.told.line ?? '')
		// The other questions about the same thing stand beside this one.
		const others = (of?.questions ?? []).filter((each) => each.id !== full)
		if (!answer) {
			const lens = { kind: 'answer', concept: written.concept, text: written.text }
			return { ...base, explain: { lens }, about, questions: others }
		}
		const top = await levelAt([], all.now)
		const quoted = [...new Set(answer.told.points.flatMap((point) => point.quotes.map((quote) => quote.path)))]
		const changed = await stalePoints(top?.head, answer.told.points)
		const boxes = (top?.boxes ?? []).filter((box) =>
			quoted.some((path) => box.paths.some((place) => under(path, place))),
		)
		return {
			...base,
			...toldFields(answer.told, all.read),
			staleFiles: changed,
			explain: changed ? { lens: { kind: 'answer', concept: written.concept, text: written.text } } : null,
			about,
			lit: boxes.map((box) => box.name),
			questions: others,
			// Sideways are the parts its answer quotes, and Deeper the files.
			sideways: {
				uses: boxes.map((box) => ({ id: partId([], box.name), name: box.name, verb: 'its answer quotes it' })),
				usedBy: [],
				processes: [],
			},
			deeper: quoted.length > 0 ? { within: quoted.toSorted().join(','), parts: 0, files: quoted.length } : null,
		}
	}

	// The words ken's model wrote of a term so far, for how long its brief takes to read.
	function termTold(id: string, all: Held): string[] {
		const told = all.answers.find((answer) => answer.concept === id)?.told
		return told ? [told.line ?? '', ...told.points.map((point) => point.line)] : []
	}

	// What ken's model said of each part of a level: the parts it explained, and for a part that is one file, the lines
	// it has at HEAD and the sentence the model wrote of it.
	async function levelTold(look: LayoutLook): Promise<{ explained: string[]; files: FileTold[] }> {
		const all = await held(new Date())
		const told = look.boxes.map((box) => toldOfPart(all.answered, look.within, box.name))
		const files = await Promise.all(
			look.boxes.flatMap((box, at) => {
				const [path] = box.paths
				const file =
					box.file || (look.named && box.files === 1 && box.paths.length === 1 && path?.split('/').at(-1) === box.name)
				if (!file || !path) return []
				return [fileTold(box.name, path, look.head, told[at]?.line ?? null)]
			}),
		)
		const explained = look.boxes.flatMap((box, at) => (told[at] ? [box.name] : []))
		return { explained, files: files.flatMap((each) => each ?? []) }
	}

	async function fileTold(name: string, raw: string, head: CommitHash, line: string | null): Promise<FileTold | null> {
		const path = parsePath(raw)
		if (path.kind !== 'ok') return null
		const read = await layout.repo.readFile(head, path.path)
		return read.kind === 'ok'
			? { name, lines: read.text.split('\n').length - (read.text.endsWith('\n') ? 1 : 0), line }
			: null
	}

	function writtenQuestion(id: string, all: Held): { concept: string; text: string } | null {
		for (const { reply } of all.answered) {
			for (const [k, stop] of (reply.tour?.stops ?? []).entries()) {
				const concept = partId(reply.tour?.within ?? [], stop.name)
				const step = reply.items.find((item) => item.kind === 'step' && item.number === k + 1)
				const text = (step?.kind === 'step' ? (step.questions ?? []) : []).find(
					(each) => questionId(concept, each) === id,
				)
				if (text !== undefined) return { concept, text }
			}
		}
		return null
	}

	// What the reader would call a concept, for the line that says what a question is about. null for one ken does
	// not have.
	async function nameOf(id: string, all: Held): Promise<string | null> {
		const concept = parseConcept(id)
		if (concept?.kind === 'question') return all.answers.find((each) => each.id === id)?.text ?? null
		return concept ? ((await brief(id, all.now))?.name ?? null) : null
	}

	// Everything search can find: the parts of the top level and of every level ken's model named, the terms and the
	// drawn processes. A topic that only stands for a part is found as the part.
	async function concepts(now: Date): Promise<ConceptRow[]> {
		const all = await held(now)
		const scopes = new Map<string, string[]>([['', []]])
		for (const entry of all.read.current) if (entry.kind === 'layout') scopes.set(entry.within.join('\n'), entry.within)
		const looks = (await Promise.all([...scopes.values()].map((within) => levelAt(within, now)))).flatMap(
			(look) => look ?? [],
		)
		const parts = looks.flatMap((look) =>
			look.boxes.map((box) => {
				const told = toldOfPart(all.answered, look.within, box.name)
				const line = told?.line ?? box.job ?? folderLine(box)
				return {
					id: partId(look.within, box.name),
					kind: 'part' as const,
					name: box.name,
					line,
					minutes: told ? toldFields(told, all.read).minutes : minutesFor([line]),
					level: box.knows.level,
				}
			}),
		)
		const topics = all.read.current.flatMap((entry) =>
			entry.kind === 'topic' && !parts.some((part) => sameName(part.name, entry.name)) ? [entry] : [],
		)
		const [top] = looks
		const views = top?.views
			? viewRows(top.views).map((row) => ({ ...row, minutes: minutesFor([row.line]), level: null }))
			: []
		const processes = all.drawn.map((each) => processOf(each, top ? partsOf(top) : []))
		const known = await knowsOf(
			layout,
			[
				...topics.map((topic) => knownTerm(topic.name, fileQuotes(topic.quotes))),
				...processes.map((process) => ({ thing: 'process' as const, paths: filesOf(process), topic: null })),
			],
			now,
		)
		return [
			...parts,
			...topics.map((topic, at) => ({
				id: termId(topic.name),
				kind: 'term' as const,
				name: topic.name,
				line: meaningOf(all.read, topic.id) ?? '',
				minutes: minutesFor([meaningOf(all.read, topic.id) ?? '', ...termTold(termId(topic.name), all)]),
				level: known[at]?.level ?? null,
			})),
			...processes.map((process, at) => ({
				id: processId(process.id),
				kind: 'process' as const,
				name: process.name,
				line: processLine(process),
				minutes: minutesFor(process.messages.map((message) => message.line)),
				level: known[topics.length + at]?.level ?? null,
			})),
			...views,
		]
	}

	// The drawn processes that rest on a file of the level, with their lanes matched to its parts, and the processes
	// ken's model found worth drawing there. null when the paths are not in the project.
	async function processes(within: string[], now: Date): Promise<{ processes: Process[]; offers: string[] } | null> {
		const look = await levelAt(within, now)
		if (!look) return null
		const all = await held(now)
		const parts = partsOf(look)
		const inScope = (process: Process) =>
			look.within.length === 0 || filesOf(process).some((file) => look.within.some((place) => under(file, place)))
		return {
			processes: all.drawn.map((each) => processOf(each, parts)).filter(inScope),
			offers: look.named?.flows ?? [],
		}
	}

	return { brief, concepts, processes, levelProgress, levelTold }
}

// A brief with nothing in it but what every kind has.
function blank(id: string, kind: Brief['kind'], name: string, line: string): Brief {
	return {
		id,
		kind,
		name,
		line,
		minutes: minutesFor([line]),
		explained: false,
		explain: null,
		points: [],
		terms: [],
		questions: [],
		decisions: [],
		sideways: { uses: [], usedBy: [], processes: [] },
		deeper: null,
		steps: null,
		knows: null,
		trust: TRUST,
	}
}

// What the model told, as the fields of a brief. A term the record does not hold has no brief to open, so it is left
// out, and each is spelled as the record spells it.
function toldFields(told: Told | null, read: RecordRead): Pick<Brief, 'explained' | 'points' | 'terms' | 'minutes'> {
	const points = told?.points ?? []
	const terms = (told?.terms ?? []).flatMap((name) => {
		const topic = read.current.find((entry) => entry.kind === 'topic' && sameName(entry.name, name))
		return topic?.kind === 'topic' ? [{ id: termId(topic.name), name: topic.name }] : []
	})
	const words = [told?.line ?? '', ...points.flatMap((point) => [point.line, point.more, point.long])]
	return { explained: points.length > 0, points, terms, minutes: minutesFor(words) }
}

// The questions ken's model wrote in the brief, then the ones the reader asked themselves, each with whether a saved
// reply answers it.
function questionsAbout(concept: string, written: string[], answers: Answer[]): Brief['questions'] {
	const mine = answers.filter((answer) => answer.concept === concept)
	const listed = written.map((text) => {
		const id = questionId(concept, text)
		return { id, text, answered: mine.some((answer) => answer.id === id) }
	})
	const asked = mine.filter((answer) => !listed.some((question) => question.id === answer.id))
	return [...listed, ...asked.map(({ id, text }) => ({ id, text, answered: true }))]
}

type Decided = Extract<RecordRead['current'][number], { kind: 'decision' }>

function decisionsOf(read: RecordRead, about: (decision: Decided) => boolean): Brief['decisions'] {
	return read.current.flatMap((entry) =>
		entry.kind === 'decision' && about(entry)
			? [
					{
						id: decisionId(entry.id),
						question: entry.question,
						chosen: entry.chosen,
						why: entry.reason?.text ?? '',
						reasonSource: decisionMark(entry),
					},
				]
			: [],
	)
}

// What a term means: the newest note the record keeps on its topic, in the model's words. null when it has none.
function meaningOf(read: RecordRead, topic: string): string | null {
	const note = read.current.findLast((entry) => entry.kind === 'note' && entry.topic === topic)
	return note?.kind === 'note' ? note.text : null
}

// One place the code uses a term, as a thing to know. Plain code writes the words, from the quote alone.
function placePoint(quote: BriefQuote): BriefPoint {
	const lines =
		quote.startLine === quote.endLine ? `line ${quote.startLine}` : `lines ${quote.startLine} to ${quote.endLine}`
	const more = `Find it in ${quote.path}, ${lines}.`
	return { line: `Find it in ${quote.path}.`, more, long: more, drawing: { kind: 'dot' }, quotes: [quote] }
}

function knownTerm(topic: string, quotes: BriefQuote[]) {
	return { thing: 'term' as const, paths: [...new Set(quotes.map((quote) => quote.path))], topic }
}

function partsOf(look: LayoutLook): PartRef[] {
	return look.boxes.map((box) => ({ id: partId(look.within, box.name), name: box.name, paths: box.paths }))
}

function filesOf(process: Process): string[] {
	return [...new Set(process.messages.flatMap((message) => message.quotes.map((quote) => quote.path)))]
}

function processLine(process: Process): string {
	const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)
	return `${count(process.steps, 'step')} across ${count(process.lanes.length, 'lane')}.`
}

// A folder nobody named says what git says of it.
// Up to three questions from a part's arrows and its files, such as "How does Plugin engine run code in Sandbox?".
function codeQuestions(name: string, uses: Neighbour[], usedBy: Neighbour[], files: number): string[] {
	const asked = [
		...uses.map((to) => `How does ${name} ${baseVerb(to.verb)} ${to.name}?`),
		...usedBy.map((by) => `How does ${by.name} ${baseVerb(by.verb)} ${name}?`),
	].slice(0, files > 1 ? 2 : 3)
	return files > 1 ? [...asked, `Which of its ${files} files should I read first?`] : asked
}

// "runs code in" as "run code in", for a question that starts "How does".
function baseVerb(verb: string): string {
	const [first = '', ...rest] = verb.split(' ')
	const IRREGULAR: Record<string, string> = { is: 'be', has: 'have', does: 'do', goes: 'go' }
	const base =
		IRREGULAR[first] ??
		(/(ss|sh|ch|x|z)es$/.test(first)
			? first.slice(0, -2)
			: /ies$/.test(first)
				? `${first.slice(0, -3)}y`
				: /[^s]s$/.test(first)
					? first.slice(0, -1)
					: first)
	return [base, ...rest].join(' ')
}

function listed(names: string[]): string {
	return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function folderLine(box: LookBox): string {
	const files = box.files === 1 ? '1 file' : `${box.files} files`
	return `${files} in ${box.paths.join(', ')}. ken's model has not named this part.`
}

function minutesFor(texts: string[]): number {
	const words = texts.reduce((sum, text) => sum + wordCount(text), 0)
	return Math.max(1, Math.ceil(words / WORDS_A_MINUTE))
}
