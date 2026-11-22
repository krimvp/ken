// How the model sends a brief with show, and how ken reads it. A brief travels as one argument, and ken takes it apart
// into what it already checks: each thing to know is a claim, and each term is a topic. So a brief has no check of its
// own, and one thing to know with a bad quote goes back alone, as a card does.
import type { JsonObject, JsonValue } from 'aigent/plugin'
import type { Quote } from '../../checks/index.ts'
import type { ClaimDraft, TopicDraft } from '../reply/check-card.ts'
import { readArgs } from '../tools/tool-edge.ts'
import { BRIEF_BOUNDS, DRAWING_KINDS, DRAWINGS, type Drawing, wordCount } from './brief.ts'

const { lineWords, points, fewestPoints, terms, meansWords, questions, fewestQuestions, question, counts, label } =
	BRIEF_BOUNDS
const [fewest, most] = counts

// quote is the schema of one quote, as show's other cards take it.
export function briefSchema<Q extends JsonObject>(quote: Q) {
	return {
		type: 'object',
		description:
			'Only when the question asks for a brief: what to know about one part, or the answer to one question, as short lines a reader takes in beside a picture. One show call per brief. ken checks each thing to know and each term alone, and one that fails comes back alone. To fix one that came back, send a brief with the same number that holds only it.',
		properties: {
			number: {
				type: 'integer',
				minimum: 1,
				description: 'The number the question gives the part, or 1 when the question is about one thing',
			},
			line: {
				type: 'string',
				description: 'One sentence: what the part does for whoever uses it, or the answer to the question',
			},
			points: {
				type: 'array',
				description: `${fewestPoints} to ${points} things to know, one idea each, each resting on quoted lines of code`,
				items: {
					type: 'object',
					properties: {
						line: { type: 'string', description: `The idea as a whole sentence of at most ${lineWords} words` },
						more: { type: 'string', description: 'One sentence that says it in full' },
						long: { type: 'string', description: 'Two or three sentences, for a reader who wants words' },
						drawing: {
							type: 'object',
							properties: {
								kind: {
									type: 'string',
									enum: DRAWING_KINDS,
									description: `The one that shows the idea. ${DRAWING_KINDS.map((kind) => `${kind}: ${DRAWINGS[kind]}`).join('. ')}.`,
								},
								count: {
									type: 'integer',
									minimum: fewest,
									description: `For steps and loop: how many, ${fewest} to ${most}`,
								},
								lit: { type: 'integer', minimum: 1, description: 'For steps: the step that is filled, from 1' },
								label: {
									type: 'string',
									description: `A word or two to print under the drawing, at most ${label} characters`,
								},
							},
							required: ['kind'],
							additionalProperties: false,
						},
						quotes: {
							type: 'array',
							minItems: 1,
							description: 'The lines of code it rests on, each with its path. A quote with no commit is read at HEAD.',
							items: quote,
						},
					},
					required: ['line', 'more', 'long', 'drawing', 'quotes'],
					additionalProperties: false,
				},
			},
			terms: {
				type: 'array',
				description: `Up to ${terms} words the code uses that a newcomer would not know`,
				items: {
					type: 'object',
					properties: {
						name: { type: 'string', description: 'The word as the code spells it' },
						means: { type: 'string', description: `What it means, in at most ${meansWords} words` },
						quote: quote,
					},
					required: ['name', 'means', 'quote'],
					additionalProperties: false,
				},
			},
			questions: {
				type: 'array',
				description: `${fewestQuestions} or ${questions} questions a reader would ask next, one sentence each`,
				items: { type: 'string' },
			},
		},
		required: ['number', 'line'],
		additionalProperties: false,
	} as const
}

type Parsed<Draft> = { where: string; parse: (problems: string[]) => Draft }

// left says what the brief sent past its bounds, which ken does not check.
export type BriefDraft = {
	number: number
	line: string
	questions: string[]
	points: Parsed<ClaimDraft>[]
	terms: Parsed<TopicDraft>[]
	left: string[]
}

// raw passed show's schema, so its shape is as briefSchema says. quoteOf reads one quote and adds what is wrong
// with it to problems.
export function readBrief(raw: JsonObject, quoteOf: (raw: JsonObject, problems: string[]) => Quote): BriefDraft {
	const brief = readArgs(raw, 'show brief')
	const number = brief.optionalLine('number')
	if (number === undefined) throw new Error('show: a brief has no number, so its schema and its reader disagree')
	// A brief explains the code as it is now, so a quote that names no commit is read at HEAD.
	const atHead = (quote: JsonObject) => ('commit' in quote || 'session' in quote ? quote : { ...quote, commit: 'HEAD' })
	const fileQuote = (quote: JsonObject, problems: string[]) => {
		const read = quoteOf(atHead(quote), problems)
		if ('session' in read || read.path === null) {
			problems.push('It quotes a commit message or a saved session. A brief rests on lines of files: give the path.')
		}
		return read
	}
	const sentPoints = listOf(raw.points)
	const sentTerms = listOf(raw.terms)
	const asked = textsOf(raw.questions)
	return {
		number,
		line: brief.text('line').trim(),
		questions: asked.filter((each) => each.length <= question).slice(0, questions),
		points: sentPoints.slice(0, points).map((each, at) => ({
			where: `Point ${at + 1}`,
			parse: (problems) => {
				const point = readArgs(each, 'show point')
				return {
					text: point.text('more'),
					label: 'inferred',
					quotes: listOf(each.quotes).map((quote) => fileQuote(quote, problems)),
					point: { line: point.text('line').trim(), long: point.text('long').trim(), drawing: drawingOf(each.drawing) },
				}
			},
		})),
		terms: sentTerms.slice(0, terms).map((each, at) => ({
			where: `Term ${at + 1}`,
			parse: (problems) => {
				const term = readArgs(each, 'show term')
				const means = term.text('means').trim()
				if (wordCount(means) > meansWords) {
					problems.push(`Its meaning has ${wordCount(means)} words; keep it to ${meansWords}.`)
				}
				const quoted = isObject(each.quote) ? [fileQuote(each.quote, problems)] : []
				return { name: term.text('name').trim(), note: means, quotes: quoted, replaces: null }
			},
		})),
		left: [
			...(sentPoints.length > points ? [`A brief holds ${points} things to know, so the rest were not checked.`] : []),
			...(sentTerms.length > terms ? [`A brief holds ${terms} terms, so the rest were not checked.`] : []),
		],
	}
}

// A drawing is the page's to draw, so a count, a lit step or a label outside what the page draws is left out and the
// kind stands.
function drawingOf(raw: JsonValue | undefined): Drawing {
	if (!isObject(raw)) return { kind: 'dot' }
	const kind = DRAWING_KINDS.find((known) => known === raw.kind) ?? 'dot'
	const whole = (value: JsonValue | undefined) => (typeof value === 'number' && Number.isInteger(value) ? value : null)
	const count = whole(raw.count)
	const lit = whole(raw.lit)
	const word = typeof raw.label === 'string' ? raw.label.trim() : ''
	const counted = count !== null && count >= fewest && count <= most ? count : null
	return {
		kind,
		...(counted === null ? {} : { count: counted }),
		...(lit !== null && lit >= 1 && lit <= (counted ?? most) ? { lit } : {}),
		...(word !== '' && word.length <= label ? { label: word } : {}),
	}
}

function listOf(value: JsonValue | undefined): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : []
}

function textsOf(value: JsonValue | undefined): string[] {
	const texts = Array.isArray(value) ? value.flatMap((each) => (typeof each === 'string' ? [each.trim()] : [])) : []
	return texts.filter((text) => text !== '')
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
