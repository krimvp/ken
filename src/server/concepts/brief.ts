// The brief of one concept, as the page opens it in its drawer. Plain code builds it on every read from what ken
// holds: the layout for a part's job, its arrows and what is inside it, the record for decisions and terms, the
// reader's saved replies for what ken's model told them, and what they looked at for what ken thinks they know. No
// model runs here. A part the model has not explained still has a brief, with the lens that asks for the rest.
import { wordCount } from '../../agent/index.ts'
import type { History } from '../../history/index.ts'
import {
	type Knows,
	knowsOf,
	type LayoutLook,
	type LayoutSources,
	type LookBox,
	lookAtLayout,
	readLayoutAsk,
	under,
} from '../../layout/index.ts'
import { type RecordRead, sameName } from '../../record/index.ts'
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
	type Told,
	toldOfPart,
} from './told.ts'

export const TRUST = "ken's model wrote the words. ken found each quoted line in git."
// What a brief says of its words while ken's model has said nothing of the concept.
export const GIT_TRUST = "ken found this in git. ken's model has not explained it yet."

type Named = { id: string; name: string }
type Neighbour = Named & { verb: string }

// explained is false while nothing from the model is here: points, terms and questions are then empty, and explain is
// what to send to /api/questions to have ken's model write them. quotes is there for a decision, an arrow and a step,
// about for a question and a step, usedIn for a term, and why for a decision.
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
	decisions: { id: string; question: string; chosen: string; why: string }[]
	sideways: { uses: Neighbour[]; usedBy: Neighbour[]; processes: { id: string; name: string; steps: number }[] }
	deeper: { within: string; parts: number; files: number } | null
	steps: { n: number; part: string | null; line: string; quotes: BriefQuote[] }[] | null
	knows: Knows | null
	trust: string
	about?: Named
	usedIn?: Named[]
	// For a question: the parts of the top level its answer quotes, which its picture lights.
	lit?: string[]
	quotes?: BriefQuote[]
	why?: string
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
		const [only] = box.paths
		const file = !look.named && box.files === 1 && box.paths.length === 1 && only?.split('/').at(-1) === box.name
		const line = told?.line ?? box.job ?? (file ? `The file ${only}.` : folderLine(box))
		return {
			...blank(id, file ? 'file' : 'part', box.name, line),
			...toldFields(told, all.read),
			explain: { lens: { kind: 'explain', within: look.within, part: box.name } },
			questions: questionsAbout(id, told?.questions ?? [], all.answers),
			decisions: decisionsOf(all.read, (decision) => fileQuotes(decision.quotes).some((quote) => inPart(quote.path))),
			sideways: {
				uses: look.arrows.flatMap((arrow) =>
					arrow.from === box.name ? [{ ...other(arrow.to), verb: arrow.text }] : [],
				),
				usedBy: look.arrows.flatMap((arrow) =>
					arrow.to === box.name ? [{ ...other(arrow.from), verb: arrow.text }] : [],
				),
				processes: through.map(({ id: process, name, steps }) => ({ id: processId(process), name, steps })),
			},
			// Sorted, as a level's own paths are, so the page asks for the level inside by the same text.
			deeper: { within: box.paths.toSorted().join(','), parts: inside, files: box.files },
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
			quotes: fileQuotes(arrow.quotes),
		}
	}

	async function termBrief(name: string, all: Held): Promise<Brief | null> {
		const topic = all.read.current.find((entry) => entry.kind === 'topic' && sameName(entry.name, name))
		if (topic?.kind !== 'topic') return null
		const id = termId(topic.name)
		const quotes = fileQuotes(topic.quotes)
		const top = await levelAt([], all.now)
		const parts = top ? partsOf(top) : []
		const [knows = null] = await knowsOf(layout, [knownTerm(topic.name, quotes)], all.now)
		const meaning = meaningOf(all.read, topic.id)
		// ken's model explains a term by answering what it means here, and its newest answer is the term's brief.
		const told = all.answers.find((answer) => answer.concept === id && answer.text === meansWhat(topic.name))?.told
		const words = told ? toldFields(told, all.read) : null
		return {
			...blank(id, 'term', topic.name, told?.line ?? meaning ?? ''),
			explained: meaning !== null || told !== undefined,
			explain: { lens: { kind: 'answer', concept: id, text: meansWhat(topic.name) } },
			points: [...(words?.points ?? []), ...quotes.slice(0, TERM_PLACES).map(placePoint)],
			terms: words?.terms.filter((term) => term.id !== id) ?? [],
			minutes: Math.max(words?.minutes ?? 1, minutesFor([meaning ?? ''])),
			questions: questionsAbout(id, [], all.answers),
			decisions: decisionsOf(all.read, (decision) => decision.topic !== null && sameName(decision.topic, topic.name)),
			knows,
			usedIn: parts
				.filter((part) => quotes.some((quote) => part.paths.some((place) => under(quote.path, place))))
				.map(({ id: part, name: called }) => ({ id: part, name: called })),
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
		return {
			...blank(decisionId(decision.id), 'decision', decision.question, decision.chosen),
			explained: true,
			quotes: fileQuotes(decision.quotes),
			why: decision.reason?.text ?? '',
		}
	}

	// A question with an answer opens as the answer. One without is found among the questions ken's model wrote in the
	// briefs of parts, and opens with the lens that asks it.
	async function questionBrief(id: string, all: Held): Promise<Brief | null> {
		const full = `question:${id}`
		const answer = all.answers.find((each) => each.id === full)
		const written = answer ?? writtenQuestion(full, all)
		if (!written) return null
		const about = { id: written.concept, name: (await nameOf(written.concept, all)) ?? written.concept }
		const base = blank(full, 'question', written.text, answer?.told.line ?? '')
		if (!answer) {
			return { ...base, explain: { lens: { kind: 'answer', concept: written.concept, text: written.text } }, about }
		}
		const top = await levelAt([], all.now)
		const quoted = answer.told.points.flatMap((point) => point.quotes.map((quote) => quote.path))
		const lit = (top?.boxes ?? [])
			.filter((box) => quoted.some((path) => box.paths.some((place) => under(path, place))))
			.map((box) => box.name)
		return { ...base, ...toldFields(answer.told, all.read), about, lit }
	}

	// The words ken's model wrote of a term so far, for how long its brief takes to read.
	function termTold(id: string, all: Held): string[] {
		const told = all.answers.find((answer) => answer.concept === id)?.told
		return told ? [told.line ?? '', ...told.points.map((point) => point.line)] : []
	}

	// What ken's model said of each part of a level: how many parts it explained, and for a part that is one file, the
	// lines it has at HEAD and the sentence the model wrote of it.
	async function levelTold(look: LayoutLook): Promise<{ explained: number; files: FileTold[] }> {
		const all = await held(new Date())
		const told = look.boxes.map((box) => toldOfPart(all.answered, look.within, box.name))
		const files = await Promise.all(
			look.boxes.flatMap((box, at) => {
				const [path] = box.paths
				const file = box.files === 1 && box.paths.length === 1 && path?.split('/').at(-1) === box.name
				if (!file || !path) return []
				return [fileTold(box.name, path, look.head, told[at]?.line ?? null)]
			}),
		)
		return { explained: told.filter(Boolean).length, files: files.flatMap((each) => each ?? []) }
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

	return { brief, concepts, processes, levelTold }
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
			? [{ id: decisionId(entry.id), question: entry.question, chosen: entry.chosen, why: entry.reason?.text ?? '' }]
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
function folderLine(box: LookBox): string {
	const files = box.files === 1 ? '1 file' : `${box.files} files`
	return `${files} in ${box.paths.join(', ')}. ken's model has not named this part.`
}

function minutesFor(texts: string[]): number {
	const words = texts.reduce((sum, text) => sum + wordCount(text), 0)
	return Math.max(1, Math.ceil(words / WORDS_A_MINUTE))
}
