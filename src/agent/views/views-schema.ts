// How the model sends "In its world" and "Where it runs" with show, and how ken reads them into the drafts checkViews
// takes. Every field a kind of item does not use is optional, so a part needs no name and an outside thing no quotes;
// checkViews says what a kind is missing.
import type { JsonObject, JsonValue } from 'aigent/plugin'
import type { GitQuote } from '../../checks/index.ts'
import {
	CROSSING_KINDS,
	DIRECTIONS,
	FRAME_KINDS,
	HOWS,
	OUTSIDE_KINDS,
	STORE_KINDS,
	THING_KINDS,
	VIEWS_BOUNDS,
	type ViewsDraft,
} from '../../diagram/index.ts'
import { readArgs } from '../tools/tool-edge.ts'

const B = VIEWS_BOUNDS
const ID = {
	type: 'string',
	description: `A short id you choose, such as "worker-thread": a to z, 0 to 9 and -, at most ${B.id} characters. One id names one item across both drawings.`,
} as const
const LINE = { type: 'string', description: `What it is, in one sentence of at most ${B.line} characters` } as const
const NAME = { type: 'string', description: `What a reader would call it, at most ${B.name} characters` } as const
const HOW = { type: 'string', enum: HOWS, description: 'How it crosses' } as const

// quote is the schema of one quote, as show's other cards take it.
export function viewsSchema<Q extends JsonObject>(quote: Q) {
	const quotes = {
		type: 'array',
		description: `1 to ${B.quotes} lines that show it, each with its path. A quote with no commit is read at HEAD.`,
		items: quote,
	} as const
	return {
		type: 'object',
		description:
			'Only when the question asks where the project runs and what it talks to. ken checks each item alone, and one that fails comes back alone with its problems. To fix one, send it again alone; items ken took stay.',
		properties: {
			world: {
				type: 'object',
				description: '"In its world": the project as one block, and the people and outside systems around it',
				properties: {
					outside: {
						type: 'array',
						items: {
							type: 'object',
							properties: { id: ID, kind: { type: 'string', enum: OUTSIDE_KINDS }, name: NAME, line: LINE, quotes },
							required: ['id', 'kind', 'name', 'line', 'quotes'],
							additionalProperties: false,
						},
					},
					crossings: {
						type: 'array',
						description: 'What crosses between the project and one outside person or system',
						items: {
							type: 'object',
							properties: {
								id: ID,
								outside: { type: 'string', description: 'The id of the outside person or system' },
								text: { type: 'string', description: `What crosses, at most ${B.text} characters, such as "prompts"` },
								how: HOW,
								direction: {
									type: 'string',
									enum: DIRECTIONS,
									description: 'Said from the project: in comes from the outside, out goes to it',
								},
								quotes,
							},
							required: ['id', 'outside', 'text', 'how', 'direction', 'quotes'],
							additionalProperties: false,
						},
					},
				},
				additionalProperties: false,
			},
			runtime: {
				type: 'object',
				description: '"Where it runs": the places code runs, what runs in each, and what crosses between them',
				properties: {
					frames: {
						type: 'array',
						description: 'A place code runs. Frames nest: a worker thread sits in a process.',
						items: {
							type: 'object',
							properties: {
								id: ID,
								kind: { type: 'string', enum: FRAME_KINDS },
								name: NAME,
								line: { ...LINE, description: `What runs there, in one sentence of at most ${B.line} characters` },
								in: { type: 'string', description: 'The id of the frame it sits in. Leave it out at the top.' },
								copies: {
									type: 'object',
									description:
										'Only when a line of the repository gives the number, such as replicas: 2: how many run, and that line',
									properties: { count: { type: 'integer', minimum: 1 }, quote },
									required: ['count', 'quote'],
									additionalProperties: false,
								},
								quotes: {
									...quotes,
									description: `1 to ${B.quotes} lines that make the frame: a new Worker, a spawn, an entry point, a manifest, a compose service, a Dockerfile`,
								},
							},
							required: ['id', 'kind', 'name', 'line', 'quotes'],
							additionalProperties: false,
						},
					},
					things: {
						type: 'array',
						description: 'What sits in a frame: a part of the level, a store, or an outside system of "In its world"',
						items: {
							type: 'object',
							properties: {
								id: { ...ID, description: `${ID.description} An outside thing takes the id of its outside system.` },
								kind: { type: 'string', enum: THING_KINDS },
								frame: { type: 'string', description: 'The id of the frame it sits in. Leave it out for none.' },
								part: { type: 'string', description: 'For a part: its name as the level names it' },
								store: { type: 'string', enum: STORE_KINDS, description: 'For a store: its kind' },
								name: { ...NAME, description: `For a store: ${NAME.description}` },
								line: { ...LINE, description: `For a store: ${LINE.description}` },
								topics: { type: 'array', description: 'For a bus: its topics', items: { type: 'string' } },
								quotes: {
									...quotes,
									description: `For a part or a store: 1 to ${B.quotes} lines that show it runs there or is used there`,
								},
							},
							required: ['id', 'kind'],
							additionalProperties: false,
						},
					},
					crossings: {
						type: 'array',
						description: 'From one thing to another: a call that waits for its answer, or an event picked up later',
						items: {
							type: 'object',
							properties: {
								id: ID,
								kind: { type: 'string', enum: CROSSING_KINDS },
								from: { type: 'string', description: 'The id of the thing it starts at' },
								to: { type: 'string', description: 'The id of the thing it ends at' },
								text: {
									type: 'string',
									description: `What crosses, at most ${B.text} characters, such as "worker messages"`,
								},
								how: { ...HOW, description: 'For a call: how it crosses' },
								topic: { type: 'string', description: 'For an event: the topic it travels on' },
								from_quotes: { ...quotes, description: 'The lines on the from side, such as the call or the send' },
								to_quotes: { ...quotes, description: 'The lines on the to side, such as the handler or the read' },
							},
							required: ['id', 'kind', 'from', 'to', 'text'],
							additionalProperties: false,
						},
					},
					gaps: {
						type: 'array',
						description:
							'What the repository does not say about a frame, a thing or an outside system, such as "who runs it: not in the repository"',
						items: {
							type: 'object',
							properties: {
								id: ID,
								on: { type: 'string', description: 'The id of what it is about' },
								text: { type: 'string', description: `At most ${B.gap} characters` },
							},
							required: ['id', 'on', 'text'],
							additionalProperties: false,
						},
					},
				},
				additionalProperties: false,
			},
		},
		additionalProperties: false,
	} as const
}

// raw passed show's schema, so its shape is as viewsSchema says.
export function readViews(raw: JsonObject): ViewsDraft {
	const world = isObject(raw.world) ? raw.world : null
	const runtime = isObject(raw.runtime) ? raw.runtime : null
	const pick = <T extends string>(list: readonly T[], value: JsonValue | undefined): T | null =>
		list.find((each) => each === value) ?? null
	return {
		world: world && {
			outside: listOf(world.outside).map((each) => {
				const read = readArgs(each, 'show outside')
				return {
					id: read.text('id'),
					kind: pick(OUTSIDE_KINDS, each.kind) ?? 'system',
					name: read.text('name'),
					line: read.text('line'),
					quotes: quotesOf(each.quotes),
				}
			}),
			crossings: listOf(world.crossings).map((each) => {
				const read = readArgs(each, 'show crossing')
				return {
					id: read.text('id'),
					outside: read.text('outside'),
					text: read.text('text'),
					how: pick(HOWS, each.how) ?? 'other',
					direction: pick(DIRECTIONS, each.direction) ?? 'both',
					quotes: quotesOf(each.quotes),
				}
			}),
		},
		runtime: runtime && {
			frames: listOf(runtime.frames).map((each) => {
				const read = readArgs(each, 'show frame')
				const copies = isObject(each.copies) ? each.copies : null
				const count = copies?.count
				return {
					id: read.text('id'),
					kind: pick(FRAME_KINDS, each.kind) ?? 'other',
					name: read.text('name'),
					line: read.text('line'),
					in: read.optionalText('in') ?? null,
					copies:
						copies && typeof count === 'number' && isObject(copies.quote)
							? { count, quote: quoteOf(copies.quote) }
							: null,
					quotes: quotesOf(each.quotes),
				}
			}),
			things: listOf(runtime.things).map((each) => {
				const read = readArgs(each, 'show thing')
				return {
					id: read.text('id'),
					kind: pick(THING_KINDS, each.kind) ?? 'part',
					frame: read.optionalText('frame') ?? null,
					part: read.optionalText('part') ?? '',
					store: pick(STORE_KINDS, each.store),
					name: read.optionalText('name') ?? '',
					line: read.optionalText('line') ?? '',
					topics: Array.isArray(each.topics) ? each.topics.filter((topic) => typeof topic === 'string') : [],
					quotes: quotesOf(each.quotes),
				}
			}),
			crossings: listOf(runtime.crossings).map((each) => {
				const read = readArgs(each, 'show crossing')
				return {
					id: read.text('id'),
					kind: pick(CROSSING_KINDS, each.kind) ?? 'call',
					from: read.text('from'),
					to: read.text('to'),
					text: read.text('text'),
					how: pick(HOWS, each.how),
					topic: read.optionalText('topic') ?? '',
					quotes: { from: quotesOf(each.from_quotes), to: quotesOf(each.to_quotes) },
				}
			}),
			gaps: listOf(runtime.gaps).map((each) => {
				const read = readArgs(each, 'show gap')
				return { id: read.text('id'), on: read.text('on'), text: read.text('text') }
			}),
		},
	}
}

// A drawing explains the code as it is now, so a quote that names no commit is read at HEAD. A quote of a session or
// of a commit message has no path, and checkViews sends it back.
function quoteOf(raw: JsonObject): GitQuote {
	const quote = readArgs(raw, 'show quote')
	const line = quote.optionalLine('line')
	return {
		path: quote.optionalText('session') === undefined ? (quote.optionalText('path') ?? null) : null,
		commit: quote.optionalText('commit') ?? 'HEAD',
		text: quote.text('text'),
		...(line === undefined ? {} : { line }),
	}
}

function quotesOf(value: JsonValue | undefined): GitQuote[] {
	return listOf(value).map(quoteOf)
}

function listOf(value: JsonValue | undefined): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : []
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
