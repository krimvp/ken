// The one way an answer reaches the reader. The model sends it here, checkAnswer decides, and the result tells the
// model what to fix. A question allows MAX_REJECTIONS rejected answers, so a model that cannot quote stops there
// instead of trying forever.
import type { JsonObject, JsonValue, Tool } from 'aigent/plugin'
import type { Quote } from '../../checks/index.ts'
import { CARDINALITIES, DIAGRAM_BOUNDS, DIAGRAM_KINDS, type DiagramDraft } from '../../diagram/index.ts'
import { type RecordEntry, type RecordStore, UNDO } from '../../record/index.ts'
import type { Repository } from '../../repo/index.ts'
import type { ChatEvent } from '../chat-event.ts'
import { hunkHeader } from '../tools/diff-tool.ts'
import { readArgs, refuse, reply } from '../tools/tool-edge.ts'
import type { Answer } from './answer.ts'
import { type AnswerDraft, checkAnswer } from './check-answer.ts'
import { allowJsonText, readJsonText } from './json-text.ts'
import { type RecordArgs, type Recorded, recordAnswer } from './record-answer.ts'

export const MAX_REJECTIONS = 3
const MAX_LISTED_HUNKS = 40

// What one question has seen of the answer tool. The session makes a new one for each question.
export type AnswerRound = { rejections: number; answer: Answer | null; emit: (event: ChatEvent) => void }

export function answerTool(repo: Repository, store: RecordStore, round: () => AnswerRound): Tool {
	return {
		name: 'answer',
		description:
			'Send your answer to the reader. ken checks every quote against git and rejects the whole answer if one quote is not in its file at its commit. ken draws the diagrams you send. It stores the piece of work, its diagrams, the decisions and the topics you send in the project record. Call it once, when you have read the code the answer rests on.',
		parameters: PARAMETERS,
		async execute(args, ctx) {
			const current = round()
			if (current.answer) {
				return reply('An answer is already accepted for this question. Write your one or two closing sentences now.')
			}
			if (current.rejections >= MAX_REJECTIONS) return refuse('No attempts are left for this question. Stop now.')
			const settled = await settle(repo, store, args, ctx.signal)
			if (settled.kind === 'accepted') {
				current.answer = settled.answer
				current.emit({ kind: 'accepted', answer: settled.answer, recorded: settled.recorded.entries })
				return reply(confirmation(settled.answer, settled.recorded))
			}
			current.rejections += 1
			current.emit({ kind: 'rejected', attempt: current.rejections, problems: settled.problems })
			return refuse(rejection(settled.problems, current.rejections))
		},
	}
}

async function settle(
	repo: Repository,
	store: RecordStore,
	raw: JsonObject,
	signal: AbortSignal,
): Promise<
	| { kind: 'accepted'; answer: Answer; recorded: Extract<Recorded, { kind: 'recorded' }> }
	| { kind: 'rejected'; problems: string[] }
> {
	const read = readJsonText(ANSWER_SCHEMA, raw)
	if (read.kind === 'refused') return { kind: 'rejected', problems: read.problems }
	const check = await checkAnswer(repo, draftOf(read.args), signal)
	if (check.kind === 'rejected') return check
	const recorded = await recordAnswer(store, check.answer, recordArgsOf(read.args), signal)
	if (recorded.kind === 'refused') return { kind: 'rejected', problems: recorded.problems }
	return { kind: 'accepted', answer: check.answer, recorded }
}

function confirmation(answer: Answer, recorded: Extract<Recorded, { kind: 'recorded' }>): string {
	const quotes = answer.statements.reduce((sum, statement) => sum + statement.quotes.length, 0)
	const lines = [
		`Answer accepted: ${answer.statements.length} statements, ${answer.diagrams.length} diagrams, ${quotes} quotes in the statements. ken shows it to the reader.`,
	]
	if (recorded.kept) {
		lines.push(`Piece of work ${recorded.kept} already explains this range, so ken kept it and wrote no new one.`)
	}
	if (recorded.entries.length > 0) {
		lines.push(`Added to the project record: ${recorded.entries.map(named).join(', ')}.`)
	}
	if (answer.change) {
		const { covered, uncovered, binary } = answer.change
		lines.push(`Your quotes cover ${covered.length} of ${covered.length + uncovered.length} changed hunks.`)
		if (uncovered.length > 0) {
			const listed = uncovered.slice(0, MAX_LISTED_HUNKS).map(({ path, hunk }) => `- ${path} ${hunkHeader(hunk)}`)
			const more = uncovered.length > listed.length ? [`- and ${uncovered.length - listed.length} more`] : []
			lines.push('Not covered:', ...listed, ...more)
		}
		if (binary.length > 0) lines.push(`Binary files, which no quote can cover: ${binary.join(', ')}.`)
	}
	lines.push(
		'Now write one or two sentences to the reader: say what the answer left out, and offer to go deeper. Do not repeat the answer.',
	)
	return lines.join('\n')
}

function named(entry: RecordEntry): string {
	return `${entry.kind} ${entry.id}`
}

function rejection(problems: string[], attempt: number): string {
	const head = `Answer rejected, attempt ${attempt} of ${MAX_REJECTIONS}. The reader saw nothing.`
	const tail =
		attempt >= MAX_REJECTIONS
			? 'That was the last attempt, so ken tells the reader it could not produce a checked answer. Stop now.'
			: 'Fix these and send the whole answer again. Copy each quote from read_file or diff output.'
	return [head, ...problems.map((problem) => `- ${problem}`), tail].join('\n')
}

function draftOf(args: JsonObject): AnswerDraft {
	const read = readArgs(args, 'answer')
	const scope = args.scope === undefined ? null : readArgs(objectOf(args.scope), 'answer scope')
	return {
		summary: read.text('summary'),
		scope: scope && { base: scope.text('base'), head: scope.text('head') },
		statements: listOf(args.statements).map((raw) => {
			const statement = readArgs(raw, 'answer statement')
			return {
				text: statement.text('text'),
				label: statement.text('label'),
				quotes: listOf(raw.quotes).map(quoteOf),
			}
		}),
		diagrams: optionalList(args.diagrams).map(diagramDraftOf),
	}
}

function diagramDraftOf(raw: JsonObject): DiagramDraft {
	const diagram = readArgs(raw, 'answer diagram')
	const kind = DIAGRAM_KINDS.find((known) => known === diagram.text('kind'))
	if (!kind) throw new Error('answer: a diagram kind is not in DIAGRAM_KINDS, so its schema and its reader disagree')
	const node = (each: JsonObject) => ({
		name: readArgs(each, 'answer diagram node').text('name'),
		quotes: optionalList(each.quotes).map(quoteOf),
	})
	const edge = (each: JsonObject) => {
		const read = readArgs(each, 'answer diagram edge')
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
			group: readArgs(each, 'answer box').optionalText('group'),
		})),
		arrows: optionalList(raw.arrows).map(edge),
		participants: optionalList(raw.participants).map(node),
		messages: optionalList(raw.messages).map(edge),
		entities: optionalList(raw.entities).map((each) => ({
			...node(each),
			fields: optionalList(each.fields).map((rawField) => {
				const field = readArgs(rawField, 'answer field')
				return { name: field.text('name'), type: field.text('type') }
			}),
		})),
		relations: optionalList(raw.relations).map((each) => {
			const cardinality = CARDINALITIES.find((known) => known === readArgs(each, 'answer relation').text('cardinality'))
			if (!cardinality)
				throw new Error('answer: a cardinality is not in CARDINALITIES, so its schema and reader disagree')
			return { ...edge(each), cardinality }
		}),
	}
}

function recordArgsOf(args: JsonObject): RecordArgs {
	const work = args.work === undefined ? null : { title: readArgs(objectOf(args.work), 'answer work').text('title') }
	return {
		work,
		decisions: optionalList(args.decisions).map((raw) => {
			const decision = readArgs(raw, 'answer decision')
			const undo = UNDO.find((known) => known === decision.text('undo'))
			if (!undo) throw new Error('answer: undo is not in UNDO, so its schema and its reader disagree')
			return {
				question: decision.text('question'),
				chosen: decision.text('chosen'),
				rejected: listOf(raw.rejected).map((rawRejected) => {
					const rejected = readArgs(rawRejected, 'answer rejected option')
					return { option: rejected.text('option'), reason: rejected.text('reason') }
				}),
				undo,
				needsOwner: decision.flag('needs_owner'),
				quotes: listOf(raw.quotes).map(quoteOf),
			}
		}),
		topics: optionalList(args.topics).map((raw) => {
			const topic = readArgs(raw, 'answer topic')
			return {
				name: topic.text('name'),
				quotes: listOf(raw.quotes).map(quoteOf),
				note: topic.text('note'),
				replaces: topic.optionalText('replaces'),
			}
		}),
	}
}

function quoteOf(raw: JsonObject): Quote {
	const quote = readArgs(raw, 'answer quote')
	const line = quote.optionalLine('line')
	return {
		path: quote.text('path'),
		commit: quote.text('commit'),
		text: quote.text('text'),
		...(line === undefined ? {} : { line }),
	}
}

function optionalList(value: JsonValue | undefined): JsonObject[] {
	return value === undefined ? [] : listOf(value)
}

function listOf(value: JsonValue | undefined): JsonObject[] {
	if (!isList(value)) throw new Error('answer: a list argument is not a list, so its schema and reader disagree')
	return value.map(objectOf)
}

function objectOf(value: JsonValue | undefined): JsonObject {
	if (typeof value !== 'object' || value === null || isList(value)) {
		throw new Error('answer: an object argument is not an object, so its schema and reader disagree')
	}
	return value
}

// Array.isArray does not narrow a readonly array out of a union, so it gets this guard.
function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
	return Array.isArray(value)
}

const QUOTE_SCHEMA = {
	type: 'object',
	properties: {
		path: { type: 'string', description: 'The path from the repository root' },
		commit: { type: 'string', description: 'The commit you read the lines at' },
		text: {
			type: 'string',
			description: 'The exact lines, copied from read_file or diff output, without line numbers or + and - signs',
		},
		line: { type: 'integer', minimum: 1, description: 'The number of the first quoted line' },
	},
	required: ['path', 'commit', 'text'],
	additionalProperties: false,
} as const

const DECISION_SCHEMA = {
	type: 'object',
	properties: {
		question: {
			type: 'string',
			description: 'The question the decision answers, such as "How long does a retry wait?"',
		},
		chosen: { type: 'string', description: 'The option the code took' },
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
			description: 'true when the owner should look at it: a guess about intent, a risk, or a choice with a cost',
		},
		quotes: { type: 'array', minItems: 1, items: QUOTE_SCHEMA },
	},
	required: ['question', 'chosen', 'rejected', 'undo', 'needs_owner', 'quotes'],
	additionalProperties: false,
} as const

const TOPIC_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string', description: 'A short name for a part of the project, such as "retry logic"' },
		quotes: { type: 'array', minItems: 1, items: QUOTE_SCHEMA },
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
	items: QUOTE_SCHEMA,
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
		items: QUOTE_SCHEMA,
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
		label: { type: 'string', description: 'The label for the diagram as a whole, chosen as for a statement' },
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
			items: EDGE_SCHEMA,
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
					...EDGE_PROPERTIES,
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

const ANSWER_SCHEMA = {
	type: 'object',
	properties: {
		work: {
			type: 'object',
			description:
				'Give it when the answer explains a piece of work, such as a task, a branch or a pull request. It needs scope, which is its range.',
			properties: { title: { type: 'string', description: 'A short name for the piece of work' } },
			required: ['title'],
			additionalProperties: false,
		},
		decisions: { type: 'array', description: 'The decisions the change made', items: DECISION_SCHEMA },
		topics: { type: 'array', description: 'Parts of the project the answer explains', items: TOPIC_SCHEMA },
		scope: {
			type: 'object',
			description: 'Give it when the question is about a change: the base and head commits of that change.',
			properties: { base: { type: 'string' }, head: { type: 'string' } },
			required: ['base', 'head'],
			additionalProperties: false,
		},
		diagrams: {
			type: 'array',
			description: `Basic diagrams that lead the answer, at most ${DIAGRAM_BOUNDS.diagrams}. ken draws them.`,
			items: DIAGRAM_SCHEMA,
		},
		summary: { type: 'string', description: 'One to three sentences that answer the question from the top' },
		statements: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'One claim about the code, in plain words' },
					label: {
						type: 'string',
						description:
							'"inferred" for what you worked out from the code or the diff, every reason why included. "found-by-search" for a relation between pieces of code, such as "this calls that", that you found by searching and did not prove.',
					},
					quotes: { type: 'array', minItems: 1, items: QUOTE_SCHEMA },
				},
				required: ['text', 'label', 'quotes'],
				additionalProperties: false,
			},
		},
	},
	required: ['summary', 'statements'],
	additionalProperties: false,
} as const

const PARAMETERS = allowJsonText(ANSWER_SCHEMA)
