// The risk pass. Once an answer about a change passes every check, ken asks the same session once more, before the
// reader sees it, with fixed questions about each decision and about each name used elsewhere that no quote follows.
// The agent may add risks and decisions, which go through the same checks, and must withdraw a risk that the code it
// has now read does not support. ken merges what passes into one answer. When nothing passes, the first answer stands.
import type { JsonObject, Tool } from 'aigent/plugin'
import { namesText } from '../tools/elsewhere-text.ts'
import { readArgs, refuse, reply, short } from '../tools/tool-edge.ts'
import {
	type AnswerRound,
	accept,
	CLAIM_SCHEMA,
	checkAdditions,
	DECISION_SCHEMA,
	type Gate,
	type Held,
	optionalList,
	sentBack,
	withoutDescriptions,
} from './answer-tool.ts'
import { allowJsonText, readJsonText } from './json-text.ts'

export const MAX_PASS_REJECTIONS = 2

// The questions follow the plan's checkpoint, where a plain chat found what the answers missed: consequences with no
// single line to quote, and a caller the change did not update.
export function riskPassQuestion(held: Held): string {
	const { answer, decisions } = held
	const risks = answer.risks ?? []
	const notFollowed = answer.change?.usedElsewhere?.notFollowed ?? []
	const head = answer.change ? short(answer.change.head) : ''
	return [
		'ken checked your answer, and the reader has not seen it yet. Look once more for what could go wrong. Ask these five questions of each decision below, and of each name below that no quote of your answer follows to a place that uses it:',
		'1. Who or what does this now affect that it did not before: an existing caller, a user, a default, a setting?',
		'2. What is no longer done, kept or recorded?',
		'3. What does it rely on outside this repository: another program, a service, a file format, a setting someone else must set?',
		'4. What stored data, or results made before the change, can no longer be read, or compared with new ones?',
		'5. Which caller or other user of a changed thing did the change not update?',
		'',
		decisions.length === 0 ? 'Your answer names no decisions.' : 'The decisions in your answer:',
		...decisions.map((decision, at) => `${at + 1}. ${decision.question} Chosen: ${decision.chosen}`),
		'',
		risks.length === 0 ? 'Your answer names no risks.' : 'The risks in your answer:',
		...risks.map((risk, at) => `${at + 1}. ${risk.text}`),
		'',
		...(notFollowed.length === 0
			? ['Every name ken found used elsewhere has a quote of your answer at one of its places.']
			: [
					`Names used elsewhere, at the head commit ${head}, that no quote of your answer follows:`,
					...namesText(notFollowed),
				]),
		'',
		'Read the code before you write: each place, and the whole function around it. Then call revise_answer once:',
		'- risks and decisions: each one to add, with its quotes. ken checks them as it checked the answer.',
		'- withdraw: the number of each risk above that the code you have now read does not support, and why. To correct a risk, withdraw it and add the corrected one.',
		'- If you find nothing to change, call revise_answer with nothing in it.',
		'A risk you add is one or two sentences: what can happen, to whom, and when. Quote the lines it starts from, such as the place that still does the old thing. Do not add what your answer already says. Label a risk found-by-search when it rests on a search, not on code you read.',
	].join('\n')
}

export function reviseTool(gate: Gate, round: () => AnswerRound): Tool {
	return {
		name: 'revise_answer',
		description:
			'After ken asks its questions about risks: add risks and decisions to your checked answer, and withdraw its risks that the code does not support. ken checks every quote as it checked the answer, then shows the reader one answer.',
		parameters: allowJsonText(REVISE_SCHEMA),
		async execute(args, ctx) {
			const current = round()
			const { held } = current
			if (current.answer) {
				return reply('An answer is already accepted for this question. Write your one or two closing sentences now.')
			}
			if (!held) return refuse('Send your answer with the answer tool first. ken asks about risks once it passes.')
			if (held.rejections >= MAX_PASS_REJECTIONS)
				return refuse('No attempts are left. Your first answer stands. Stop now.')
			const read = readJsonText(REVISE_SCHEMA, args)
			if (read.kind === 'refused') return rejected(current, held, read.problems)
			const risks = optionalList(read.args.risks)
			const decisions = optionalList(read.args.decisions)
			const first = optionalList(held.args.risks)
			const asked = optionalList(read.args.withdraw).map((each) => {
				const item = readArgs(each, 'revise_answer withdraw')
				return { number: item.optionalLine('risk') ?? 0, reason: item.text('reason') }
			})
			const withdrawn = asked.filter(({ number }, at) => asked.findIndex((other) => other.number === number) === at)
			const outside = withdrawn.filter(({ number }) => number > first.length)
			if (outside.length > 0) {
				return sentBack(
					outside.map(
						({ number }) => `Your answer has ${first.length} risks, so there is no risk ${number} to withdraw.`,
					),
				)
			}
			const added = await checkAdditions(gate.sources, { risks, decisions }, ctx.signal)
			if (added.kind === 'form') return sentBack(added.problems)
			if (added.kind === 'rejected') return rejected(current, held, added.problems)
			const out = new Set(withdrawn.map(({ number }) => number))
			const merged: JsonObject = {
				...held.args,
				risks: [...first.filter((_, at) => !out.has(at + 1)), ...risks],
				decisions: [...optionalList(held.args.decisions), ...decisions],
			}
			const revision = {
				added: { risks: risks.length, decisions: decisions.length },
				withdrawn: withdrawn.flatMap(({ number, reason }) => {
					const risk = held.answer.risks?.[number - 1]
					return risk ? [{ risk, reason }] : []
				}),
			}
			const accepted = await accept(gate, current, merged, revision, ctx.signal)
			if (accepted.kind === 'accepted') return reply(accepted.reply)
			if (accepted.kind === 'form') return sentBack(accepted.problems)
			return rejected(current, held, accepted.problems)
		},
	}
}

function rejected(current: AnswerRound, held: Held, problems: string[]) {
	held.rejections += 1
	current.emit({ kind: 'rejected', attempt: current.rejections + held.rejections, problems })
	const tail =
		held.rejections >= MAX_PASS_REJECTIONS
			? 'That was the last attempt, so your first answer stands as ken checked it. Stop now.'
			: 'Fix these and call revise_answer again. Copy each quote from read_file or diff output.'
	const head = `Revision rejected, attempt ${held.rejections} of ${MAX_PASS_REJECTIONS}. Your first answer is unchanged.`
	return refuse([head, ...problems.map((problem) => `- ${problem}`), tail].join('\n'))
}

const REVISE_SCHEMA = {
	type: 'object',
	properties: {
		risks: {
			type: 'array',
			description: 'Risks to add, each with its quotes',
			items: withoutDescriptions(CLAIM_SCHEMA),
		},
		decisions: { type: 'array', description: 'Decisions to add', items: withoutDescriptions(DECISION_SCHEMA) },
		withdraw: {
			type: 'array',
			description: 'Risks of your answer that the code does not support',
			items: {
				type: 'object',
				properties: {
					risk: { type: 'integer', minimum: 1, description: 'Its number in the list ken sent' },
					reason: { type: 'string', description: 'What the code shows instead, in one sentence' },
				},
				required: ['risk', 'reason'],
				additionalProperties: false,
			},
		},
	},
	additionalProperties: false,
} as const
