// The one way a card reaches the reader. The model writes its reply in words and calls show with the cards that need
// proof. Each card is checked alone (see checkCard). One that fails goes back to the model with its problems, and the
// words and the other cards stand. A question allows MAX_SENT_BACK cards sent back, so a model that cannot quote stops
// trying and says the rest in words. The risks of a change are held for the second look (see risk-pass.ts).
import { createHash } from 'node:crypto'
import type { JsonObject, JsonValue, Tool } from 'aigent/plugin'
import type { ChangedHunk, Quote, QuoteSources } from '../../checks/index.ts'
import { CARDINALITIES, DIAGRAM_BOUNDS, DIAGRAM_KINDS, type DiagramDraft } from '../../diagram/index.ts'
import type { UnderstandingMap } from '../../map/index.ts'
import { RECORD_LIMITS, type RecordStore, sameName, textProblem, UNDO } from '../../record/index.ts'
import { type Range, type Repository, resolveRange } from '../../repo/index.ts'
import type { ChatEvent } from '../chat-event.ts'
import { scopeProblem } from '../tools/exploration-tools.ts'
import { readArgs, refuse, reply, short } from '../tools/tool-edge.ts'
import { type CardContext, type CardDraft, changedHunks, checkCard } from './check-card.ts'
import { allowJsonText, readJsonText } from './json-text.ts'
import { type Card, type Item, type Risk, WEIGHTS } from './reply.ts'

export const MAX_SENT_BACK = 6

// What show checks against and what the end of a reply writes to. map is the reader's understanding map: a reply marks
// the topics it names as asked there. project reads the project's own git, without ken's snapshots, for the draft rule
// in recordReply.
export type Gate = {
	sources: QuoteSources
	store: RecordStore
	project: Repository
	map: UnderstandingMap | null
}

// What one question has seen of show. asked is false for a note ken writes by itself in live mode: it tells the
// reader's map nothing and gets no second look. scope is the change the reply is about. Cards that passed wait in
// pending until their turn ends, so they follow that turn's words. held is the risks of a change that passed, waiting
// for the second look. shown holds a hash of each card the reader has, so the same card twice shows once. step is
// "risks" while the second look runs, and passRejections counts the revisions it refused.
export type Round = {
	asked: boolean
	step: 'talk' | 'risks'
	passRejections: number
	scope: { range: Range; work: string | null; hunks: Promise<ChangedHunk[]> | null } | null
	items: Item[]
	pending: Card[]
	held: Risk[]
	sentBack: number
	shown: Set<string>
	emit: (event: ChatEvent) => void
}

export function freshRound(asked: boolean, emit: Round['emit']): Round {
	return {
		asked,
		step: 'talk',
		passRejections: 0,
		scope: null,
		items: [],
		pending: [],
		held: [],
		sentBack: 0,
		shown: new Set(),
		emit,
	}
}

const SPENT = `ken has sent back ${MAX_SENT_BACK} cards in this reply and checks no more. Say the rest in words, and say which points you could not quote.`

export function showTool(gate: Gate, round: () => Round): Tool {
	return {
		name: 'show',
		description:
			'Show the reader cards that prove what you say: claims, decisions, risks, diagrams and topics, each with the exact lines it rests on. ken checks each card alone against git and shows it after the words you write in this turn. A card that fails comes back with its problems, and the reader sees nothing of it. Every field is optional.',
		parameters: PARAMETERS,
		async execute(args, ctx) {
			const current = round()
			if (current.sentBack >= MAX_SENT_BACK) return refuse(SPENT)
			const read = readJsonText(SHOW_SCHEMA, args)
			if (read.kind === 'refused') return refuse(nothingShown(read.problems))
			const raw = read.args
			if (raw.scope !== undefined) {
				const problem = await setScope(gate, current, objectOf(raw.scope), ctx.signal)
				if (problem) return refuse(nothingShown([problem]))
			}
			const lines: string[] = []
			if (raw.work !== undefined) {
				const title = readArgs(objectOf(raw.work), 'show work').text('title')
				const long = textProblem('The work title', title, RECORD_LIMITS.title)
				if (long) lines.push(`${long} ken stored no title: send work again.`)
				else if (current.scope) current.scope.work = title
				else lines.push('work needs scope, the range of commits the piece of work covers, so ken stored no title.')
			}
			const context = contextOf(gate, current)
			// Topics are checked first, so a card may name a topic of this call only once that topic has passed.
			const known = [
				...(await topicNames(gate.store)),
				...cardsShown(current).flatMap((card) => (card.kind === 'topic' ? [card.topic.name] : [])),
			]
			const drafts = draftsOf(raw).map((draft, at) => ({ ...draft, at }))
			const topicsFirst = [...drafts].sort((a, b) => Number(b.kind === 'topic') - Number(a.kind === 'topic'))
			const passed: Card[] = []
			for (const { at, where, parse } of topicsFirst) {
				if (current.sentBack >= MAX_SENT_BACK) {
					lines.push(`${where} was not checked. ${SPENT}`)
					continue
				}
				const problems: string[] = []
				const draft = parse(problems)
				const topic = 'topic' in draft.draft ? draft.draft.topic : undefined
				if (topic !== undefined && !known.some((name) => sameName(name, topic))) {
					problems.push(
						`${where} names the topic "${topic}", which is neither in the record nor a topic shown in this reply. Use the name the index gives, send the topic, or leave topic out.`,
					)
				}
				const checked = problems.length > 0 ? null : await checkCard(context, draft, where, ctx.signal)
				// The record keeps one topic per name, so a topic it would refuse goes back now, with the one to reuse.
				if (checked?.kind === 'ok' && draft.kind === 'topic') {
					const { name, quotes, replaces } = draft.draft
					const stored = await gate.store.check({ kind: 'topic', name, quotes, replaces: replaces ?? undefined })
					if (stored.kind === 'refused') problems.push(...stored.problems.map((problem) => `${where}: ${problem}`))
				}
				if (checked === null || checked.kind === 'refused' || problems.length > 0) {
					const said = checked?.kind === 'refused' ? checked.problems : problems
					current.sentBack += 1
					current.emit({ kind: 'step', step: { kind: 'sent-back', what: where, problems: said } })
					lines.push(`${where} sent back. The reader saw nothing of it.`, ...said.map((problem) => `- ${problem}`))
					continue
				}
				const { card } = checked
				const id = createHash('sha256').update(JSON.stringify(card)).digest('hex')
				if (current.shown.has(id)) {
					lines.push(`${where} was shown already.`)
					continue
				}
				current.shown.add(id)
				if (card.kind === 'topic') known.push(card.topic.name)
				passed[at] = card
			}
			const shown: string[] = []
			const held: string[] = []
			for (const [at, card] of passed.entries()) {
				if (!card) continue
				const where = drafts[at]?.where ?? ''
				// Risks of a change come when the reader asks for them, most often after the record already holds the change,
				// so they get the second look whatever the record holds. One sent during that look shows as it is.
				if (card.kind === 'risk' && current.asked && current.scope && current.step === 'talk') {
					current.held.push(card.risk)
					held.push(where)
				} else {
					current.pending.push(card)
					shown.push(where)
				}
			}
			const head = [
				...(shown.length > 0 ? [`Shown: ${shown.join(', ')}.`] : []),
				...(held.length > 0
					? [`Held for a second look: ${held.join(', ')}. ken asks you about them when your reply ends.`]
					: []),
				...(current.scope && raw.scope !== undefined
					? [`The reply is about ${short(current.scope.range.base)}..${short(current.scope.range.head)}.`]
					: []),
			]
			if (current.scope?.work && !cardsShown(current).some((card) => card.kind === 'claim')) {
				lines.push(
					`ken stores the piece of work "${current.scope.work}" only with at least one claim, and this reply shows none yet.`,
				)
			}
			const fix = lines.some((line) => line.includes('sent back'))
				? ['Fix a card that came back and send it again, or say the point in words and say you could not quote it.']
				: []
			const text = [...head, ...lines, ...fix].join('\n')
			return text === '' ? reply('Nothing to show.') : reply(text)
		},
	}
}

function nothingShown(problems: string[]): string {
	return ['Nothing shown, and nothing counted against you.', ...problems.map((problem) => `- ${problem}`)].join('\n')
}

// The first scope of a reply fixes the change it is about. Another one is refused: one reply explains one change.
async function setScope(gate: Gate, current: Round, raw: JsonObject, signal: AbortSignal): Promise<string | null> {
	const scope = readArgs(raw, 'show scope')
	const resolved = await resolveRange(gate.sources.repo, { base: scope.text('base'), head: scope.text('head') }, signal)
	if (resolved.kind !== 'ok') return `Scope: ${scopeProblem(resolved)}`
	const { range } = resolved
	if (current.scope) {
		const same = current.scope.range.base === range.base && current.scope.range.head === range.head
		const now = `${short(current.scope.range.base)}..${short(current.scope.range.head)}`
		return same ? null : `This reply is about ${now}. One reply explains one change: leave out scope.`
	}
	current.scope = { range, work: null, hunks: null }
	// A risk shown in the same turn, before the scope came, is about the change too.
	if (current.asked && current.step === 'talk') {
		const risks = current.pending.flatMap((card) => (card.kind === 'risk' ? [card.risk] : []))
		current.pending = current.pending.filter((card) => card.kind !== 'risk')
		current.held.push(...risks)
	}
	return null
}

export function contextOf(gate: Gate, current: Round): CardContext {
	const { scope } = current
	if (!scope) return { sources: gate.sources, change: null }
	const hunks = () => {
		scope.hunks ??= changedHunks(gate.sources.repo, scope.range, new AbortController().signal)
		return scope.hunks
	}
	return { sources: gate.sources, change: { range: scope.range, hunks } }
}

async function topicNames(store: RecordStore): Promise<string[]> {
	return (await store.read()).current.flatMap((entry) => (entry.kind === 'topic' ? [entry.name] : []))
}

function cardsShown(current: Round): Card[] {
	return [...current.items.flatMap((item) => (item.kind === 'card' ? [item.card] : [])), ...current.pending]
}

type ReadQuote = (raw: JsonObject) => Quote

// Each card the call sends, in the order the reader gets them, with the name the result uses for it. A card parses
// into its draft with the quote problems it has, which send it back before ken checks a quote.
function draftsOf(
	raw: JsonObject,
): { kind: CardDraft['kind']; where: string; parse: (problems: string[]) => CardDraft }[] {
	const each = (
		list: string,
		name: string,
		kind: CardDraft['kind'],
		toDraft: (one: JsonObject, quote: ReadQuote) => CardDraft,
	) =>
		optionalList(raw[list]).map((one, at) => ({
			kind,
			where: `${name} ${at + 1}`,
			parse: (problems: string[]) => toDraft(one, (quote) => quoteOf(quote, problems)),
		}))
	return [
		...each('diagrams', 'Diagram', 'diagram', (one, quote) => ({ kind: 'diagram', draft: diagramDraftOf(one, quote) })),
		...each('claims', 'Claim', 'claim', (one, quote) => ({ kind: 'claim', draft: claimOf(one, 'show claim', quote) })),
		...each('decisions', 'Decision', 'decision', (one, quote) => ({ kind: 'decision', draft: decisionOf(one, quote) })),
		...each('risks', 'Risk', 'risk', (one, quote) => ({ kind: 'risk', draft: claimOf(one, 'show risk', quote) })),
		...each('topics', 'Topic', 'topic', (one, quote) => ({ kind: 'topic', draft: topicOf(one, quote) })),
	]
}

function topicOf(raw: JsonObject, quoteOf: ReadQuote) {
	const topic = readArgs(raw, 'show topic')
	return {
		name: topic.text('name'),
		quotes: listOf(raw.quotes).map(quoteOf),
		note: topic.text('note'),
		replaces: topic.optionalText('replaces') ?? null,
	}
}

function decisionOf(raw: JsonObject, quoteOf: ReadQuote) {
	const decision = readArgs(raw, 'show decision')
	const undo = UNDO.find((known) => known === decision.text('undo'))
	if (!undo) throw new Error('show: undo is not in UNDO, so its schema and its reader disagree')
	return {
		question: decision.text('question'),
		chosen: decision.text('chosen'),
		reason: { text: decision.text('reason'), quotes: listOf(raw.reason_quotes).map(quoteOf) },
		rejected: listOf(raw.rejected).map((rawRejected) => {
			const rejected = readArgs(rawRejected, 'show rejected option')
			return { option: rejected.text('option'), reason: rejected.text('reason') }
		}),
		undo,
		needsOwner: decision.flag('needs_owner'),
		quotes: listOf(raw.quotes).map(quoteOf),
		...namedTopic(decision.optionalText('topic')),
		...absentOf(raw.absent),
	}
}

function absentOf(raw: JsonValue | undefined): { absent?: { text: string; under: string | null } } {
	if (raw === undefined) return {}
	const absent = readArgs(objectOf(raw), 'show absent')
	return { absent: { text: absent.text('text'), under: absent.optionalText('under') ?? null } }
}

function namedTopic(topic: string | undefined): { topic?: string } {
	return topic === undefined ? {} : { topic }
}

export function claimOf(raw: JsonObject, what: string, quoteOf: ReadQuote) {
	const claim = readArgs(raw, what)
	const weight = WEIGHTS.find((known) => known === claim.optionalText('weight'))
	return {
		text: claim.text('text'),
		label: claim.text('label'),
		quotes: listOf(raw.quotes).map(quoteOf),
		...namedTopic(claim.optionalText('topic')),
		...(weight === undefined ? {} : { weight }),
		...absentOf(raw.absent),
	}
}

function diagramDraftOf(raw: JsonObject, quoteOf: ReadQuote): DiagramDraft {
	const diagram = readArgs(raw, 'show diagram')
	const kind = DIAGRAM_KINDS.find((known) => known === diagram.text('kind'))
	if (!kind) throw new Error('show: a diagram kind is not in DIAGRAM_KINDS, so its schema and its reader disagree')
	const node = (each: JsonObject) => ({
		name: readArgs(each, 'show diagram node').text('name'),
		quotes: optionalList(each.quotes).map(quoteOf),
	})
	const edge = (each: JsonObject) => {
		const read = readArgs(each, 'show diagram edge')
		return {
			from: read.text('from'),
			to: read.text('to'),
			text: read.text('text'),
			label: read.optionalText('label'),
			quotes: optionalList(each.quotes).map(quoteOf),
		}
	}
	return {
		kind,
		title: diagram.text('title'),
		label: diagram.text('label'),
		boxes: optionalList(raw.boxes).map((each) => ({
			...node(each),
			group: readArgs(each, 'show box').optionalText('group'),
		})),
		arrows: optionalList(raw.arrows).map(edge),
		participants: optionalList(raw.participants).map(node),
		messages: optionalList(raw.messages).map(edge),
		entities: optionalList(raw.entities).map((each) => ({
			...node(each),
			fields: optionalList(each.fields).map((rawField) => {
				const field = readArgs(rawField, 'show field')
				return { name: field.text('name'), type: field.text('type') }
			}),
		})),
		relations: optionalList(raw.relations).map((each) => {
			const cardinality = CARDINALITIES.find((known) => known === readArgs(each, 'show relation').text('cardinality'))
			if (!cardinality)
				throw new Error('show: a cardinality is not in CARDINALITIES, so its schema and reader disagree')
			return { ...edge(each), cardinality }
		}),
	}
}

// A quote names one source: a session, or a commit with a path for a file and none for the commit's message. A quote
// that names both, or neither, adds a problem, and the card goes back before ken checks any quote.
export function quoteOf(raw: JsonObject, problems: string[]): Quote {
	const quote = readArgs(raw, 'show quote')
	const text = quote.text('text')
	const session = quote.optionalText('session')
	const commit = quote.optionalText('commit')
	const first = JSON.stringify(text.trim().split('\n')[0]?.slice(0, 60) ?? '')
	if (session !== undefined) {
		if (commit !== undefined || quote.optionalText('path') !== undefined) {
			problems.push(
				`The quote ${first} names a session and a commit. A quote has one source: leave out path and commit to quote a session.`,
			)
		}
		return { session, text }
	}
	if (commit === undefined) {
		problems.push(
			`The quote ${first} names no source. Give commit, and path for a file, or give session to quote a saved session.`,
		)
	}
	const line = quote.optionalLine('line')
	return {
		path: quote.optionalText('path') ?? null,
		commit: commit ?? '',
		text,
		...(line === undefined ? {} : { line }),
	}
}

export function optionalList(value: JsonValue | undefined): JsonObject[] {
	return value === undefined ? [] : listOf(value)
}

function listOf(value: JsonValue | undefined): JsonObject[] {
	if (!isList(value)) throw new Error('show: a list argument is not a list, so its schema and reader disagree')
	return value.map(objectOf)
}

function objectOf(value: JsonValue | undefined): JsonObject {
	if (typeof value !== 'object' || value === null || isList(value)) {
		throw new Error('show: an object argument is not an object, so its schema and reader disagree')
	}
	return value
}

// Array.isArray does not narrow a readonly array out of a union, so it gets this guard.
function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
	return Array.isArray(value)
}

// Every request sends the whole tool list again, and this schema is most of it. The quote, claim and edge shapes
// repeat, so each keeps its descriptions where the model first reads it and drops them in the copies after.
export function withoutDescriptions<T>(schema: T): T {
	return JSON.parse(JSON.stringify(schema, (key, value) => (key === 'description' ? undefined : value)))
}

const QUOTE_SCHEMA = {
	type: 'object',
	properties: {
		path: {
			type: 'string',
			description: "The path from the repository root. Leave it out to quote the commit's message instead.",
		},
		commit: { type: 'string', description: 'The commit you read the lines at, or whose message you quote' },
		session: {
			type: 'string',
			description: 'To quote a saved session instead: its id from list_sessions. Then leave out path and commit.',
		},
		text: {
			type: 'string',
			description:
				'The exact whole lines, copied from read_file, diff, log or read_session output, without line numbers or + and - signs',
		},
		line: { type: 'integer', minimum: 1, description: 'The number of the first quoted line of a file' },
	},
	required: ['text'],
	additionalProperties: false,
} as const
export const QUOTE = withoutDescriptions(QUOTE_SCHEMA)

const ABSENT_SCHEMA = {
	type: 'object',
	description:
		'Only for an entry that says something is missing, never called or not tested: the text that would be there if it were not. ken searches the head commit for it and rejects the answer if it is there.',
	properties: {
		text: {
			type: 'string',
			description: 'A name or a short phrase on one line, 3 to 80 characters, such as the function a test would call',
		},
		under: { type: 'string', description: 'Search only the paths that start with this, such as "test/"' },
	},
	required: ['text'],
	additionalProperties: false,
} as const

const TOPIC_NAME = {
	type: 'string',
	description: "The topic it belongs to, if any: a topic name from the record's index, or one you send in topics",
} as const

export const CLAIM_SCHEMA = {
	type: 'object',
	properties: {
		text: { type: 'string', description: 'One idea in one or two short sentences, in plain words' },
		label: {
			type: 'string',
			description:
				'"inferred" for what you worked out from the code or the diff, every reason why included. "found-by-search" for a relation between pieces of code, such as "this calls that", that you found by searching and did not prove. "from-the-session" for what you read in a saved session and quote from it.',
		},
		quotes: { type: 'array', minItems: 1, items: QUOTE_SCHEMA },
		topic: TOPIC_NAME,
		absent: ABSENT_SCHEMA,
	},
	required: ['text', 'label', 'quotes'],
	additionalProperties: false,
} as const

// The model weighs each risk. The page shows the serious ones first and folds the minor ones, so the words say what
// "hurt" means: a judge found that a model told only "hurt in normal use" weighed every risk of a change minor.
export const WEIGHT_RULE =
	'"serious" when someone who uses the thing in the normal way is hurt by it: they lose work, get a wrong result or a failure, or find refused what worked before. "minor" when it needs a rare case or costs little'

const CLAIM = withoutDescriptions(CLAIM_SCHEMA)
export const RISK_SCHEMA = {
	...CLAIM,
	properties: {
		...CLAIM.properties,
		weight: {
			type: 'string',
			enum: WEIGHTS,
			description: WEIGHT_RULE,
		},
	},
	required: [...CLAIM.required, 'weight'],
} as const

export const DECISION_SCHEMA = {
	type: 'object',
	properties: {
		question: {
			type: 'string',
			description: 'The question the decision answers, such as "How long does a retry wait?"',
		},
		chosen: { type: 'string', description: 'The option the code took' },
		reason: { type: 'string', description: 'Why this option was chosen, in one or two short sentences' },
		reason_quotes: {
			type: 'array',
			description:
				'Only lines that say why the option was chosen: lines of a commit message, a comment, a doc or a saved session that state the reason, not lines that say what was done. An empty list when nothing you read says why. ken labels a decision whose reason quotes the body of a commit message "recorded", one whose reason quotes a session "from-the-session", and any other "inferred".',
			items: QUOTE,
		},
		rejected: {
			type: 'array',
			description:
				'Options the code or the history shows were tried or weighed: a reverted commit, a comment, a commit message. Leave it empty when there is no such sign. Never invent one.',
			items: {
				type: 'object',
				properties: {
					option: { type: 'string' },
					reason: { type: 'string', description: 'Why it was not chosen, as the code or the history shows it' },
				},
				required: ['option', 'reason'],
				additionalProperties: false,
			},
		},
		undo: { type: 'string', enum: UNDO, description: 'How much work it would take to choose differently later' },
		needs_owner: {
			type: 'boolean',
			description:
				'true when the owner should look at it: a choice a commit message leaves to the owner, a guess about intent, a risk, or a choice with a cost',
		},
		quotes: { type: 'array', minItems: 1, description: 'The lines that show what was chosen', items: QUOTE },
		topic: TOPIC_NAME,
		absent: ABSENT_SCHEMA,
	},
	required: ['question', 'chosen', 'reason', 'reason_quotes', 'rejected', 'undo', 'needs_owner', 'quotes'],
	additionalProperties: false,
} as const

const TOPIC_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string', description: 'A short name for a part of the project, such as "retry logic"' },
		quotes: { type: 'array', minItems: 1, items: QUOTE },
		note: { type: 'string', description: 'A few sentences on how this part works, for the next question about it' },
		replaces: { type: 'string', description: 'The id of a topic in the record that this one updates' },
	},
	required: ['name', 'quotes', 'note'],
	additionalProperties: false,
} as const

const NAME = { type: 'string', description: 'A short name, unique in the diagram' } as const
const DEFINED_AT = {
	type: 'array',
	description: 'Optional: the lines where it is defined, such as its header or its declaration',
	items: QUOTE,
} as const
const EDGE_PROPERTIES = {
	from: { type: 'string', description: 'The name of the box, participant or entity it starts at' },
	to: { type: 'string', description: 'The name of the one it ends at' },
	text: {
		type: 'string',
		description:
			'A few words: a verb such as "calls", "reads" or "writes to" for an arrow, what is sent for a message, how the two relate for a relation',
	},
	label: {
		type: 'string',
		description:
			'Leave it out to use the diagram label. "found-by-search" when you found this by searching and did not prove it.',
	},
	quotes: {
		type: 'array',
		description: 'At least one: the lines that show the call, the message or the link',
		items: QUOTE,
	},
} as const
const EDGE_SCHEMA = {
	type: 'object',
	properties: EDGE_PROPERTIES,
	required: ['from', 'to', 'text', 'quotes'],
	additionalProperties: false,
} as const

const DIAGRAM_SCHEMA = {
	type: 'object',
	properties: {
		kind: {
			type: 'string',
			enum: DIAGRAM_KINDS,
			description:
				'"component": how parts fit together, with boxes and arrows. "sequence": what happens in order, with participants and messages. "entity-relationship": what data there is and how it relates, with entities and relations.',
		},
		title: { type: 'string', description: 'What the diagram shows, in a few words' },
		label: { type: 'string', description: 'The label for the diagram as a whole, chosen as for a claim' },
		boxes: {
			type: 'array',
			description: `A component diagram's parts, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: {
					name: NAME,
					group: { type: 'string', description: 'Optional: a name several boxes share, such as a layer' },
					quotes: DEFINED_AT,
				},
				required: ['name'],
				additionalProperties: false,
			},
		},
		arrows: {
			type: 'array',
			description: `A component diagram's arrows, at most ${DIAGRAM_BOUNDS.edges}`,
			items: EDGE_SCHEMA,
		},
		participants: {
			type: 'array',
			description: `A sequence diagram's participants, left to right, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: { name: NAME, quotes: DEFINED_AT },
				required: ['name'],
				additionalProperties: false,
			},
		},
		messages: {
			type: 'array',
			description: `A sequence diagram's messages, in the order they happen, at most ${DIAGRAM_BOUNDS.edges}`,
			items: withoutDescriptions(EDGE_SCHEMA),
		},
		entities: {
			type: 'array',
			description: `An entity-relationship diagram's entities, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: {
					name: NAME,
					fields: {
						type: 'array',
						description: `The fields that matter, at most ${DIAGRAM_BOUNDS.fields}`,
						items: {
							type: 'object',
							properties: { name: { type: 'string' }, type: { type: 'string' } },
							required: ['name', 'type'],
							additionalProperties: false,
						},
					},
					quotes: DEFINED_AT,
				},
				required: ['name'],
				additionalProperties: false,
			},
		},
		relations: {
			type: 'array',
			description: `An entity-relationship diagram's relations, at most ${DIAGRAM_BOUNDS.edges}`,
			items: {
				type: 'object',
				properties: {
					...withoutDescriptions(EDGE_PROPERTIES),
					cardinality: {
						type: 'string',
						enum: CARDINALITIES,
						description: 'How many of the first entity relate to how many of the second',
					},
				},
				required: ['from', 'to', 'text', 'cardinality', 'quotes'],
				additionalProperties: false,
			},
		},
	},
	required: ['kind', 'title', 'label'],
	additionalProperties: false,
} as const

const SHOW_SCHEMA = {
	type: 'object',
	properties: {
		scope: {
			type: 'object',
			description:
				'Give it when the reply is about a change: the base and head commits of that change. A merge commit runs from <merge>^1 to the merge.',
			properties: { base: { type: 'string' }, head: { type: 'string' } },
			required: ['base', 'head'],
			additionalProperties: false,
		},
		work: {
			type: 'object',
			description:
				'Give it with scope when the reply explains a piece of work, such as a task, a branch or a pull request. ken stores the reply in the record under this title.',
			properties: { title: { type: 'string', description: 'A short name for the piece of work' } },
			required: ['title'],
			additionalProperties: false,
		},
		claims: { type: 'array', description: 'Claims about the code that need proof, one idea each', items: CLAIM_SCHEMA },
		decisions: { type: 'array', description: 'Decisions a change made', items: DECISION_SCHEMA },
		risks: {
			type: 'array',
			description: 'What could go wrong, or what the owner should watch, each with the lines it starts from',
			items: RISK_SCHEMA,
		},
		diagrams: {
			type: 'array',
			description: 'Basic diagrams that show how parts fit together or what happens in order. ken draws them.',
			items: DIAGRAM_SCHEMA,
		},
		topics: { type: 'array', description: 'Parts of the project the reply explains', items: TOPIC_SCHEMA },
	},
	additionalProperties: false,
} as const

const PARAMETERS = allowJsonText(SHOW_SCHEMA)
