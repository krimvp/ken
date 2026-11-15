// The one way an answer reaches the reader. The model sends it here, checkAnswer decides, and the result tells the
// model what to fix. A question allows MAX_REJECTIONS rejected answers, so a model that cannot quote stops there
// instead of trying forever.
import type { JsonObject, JsonValue, Tool } from 'aigent/plugin'
import type { Repository } from '../../repo/index.ts'
import type { ChatEvent } from '../chat-event.ts'
import { hunkHeader } from '../tools/diff-tool.ts'
import { readArgs, refuse, reply } from '../tools/tool-edge.ts'
import type { Answer } from './answer.ts'
import { type AnswerDraft, checkAnswer } from './check-answer.ts'

export const MAX_REJECTIONS = 3
const MAX_LISTED_HUNKS = 40

// What one question has seen of the answer tool. The session makes a new one for each question.
export type AnswerRound = { rejections: number; answer: Answer | null; emit: (event: ChatEvent) => void }

export function answerTool(repo: Repository, round: () => AnswerRound): Tool {
	return {
		name: 'answer',
		description:
			'Send your answer to the reader. ken checks every quote against git and rejects the whole answer if one quote is not in its file at its commit. Call it once, when you have read the code the answer rests on.',
		parameters: ANSWER_SCHEMA,
		async execute(args, ctx) {
			const current = round()
			if (current.answer) {
				return reply('An answer is already accepted for this question. Write your one or two closing sentences now.')
			}
			if (current.rejections >= MAX_REJECTIONS) return refuse('No attempts are left for this question. Stop now.')
			const check = await checkAnswer(repo, draftOf(args), ctx.signal)
			if (check.kind === 'accepted') {
				current.answer = check.answer
				current.emit({ kind: 'accepted', answer: check.answer })
				return reply(confirmation(check.answer))
			}
			current.rejections += 1
			current.emit({ kind: 'rejected', attempt: current.rejections, problems: check.problems })
			return refuse(rejection(check.problems, current.rejections))
		},
	}
}

function confirmation(answer: Answer): string {
	const quotes = answer.statements.reduce((sum, statement) => sum + statement.quotes.length, 0)
	const lines = [
		`Answer accepted: ${answer.statements.length} statements, ${quotes} quotes. ken shows it to the reader.`,
	]
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
				quotes: listOf(raw.quotes).map((rawQuote) => {
					const quote = readArgs(rawQuote, 'answer quote')
					const line = quote.optionalLine('line')
					return {
						path: quote.text('path'),
						commit: quote.text('commit'),
						text: quote.text('text'),
						...(line === undefined ? {} : { line }),
					}
				}),
			}
		}),
	}
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

const ANSWER_SCHEMA = {
	type: 'object',
	properties: {
		scope: {
			type: 'object',
			description: 'Give it when the question is about a change: the base and head commits of that change.',
			properties: { base: { type: 'string' }, head: { type: 'string' } },
			required: ['base', 'head'],
			additionalProperties: false,
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
