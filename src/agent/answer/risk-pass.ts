// The risk pass. Once an answer about a change passes every check, ken asks the same session once more, before the
// reader sees it, to check the answer's own risks against the code and to look for what two parts of the change do
// together, in fixed steps. The agent may rewrite, add and withdraw risks, which go through the same checks, and sends
// the final order of the risks, heaviest first. ken merges what passes into one answer. When nothing passes, the first
// answer stands.
import type { JsonObject, Tool } from 'aigent/plugin'
import type { Commit, Repository } from '../../repo/index.ts'
import type { Revision } from '../chat-event.ts'
import { namesText } from '../tools/elsewhere-text.ts'
import { readArgs, refuse, reply, short } from '../tools/tool-edge.ts'
import type { Change } from './answer.ts'
import {
	type AnswerRound,
	accept,
	CLAIM_SCHEMA,
	checkAdditions,
	DECISION_SCHEMA,
	type Gate,
	type Held,
	MAX_RISKS,
	optionalList,
	sentBack,
	withoutDescriptions,
} from './answer-tool.ts'
import { allowJsonText, readJsonText } from './json-text.ts'

export const MAX_PASS_REJECTIONS = 2
const MAX_LATER = 8
const MAX_LATER_PATHS = 4

// A later commit that changed a file the change changed, with the files they share.
export type Later = { commit: Commit; shared: string[] }

// The commits after the change, up to HEAD, that changed its files, oldest first: a fix that came after shows what the
// change left undone. A change that ends at HEAD has none.
export async function laterCommits(repo: Repository, change: Change, signal?: AbortSignal): Promise<Later[]> {
	const now = await repo.resolve('HEAD', signal)
	if (now.kind !== 'ok' || now.commit === change.head) return []
	const logged = await repo.log({ base: change.head, head: now.commit }, signal)
	if (logged.kind !== 'ok') return []
	const touched = new Set([...change.covered, ...change.uncovered].map(({ path }) => path))
	return logged.commits
		.map((commit) => ({ commit, shared: commit.paths.filter((path) => touched.has(path)) }))
		.filter(({ shared }) => shared.length > 0)
		.reverse()
}

// The steps follow the checkpoint's verdicts: the plain chat found the risks that need the code outside the change, two
// parts of the change read together, or a reason checked against the code, and it ordered its risks by weight.
export function riskPassQuestion(held: Held, later: Later[]): string {
	const { answer, decisions } = held
	const risks = answer.risks ?? []
	const notFollowed = answer.change?.usedElsewhere?.notFollowed ?? []
	const head = answer.change ? short(answer.change.head) : 'HEAD'
	const mark = (checked: boolean | undefined) => (checked ? 'checked in the code' : 'not checked outside the change')
	const shown = later.slice(0, MAX_LATER)
	return [
		`ken checked your answer, and the reader has not seen it yet. Now check it against the code at the head commit ${head}, with the same tools. Take these steps in order:`,
		'1. Each risk below: read the place it points at. That is the code outside the change that uses what changed, or, for what the change left undone, the later commits below. Then rewrite the risk with a quote of that place, withdraw it because the code shows it does not happen, or keep it as it is. ken marks a risk "Checked in the code" only when it quotes, at the head commit, a line the change did not touch. A dependency\'s code is not in git, so ken cannot read it.',
		'2. Each pair of decisions that touch the same file, function, record, id or signal: what happens when both apply?',
		'3. Each early return, refusal, delete or catch in the changed lines: what no longer happens after it, and who relied on it?',
		'4. Each reason your answer quotes from a commit message or a comment: does the code do what it says? Where it does not, that is a risk.',
		'5. Each name below that no quote follows: read where it is used. Does the change still fit there? And each fix: what does it leave undone?',
		'',
		decisions.length === 0 ? 'Your answer names no decisions.' : 'The decisions in your answer:',
		...decisions.map((d, at) => `${at + 1}. ${d.question} Chosen: ${d.chosen} Why: ${d.reason.text}`),
		'',
		risks.length === 0 ? 'Your answer names no risks.' : 'The risks in your answer:',
		...risks.map((risk, at) => `${at + 1}. (${mark(risk.checked)}) ${risk.text}`),
		'',
		...(notFollowed.length === 0
			? ['Every name ken found used elsewhere has a quote of your answer at one of its places.']
			: [`Names used elsewhere, at ${head}, that no quote of your answer follows:`, ...namesText(notFollowed)]),
		...(shown.length === 0
			? []
			: [
					'',
					`Later commits that changed the same files, after ${head}, oldest first${later.length > shown.length ? `, the first ${shown.length} of ${later.length}` : ''}. log with base <commit>^1 and head <commit> shows one's message:`,
					...shown.map(
						({ commit, shared }) =>
							`- ${short(commit.hash)} ${commit.date.slice(0, 10)} ${commit.subject} (${shared.slice(0, MAX_LATER_PATHS).join(', ')}${shared.length > MAX_LATER_PATHS ? ', ...' : ''})`,
					),
				]),
		'',
		'Then call revise_answer once:',
		'- risks: each new risk, and each risk above that you rewrite, with replaces set to its number. A risk is one or two sentences: what can happen, to whom, and when. Quote the place it rests on.',
		'- withdraw: each risk above that the code shows does not happen, with what the code shows instead.',
		`- order: the numbers of all the risks the answer keeps, the heaviest first: what can hurt the owner most, soonest. A risk above keeps its number; the risks you send are ${risks.length + 1}, ${risks.length + 2} and on, in the order you send them. A minor or speculative risk goes last, or withdraw it. At most ${MAX_RISKS} risks.`,
		'- decisions: a decision your answer missed, with its quotes.',
	].join('\n')
}

export function reviseTool(gate: Gate, round: () => AnswerRound): Tool {
	return {
		name: 'revise_answer',
		description:
			'After ken asks you to check your answer: rewrite, add and withdraw risks, put them in order, and add decisions. ken checks every quote as it checked the answer, then shows the reader one answer.',
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
			const first = optionalList(held.args.risks)
			const sent = optionalList(read.args.risks).map((raw) => {
				const { replaces, ...risk } = raw
				return { risk, replaces: readArgs(raw, 'revise_answer risk').optionalLine('replaces') }
			})
			const decisions = optionalList(read.args.decisions)
			const asked = optionalList(read.args.withdraw).map((each) => {
				const item = readArgs(each, 'revise_answer withdraw')
				return { number: item.optionalLine('risk') ?? 0, reason: item.text('reason') }
			})
			const withdrawn = asked.filter(({ number }, at) => asked.findIndex((other) => other.number === number) === at)
			const given = read.args.order
			const order = Array.isArray(given) ? given.flatMap((n) => (typeof n === 'number' ? [n] : [])) : []
			const replaced = sent.map(({ replaces }) => replaces)
			const form =
				given === undefined && first.length + sent.length > 0
					? ['Send order: the numbers of all the risks the answer keeps, the heaviest first.']
					: orderProblems(
							first.length,
							replaced,
							withdrawn.map(({ number }) => number),
							order,
						)
			if (form.length > 0) return sentBack(form)
			const risks = sent.map(({ risk }) => risk)
			const added = await checkAdditions(gate.sources, { risks, decisions }, ctx.signal)
			if (added.kind === 'form') return sentBack(added.problems)
			if (added.kind === 'rejected') return rejected(current, held, added.problems)
			const pick = (number: number) => (number <= first.length ? first[number - 1] : risks[number - first.length - 1])
			const merged: JsonObject = {
				...held.args,
				risks: order.flatMap((number) => pick(number) ?? []),
				decisions: [...optionalList(held.args.decisions), ...decisions],
			}
			const revision: Revision = {
				risks: order.map((number) => {
					if (number <= first.length) return { kind: 'kept', was: number }
					const was = replaced[number - first.length - 1]
					return was === undefined ? { kind: 'added' } : { kind: 'rewritten', was }
				}),
				decisions: decisions.length,
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

// A revision's form, which the model fixes without reading code again: each risk of the first answer is kept in order,
// rewritten or withdrawn, once, and each risk it sends is in order. The answer's own check refuses more than MAX_RISKS.
function orderProblems(n: number, replaced: (number | undefined)[], withdrawn: number[], order: number[]): string[] {
	const problems: string[] = []
	const last = n + replaced.length
	for (const number of [...withdrawn, ...replaced.flatMap((each) => each ?? [])]) {
		if (number > n) problems.push(`Your answer has ${n} risks, so there is no risk ${number} to withdraw or rewrite.`)
	}
	for (const [at, number] of order.entries()) {
		if (number > last) problems.push(`order names risk ${number}, but the last risk is ${last}.`)
		if (order.indexOf(number) !== at) problems.push(`order names risk ${number} twice.`)
	}
	for (let number = 1; number <= n; number++) {
		const fates = [order.includes(number), withdrawn.includes(number), replaced.includes(number)]
		const count = fates.filter(Boolean).length
		if (count === 0) {
			problems.push(
				`Risk ${number} of your answer is not in order, not withdrawn and not rewritten. Give it one of the three.`,
			)
		}
		if (count > 1) {
			problems.push(
				`Risk ${number} of your answer is given more than one of: in order, withdrawn, rewritten. Give it one.`,
			)
		}
	}
	for (let number = n + 1; number <= last; number++) {
		if (!order.includes(number))
			problems.push(`The risk you send as number ${number} is not in order. Put it there, or leave it out.`)
	}
	return problems
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

const CLAIM = withoutDescriptions(CLAIM_SCHEMA)
const REVISE_SCHEMA = {
	type: 'object',
	properties: {
		risks: {
			type: 'array',
			description: 'New risks, and risks of your answer rewritten, each with its quotes',
			items: {
				...CLAIM,
				properties: {
					...CLAIM.properties,
					replaces: { type: 'integer', minimum: 1, description: 'The number of the risk above that this one rewrites' },
				},
			},
		},
		withdraw: {
			type: 'array',
			description: 'Risks of your answer that the code shows do not happen',
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
		order: {
			type: 'array',
			description: `The numbers of every risk the answer keeps, the heaviest first, at most ${MAX_RISKS}`,
			items: { type: 'integer', minimum: 1 },
		},
		decisions: { type: 'array', description: 'Decisions to add', items: withoutDescriptions(DECISION_SCHEMA) },
	},
	additionalProperties: false,
} as const
