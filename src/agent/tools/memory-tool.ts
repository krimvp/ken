// What ken holds, as the model may ask for it: an index of the project record at the start of a question, and the
// memory tools over the record, the briefs and answers saved in the reader's history, and this chat's earlier answers.
// A model that needs to go deeper asks memory first and reads only the lines memory lacks or marks as changed. Every
// quote a tool returns is checked at HEAD as it goes out. The model never writes here; only a reply does, through the
// cards it shows, and show checks every quote against git again.
import type { Tool } from 'aigent/plugin'
import { fileQuotesAtHead } from '../../checks/index.ts'
import { stateLine, type UnderstandingMap } from '../../map/index.ts'
import {
	describeEntry,
	entryLine,
	type Kind,
	noteFreshness,
	type RecordEntry,
	type RecordRead,
	type RecordStore,
	sameName,
} from '../../record/index.ts'
import type { CommitHash, Repository } from '../../repo/index.ts'
import type { Asking, QuestionFocus } from '../reply/show-tool.ts'
import { readArgs, refuse, reply } from './tool-edge.ts'

const KINDS = ['work', 'decision', 'topic', 'note', 'layout'] as const satisfies Kind[]
const MAX_INDEXED = 12

export type MemoryQuote = { path: string; commit: CommitHash; startLine: number; endLine: number; text: string }

type Named = { id: string; name: string }

// What ken holds of one concept: its line, its things to know with the lines each quotes, its terms and its
// questions. id is the concept's name in ken, such as part::Core. uses and usedBy are its arrows, each with its verb,
// and contains the concepts inside it.
export type Known = {
	id: string
	kind: string
	name: string
	line: string
	reader: string | null
	quotes: MemoryQuote[]
	changed: string[]
	uses: (Named & { verb: string })[]
	usedBy: (Named & { verb: string })[]
	contains: Named[]
	points: { line: string; quotes: MemoryQuote[] }[]
	terms: string[]
	questions: { text: string; answered: boolean }[]
}

// A named level: its one line, its parts with their jobs and paths and whether ken's model has written their brief,
// its arrows, and the processes ken's model found worth drawing.
export type KnownLevel = {
	within: string[]
	about: string | null
	parts: { name: string; job: string | null; paths: string[]; explained: boolean }[]
	arrows: { from: string; to: string; text: string }[]
	flows: string[]
}

// One thing ken holds, for search and for what quotes a file: a thing to know of a brief or an answer, or a term.
export type Fact = {
	about: string
	name: string
	kind: 'brief' | 'answer' | 'term'
	text: string
	quotes: MemoryQuote[]
}

// The one part of the current layouts that a free question names. reader is the reader's last statement about it, or
// ''. source is the start of its file at commit when it has one file, and neighbor another part of the same layout,
// with the start of its file when the question asks where to read next.
export type ReaderPart = {
	focus: QuestionFocus
	part: Named
	commit: string
	drawnAt: string
	reader: string
	source: { path: string; end: number; text: string } | null
	neighbor: {
		name: string
		path: string
		source: { end: number; text: string } | null
		arrow: string[] | null
	} | null
}

// Plain code on the server answers these from the layout, the record and the reader's history.
export type Memory = {
	readerPart(question: string, record: RecordRead, signal?: AbortSignal): Promise<ReaderPart | null>
	known(about: string): Promise<Known | null>
	level(within: string[]): Promise<KnownLevel | null>
	facts(): Promise<Fact[]>
}

// What a question's first message says of the part it names.
export function readerPartText(found: ReaderPart): string {
	const { part, commit, reader, source, neighbor } = found
	const lines = [
		reader ? `Reader's map for ${part.name}: ${reader}` : '',
		`The layout at ${found.drawnAt.slice(0, 7)} names this part ${JSON.stringify(part.name)}. Open ${part.id} with memory_known for more.`,
		neighbor
			? `Another part in the same layout is ${JSON.stringify(neighbor.name)}. Its path ${JSON.stringify(neighbor.path)} exists at this commit.`
			: '',
		neighbor?.source
			? `Ken also read lines 1 to ${neighbor.source.end} of ${JSON.stringify(neighbor.path)} at ${commit}:\n${neighbor.source.text}`
			: '',
		neighbor?.arrow ? `The saved layout connects them: ${JSON.stringify(neighbor.arrow)}.` : '',
		source
			? `Ken read ${JSON.stringify(source.path)} at ${commit}. Lines 1 to ${source.end} are quoted as data:\n${source.text}`
			: '',
		'Base your explanation and next reading suggestion on this evidence. Check other files before suggesting them. Use show to quote the relevant lines.',
	]
	return lines.filter(Boolean).join('\n')
}

// Earlier answers, as thread memory finds them: in this chat by words or as chat:2, and the answers saved on earlier
// visits by words or by id.
export type ChatRecall = {
	known(id: string): Promise<string | undefined>
	search(words: string, start: number, limit: number): Promise<{ total: number; hits: { id: string; text: string }[] }>
}

export const MEMORY_TOOLS = ['memory_known', 'memory_level', 'memory_quoted_in', 'memory_search'] as const
export type MemoryTool = (typeof MEMORY_TOOLS)[number]

const CAPS = {
	known: 2000,
	level: 3000,
	quotedIn: { entries: 40, chars: 2000 },
	search: { hits: 20, chars: 3000 },
}
const CHANGED = 'changed since: read the file again'
// What ken holds of these comes from the reader's saved answers: a term's meaning, a question, a drawn process.
const HISTORY_KINDS = ['term', 'question', 'process', 'step']

type Anchor = Pick<MemoryQuote, 'path' | 'startLine' | 'endLine'> & { changed: boolean }

function memoryAnchors(repo: Repository, signal?: AbortSignal) {
	const locate = fileQuotesAtHead(repo, signal)
	return (quotes: MemoryQuote[]) =>
		Promise.all(
			quotes.map(async (quote): Promise<Anchor> => {
				const found = await locate(quote)
				const { startLine, endLine } = found ?? quote
				return { path: quote.path, startLine, endLine, changed: found === null }
			}),
		)
}

function anchorText(at: Anchor): string {
	const lines = at.startLine === at.endLine ? at.startLine : `${at.startLine}-${at.endLine}`
	return `${at.path}:${lines}${at.changed ? ` (${CHANGED})` : ''}`
}

function factLine(fact: Fact, at: Anchor[], limit?: number): string {
	const detail = `${fact.kind} of ${fact.about} (${fact.name}): ${fact.text}${at.length ? ` [${at.map(anchorText).join(', ')}]` : ''}`
	if (limit === undefined || detail.length <= limit) return detail
	// Never let a clipped search result turn a changed quote back into an unqualified claim.
	const status = at.some((anchor) => anchor.changed) ? `[${CHANGED}] ` : ''
	return shortLine(`${status}${fact.kind} of ${fact.about}: ${at.map(anchorText).join(', ')} ${fact.text}`, limit)
}

// asked is what the reader asked and was told: their map of the topics and the earlier answers. recalled runs when a
// tool gives the run text of the reader's saved answers or questions. A run whose output goes into the project record
// gets null, so memory gives it the record and the briefs ken wrote from the code alone.
export function memoryTools(deps: {
	store: RecordStore
	repo: Repository
	memory?: Memory | undefined
	asked: { map?: UnderstandingMap | undefined; chat: ChatRecall; recalled: () => void } | null
}): Tool[] {
	const { store, repo, memory, asked } = deps
	const map = asked?.map
	const recalled = () => asked?.recalled()
	const chat = asked?.chat
	const visibleFacts = async () => ((await memory?.facts()) ?? []).filter((fact) => asked || fact.kind !== 'answer')

	const known: Tool = {
		name: 'memory_known',
		description: `What ken already holds of one thing: a part, a term, a process or a question, by its id (such as part::Core) or its name; an entry of the project record by its id; or an earlier answer, as chat:2 in this chat or by the id memory_search gave. A concept comes with its line, its things to know with the lines each quotes, its terms and its questions, each quote marked fresh or ${CHANGED}. At most ${CAPS.known} characters.`,
		parameters: {
			type: 'object',
			properties: {
				about: { type: 'string', description: 'An id or a name' },
				from: { type: 'integer', minimum: 1, description: 'Where a previous read says to continue' },
			},
			required: ['about'],
			additionalProperties: false,
		},
		async execute(args, ctx) {
			const read = readArgs(args, 'memory_known')
			const about = read.text('about').trim()
			const page = (text: string) => reply(memoryPage(text, read.optionalLine('from') ?? 1))
			if (/^chat:\d+$/.test(about)) {
				const found = await chat?.known(about)
				if (!found) return refuse(`There is no answer ${about} in this chat.`)
				recalled()
				return page(found)
			}
			const record = await store.read()
			const entry = record.entries.find(
				(other) => other.id === about || (other.kind === 'decision' && `decision:${other.id}` === about),
			)
			if (entry) {
				const full = await describeEntry(repo, record, entry, ctx.signal)
				if (entry.kind !== 'topic' || !map) return page(full)
				const read = await map.read(new Date(), ctx.signal, { record, names: [entry.name] })
				const state = read.states[0]
				return page(state ? `Reader: ${stateLine(state)}\n${full}` : full)
			}
			const found = await memory?.known(about)
			// A term's brief can come from a private answer. A shared run gets the term as the project recorded it.
			if (!asked && found?.kind === 'term') {
				const topic = record.current.find((entry) => entry.kind === 'topic' && sameName(entry.name, found.name))
				return topic
					? page(await describeEntry(repo, record, topic, ctx.signal))
					: refuse(`There is no recorded topic "${found.name}".`)
			}
			// Processes and their steps can come from a diagram in a private reply.
			const held = !asked && found && HISTORY_KINDS.includes(found.kind) ? null : found
			const saved = held ? undefined : await chat?.known(about)
			if (saved) {
				recalled()
				return page(saved)
			}
			if (!held) return refuse(`ken holds nothing on "${about}". Search memory with memory_search, or read the code.`)
			const anchors = memoryAnchors(repo, ctx.signal)
			const sources = await anchors(held.quotes)
			const points = await Promise.all(
				held.points.map(
					async (point) => `- ${point.line} [${(await anchors(point.quotes)).map(anchorText).join(', ')}]`,
				),
			)
			const questions = asked
				? held.questions.map((question) => `- ${question.text}${question.answered ? ' (answered)' : ''}`)
				: []
			if (questions.length > 0 || HISTORY_KINDS.includes(held.kind)) recalled()
			const text = [
				`${held.kind} ${held.id} (${held.name}): ${held.line}`,
				...(held.changed.length
					? [`Earlier description: check the changed source in ${held.changed.join(', ')}.`]
					: []),
				...(sources.length ? [`Source: ${sources.map(anchorText).join(', ')}`] : []),
				...(map && held.reader ? [`Reader's map (addressed to the reader): ${held.reader}`] : []),
				...(points.length
					? ['Things to know:', ...points]
					: sources.length
						? []
						: ["ken's model has not explained it yet."]),
				...held.uses.map((link) => `From ${held.name} to ${link.name}: ${link.verb} (${link.id})`),
				...held.usedBy.map((link) => `From ${link.name} to ${held.name}: ${link.verb} (${link.id})`),
				...held.contains.map((child) => `Contains ${child.name} (${child.id})`),
				...(held.terms.length ? [`Terms: ${held.terms.join(', ')}`] : []),
				...(questions.length ? ['Questions:', ...questions] : []),
			]
			return page(text.join('\n'))
		},
	}

	const level: Tool = {
		name: 'memory_level',
		description: `A named level of the project as ken holds it: what it is in one line, its parts with their jobs and paths and whether each has a brief, its arrows, and the processes worth drawing. within is the paths of the level; [] is the whole project. At most ${CAPS.level} characters.`,
		parameters: {
			type: 'object',
			properties: { within: { type: 'array', items: { type: 'string' } } },
			required: ['within'],
			additionalProperties: false,
		},
		async execute(args) {
			const within = Array.isArray(args.within) ? args.within.map(String) : []
			const held = await memory?.level(within)
			if (!held) return refuse('ken has no named level there. Give the paths of a level, or [] for the whole project.')
			const text = [
				`Level ${JSON.stringify(held.within)}: ${held.about ?? 'no line yet'}`,
				'Parts:',
				...held.parts.map(
					(part) =>
						`- ${part.name} (${part.paths.join(', ')})${part.job ? `: ${part.job}` : ''}${part.explained ? '' : ' [no brief yet]'}`,
				),
				...(held.arrows.length
					? ['Arrows:', ...held.arrows.map((arrow) => `- ${arrow.from} ${arrow.text} ${arrow.to}`)]
					: []),
				...(held.flows.length ? [`Processes: ${held.flows.join('; ')}`] : []),
			]
			return reply(capped(text, CAPS.level))
		},
	}

	const quotedIn: Tool = {
		name: 'memory_quoted_in',
		description: `The briefs, answers and terms ken holds that quote a file, or lines of it, each with what it says and the lines it quotes, marked fresh or ${CHANGED}. path may be a folder. At most ${CAPS.quotedIn.entries} entries and ${CAPS.quotedIn.chars} characters per page. Pass the returned from value to continue.`,
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string' },
				start: { type: 'integer', minimum: 1 },
				end: { type: 'integer', minimum: 1 },
				from: { type: 'integer', minimum: 1 },
			},
			required: ['path'],
			additionalProperties: false,
		},
		async execute(args, ctx) {
			const read = readArgs(args, 'memory_quoted_in')
			const path = read.text('path').replace(/\/+$/, '')
			const start = read.optionalLine('start') ?? 1
			const end = read.optionalLine('end') ?? Number.POSITIVE_INFINITY
			const anchors = memoryAnchors(repo, ctx.signal)
			const facts = await visibleFacts()
			const from = read.optionalLine('from') ?? 1
			const heading = `Quotes of ${shortLine(path, 300)}:`
			const continuation = (index: number) => `Continue with from ${index}.`
			const lines = [heading]
			// Leave room for the continuation even when one fact would fill the entire page.
			const budget = CAPS.quotedIn.chars - heading.length - continuation(facts.length).length - 2
			let left = budget
			for (let index = from - 1; index < facts.length; index++) {
				const fact = facts[index]
				if (!fact) continue
				const inPath = fact.quotes.filter((quote) => quote.path === path || quote.path.startsWith(`${path}/`))
				if (inPath.length === 0) continue
				const at = (await anchors(inPath)).filter((quote) => quote.startLine <= end && quote.endLine >= start)
				if (at.length === 0) continue
				const line = factLine(fact, at, budget)
				if (line.length > left || lines.length > CAPS.quotedIn.entries) {
					lines.push(continuation(index + 1))
					break
				}
				if (fact.kind === 'answer') recalled()
				lines.push(line)
				left -= line.length + 1
			}
			if (lines.length === 1)
				return reply(
					from > 1
						? 'The end of these quotes.'
						: `ken holds nothing that quotes ${shortLine(path, 300)}${start > 1 || end < Infinity ? ' there' : ''}.`,
				)
			return reply(lines.join('\n'))
		},
	}

	const search: Tool = {
		name: 'memory_search',
		description: `Search what ken holds by words: earlier answers from this chat and previous visits, the things to know of saved briefs and answers, terms, and the entries of the project record (work, decisions, topics, notes and named levels), newest first. kind keeps only record entries of that kind; with no words it lists them. Open one with memory_known. At most ${CAPS.search.hits} hits and ${CAPS.search.chars} characters a page.`,
		parameters: {
			type: 'object',
			properties: {
				words: { type: 'string', description: 'Words to look for, in any case' },
				kind: { type: 'string', enum: KINDS },
				page: { type: 'integer', minimum: 1, description: 'The page of hits. Defaults to 1.' },
			},
			additionalProperties: false,
		},
		async execute(args, ctx) {
			const read = readArgs(args, 'memory_search')
			const words =
				read
					.optionalText('words')
					?.toLowerCase()
					.match(/[\p{L}\p{N}_.-]+/gu) ?? []
			const kind = read.optionalText('kind')
			const page = read.optionalLine('page') ?? 1
			const has = (text: string) => {
				const lower = text.toLowerCase()
				return words.every((word) => lower.includes(word))
			}
			const record = await store.read()
			const entries = record.current
				.filter((entry) => (kind === undefined || entry.kind === kind) && has(JSON.stringify(entry)))
				.reverse()
				.sort((a, b) => b.at.localeCompare(a.at))
			const asked = kind === undefined && words.length > 0
			const start = (page - 1) * CAPS.search.hits
			const answers =
				asked && chat ? await chat.search(words.join(' '), start, CAPS.search.hits) : { total: 0, hits: [] }
			const facts = asked ? (await visibleFacts()).filter((fact) => has(`${fact.name} ${fact.text}`)) : []
			const anchors = memoryAnchors(repo, ctx.signal)
			const otherHits: { saved: boolean; line: (limit: number) => Promise<string> }[] = [
				...facts.map((fact) => ({
					saved: fact.kind === 'answer',
					line: async (limit: number) => factLine(fact, await anchors(fact.quotes), limit),
				})),
				...entries.map((entry) => ({ saved: false, line: async () => entryLine(entry) })),
			]
			const otherStart = Math.max(0, start - answers.total)
			const others = otherHits.slice(otherStart, otherStart + CAPS.search.hits - answers.hits.length)
			if (answers.hits.length > 0 || others.some((hit) => hit.saved)) recalled()
			const shown = [
				...answers.hits.map((each) => async () => `answer ${each.id}: ${each.text}`),
				...others.map((hit) => hit.line),
			]
			const total = answers.total + otherHits.length
			const more = page * CAPS.search.hits < total ? `\nAsk for page ${page + 1} for more.` : ''
			const header = `${total} hits:`
			const budget = Math.floor((CAPS.search.chars - header.length - more.length) / Math.max(1, shown.length)) - 1
			const lines = await Promise.all(shown.map(async (hit) => shortLine(await hit(budget), budget)))
			return reply([header, ...lines].join('\n') + more)
		},
	}

	// Without what the server holds, only the record and earlier answers are there to ask.
	return memory ? [known, level, quotedIn, search] : [known, search]
}

// Keep a quoted line together when it fits. A longer line can be read across two pages.
function memoryPage(text: string, from: number): string {
	const start = from - 1
	if (start >= text.length) return 'The end of this entry.'
	if (text.length - start <= CAPS.known) return text.slice(start)
	const limit = start + CAPS.known - `\nContinue with from ${text.length}.`.length
	const newline = text.lastIndexOf('\n', limit - 1)
	const end = newline >= start ? newline + 1 : limit
	return `${text.slice(start, end)}\nContinue with from ${end + 1}.`
}

// Whole lines up to the cap, and a last line that says what was left out.
function capped(lines: string[], most: number): string {
	const kept: string[] = []
	let size = 0
	for (const [at, line] of lines.entries()) {
		const cut = `... ${lines.length - at} more lines left out.`
		if (size + line.length + 1 > most - cut.length) {
			kept.push(cut)
			break
		}
		kept.push(line)
		size += line.length + 1
	}
	return kept.join('\n')
}

// A lens puts instructions and examples after the question. Match its subject, so those words cannot outrank it.
function focus(question: string, as: Asking): string {
	switch (as.kind) {
		case 'answer':
			return `${as.text} ${as.concept}`
		case 'explain':
			return as.tour.stops.flatMap((stop) => [stop.name, ...stop.paths]).join(' ')
		case 'view':
			return [as.text, ...as.within].join(' ')
		case 'change':
			return `${as.range.base.slice(0, 12)} ${as.range.head.slice(0, 12)}`
		default:
			return question
	}
}

function entrySubject(entry: Exclude<RecordEntry, { kind: 'note' }>): string {
	switch (entry.kind) {
		case 'work':
			return `${entry.title} ${entry.range.base.slice(0, 12)} ${entry.range.head.slice(0, 12)}`
		case 'topic':
			return `${entry.name} ${entry.quotes.map((quote) => quote.path).join(' ')}`
		case 'decision':
			return `${entry.question} ${entry.topic ?? ''}`
		case 'layout':
			return [...entry.within, ...entry.parts.map((part) => part.name)].join(' ')
	}
}

// Send a few names first. Read one matching note at HEAD so a follow-up can use it without a model tool call.
export async function recordIndex(
	record: RecordRead,
	question: string,
	as: Asking,
	repo: Repository,
	signal?: AbortSignal,
) {
	const words = new Set(
		focus(question, as)
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu),
	)
	const ranked = record.current
		.toReversed()
		.filter((entry) => entry.kind !== 'note')
		.map((entry) => {
			const line = entryLine(entry)
			const terms = new Set(`${entry.id} ${entrySubject(entry)}`.toLowerCase().match(/[\p{L}\p{N}]+/gu))
			const matches = [...terms].filter((word) => words.has(word)).length
			return { entry, line, matches }
		})
	ranked.sort((a, b) => b.matches - a.matches || b.entry.at.localeCompare(a.entry.at))
	const shown = ranked.slice(0, MAX_INDEXED)
	const topics = shown.flatMap(({ entry }) => (entry.kind === 'topic' ? [entry.name] : []))
	if (shown.length === 0) return { text: 'The project record is empty.', topics }
	const rows = [
		...partsIndex(record),
		`The project record has ${ranked.length} entries besides notes. These match the question or were saved recently. Search the rest with memory_search.`,
		...shown.map(({ line }) => shortLine(line)),
	]
	const first = shown.find(({ entry, matches }) => entry.kind === 'topic' && matches > 0)?.entry
	if (first?.kind === 'topic') {
		const note = record.current.findLast((entry) => entry.kind === 'note' && entry.topic === first.id)
		if (note?.kind === 'note') {
			const freshness = await noteFreshness(repo, first, note, signal)
			rows.push(
				freshness.kind === 'fresh'
					? `Saved note for ${first.name}, checked at HEAD: ${shortLine(note.text)}`
					: `The saved note for ${first.name} is stale. Read the current code in ${freshness.changed.join(', ')}.`,
			)
		}
	}
	return { text: rows.join('\n'), topics }
}

// The top level of the project's layout as the reader sees it on the page, so the model speaks in the reader's part
// names. The newest named level of the whole project, one line per part.
function partsIndex(record: RecordRead): string[] {
	const top = record.current.findLast((entry) => entry.kind === 'layout' && entry.within.length === 0)
	if (top?.kind !== 'layout') return []
	return [
		"The project's main parts, as the reader sees them. Use these names when you talk about the parts:",
		...top.parts.map((part) =>
			shortLine(`- ${part.name} (${part.places.map((place) => place.path).join(', ')}): ${part.job}`),
		),
		'',
	]
}

function shortLine(line: string, limit = 300): string {
	return line.length > limit ? `${line.slice(0, limit - 3)}...` : line
}
