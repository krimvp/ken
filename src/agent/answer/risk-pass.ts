// The risk pass. Once an answer about a change passes every check, ken asks the same session once more, before the
// reader sees it, to check the answer's own risks against the code and to look for what two parts of the change do
// together, in fixed steps. The agent may rewrite, add and withdraw risks, which go through the same checks, and sends
// the final order of the risks, heaviest first. ken merges what passes into one answer. When nothing passes, the first
// answer stands.
import type { JsonObject, Tool } from 'aigent/plugin'
import { type Quote, type QuoteSources, type VerifiedQuote, verifyQuote } from '../../checks/index.ts'
import type { Commit, CommitHash, Range, Repository } from '../../repo/index.ts'
import type { Revision } from '../chat-event.ts'
import { namesText } from '../tools/elsewhere-text.ts'
import { readArgs, refuse, reply, short } from '../tools/tool-edge.ts'
import {
	type AnswerRound,
	accept,
	checkAdditions,
	DECISION_SCHEMA,
	type Gate,
	type Held,
	optionalList,
	QUOTE,
	quoteOf,
	RISK_SCHEMA,
	sentBack,
	WEIGHT_RULE,
	withoutDescriptions,
} from './answer-tool.ts'
import { allowJsonText, readJsonText } from './json-text.ts'

export const MAX_PASS_REJECTIONS = 2
const MAX_LATER = 8
const MAX_LATER_PATHS = 4
const MAX_OPENING_CHARS = 300

// A later commit that changed a file the change changed, with the files they share and the first lines of its message
// body, each with its line number in the message.
export type Later = { commit: Commit; shared: string[]; opening: { line: number; text: string }[] }
export type LaterCommits = { shown: Later[]; total: number }

// The commits after the change, up to HEAD, that changed its files. A fix that came after shows what the change left
// open, so the fixes come first; then those that share the most files, since a design doc that nearly every commit
// touches would fill the list with fixes of other things; then the oldest. A change that ends at HEAD has none.
export async function laterCommits(repo: Repository, range: Range, signal?: AbortSignal): Promise<LaterCommits> {
	const none = { shown: [], total: 0 }
	const now = await repo.resolve('HEAD', signal)
	if (now.kind !== 'ok' || now.commit === range.head) return none
	const [logged, diff] = await Promise.all([
		repo.log({ base: range.head, head: now.commit }, signal),
		repo.diff(range, signal),
	])
	if (logged.kind !== 'ok' || diff.kind !== 'ok') return none
	const touched = new Set(diff.files.flatMap((file) => [file.path, file.oldPath]))
	const fix = (commit: Commit) => (/^fix\b/i.test(commit.subject) ? 0 : 1)
	const later = logged.commits
		.map((commit) => ({ commit, shared: commit.paths.filter((path) => touched.has(path)) }))
		.filter(({ shared }) => shared.length > 0)
		.reverse()
		.sort((a, b) => fix(a.commit) - fix(b.commit) || b.shared.length - a.shared.length)
	const shown = await Promise.all(
		later.slice(0, MAX_LATER).map(async (each) => {
			const message = await repo.message(each.commit.hash, signal)
			return { ...each, opening: message.kind === 'ok' ? openingOf(message.text) : [] }
		}),
	)
	return { shown, total: later.length }
}

// Whole lines of the body, up to MAX_OPENING_CHARS in all, so each can be quoted as it is. One line longer than that is
// cut, and says so.
function openingOf(message: string): Later['opening'] {
	const opening: Later['opening'] = []
	let used = 0
	for (const [at, text] of message.split('\n').entries()) {
		if (at === 0 || text.trim() === '') continue
		if (opening.length > 0 && used + text.length > MAX_OPENING_CHARS) break
		const cut = text.length > MAX_OPENING_CHARS ? `${text.slice(0, MAX_OPENING_CHARS)} [line cut]` : text
		opening.push({ line: at + 1, text: cut })
		used += text.length
	}
	return opening
}

// The listing the draft's log and the second look both get, numbered by line the way log numbers a message.
export function laterText({ shown, total }: LaterCommits, head: string): string[] {
	if (shown.length === 0) return []
	const of = total > shown.length ? `; here are ${shown.length} of ${total}` : ''
	return [
		`Later commits that changed the same files, after ${short(head)}, the fixes first, then those that share the most files${of}. Each gives its subject and the start of its message by line, as log does; log with base <commit>^1 and head <commit> shows the whole message.`,
		...shown.flatMap(({ commit, shared, opening }) => [
			`- ${short(commit.hash)} ${commit.date.slice(0, 10)} ${commit.subject} (${shared.slice(0, MAX_LATER_PATHS).join(', ')}${shared.length > MAX_LATER_PATHS ? ', ...' : ''})`,
			...opening.map(({ line, text }) => `${String(line).padStart(6)}\t${text}`),
		]),
	]
}

// The steps follow the checkpoint's verdicts: the plain chat found the risks that need the code outside the change, two
// parts of the change read together, a behaviour no test covers or a thing outside the repository, and it ordered its
// risks by who hits them and when. The first step tries to prove each risk false, because a judge found a false risk
// and an unsettled one that one line of code settled, and the pass had never withdrawn a risk.
export function riskPassQuestion(held: Held, later: LaterCommits): string {
	const { answer, decisions } = held
	const risks = answer.risks ?? []
	const notFollowed = answer.change?.usedElsewhere?.notFollowed ?? []
	const head = answer.change ? short(answer.change.head) : 'HEAD'
	const mark = (checked: boolean | undefined) =>
		checked ? 'quotes code outside the change' : 'quotes only the changed lines'
	const listed = laterText(later, head)
	return [
		`ken checked your answer, and the reader has not seen it yet. Now check it against the code at the head commit ${head}, with the same tools. Take these steps in order:`,
		`1. Each risk below: find the code that would make it false, and read it: a check that stops the case, a caller that never passes the value. Withdraw the risk when that code shows it does not happen; that is a normal result. A withdrawal quotes the line that makes the risk false, the code at ${head} or a line of a later commit's message below, and ken refuses a withdrawal with no such quote. "This is not new behaviour" and "this costs little" are not reasons to withdraw: such a risk stays, weighed minor. A later commit below that fixed the risk shows it was real: keep it, and say it was fixed since, in which commit. A risk that begins with "if" ends settled: rewrite it without the "if" and quote the line that settles it, or withdraw it. It may stay unsettled only when the code that decides it is not in git, such as a dependency's, and then it says so. Otherwise rewrite the risk with a quote of the place it rests on, or keep it as it is. ken marks a risk "Quotes code outside the change" only when one of its quotes, at the head commit, holds no line the change touched, and "Quotes only the changed lines" otherwise. A dependency's code is not in git, so ken cannot read it.`,
		'2. Each pair of decisions that touch the same file, function, record, id or signal, such as one that writes or keeps a thing and one that deletes or skips it: what happens when both apply?',
		'3. Each early return, refusal, delete or catch in the changed lines: what no longer happens after it, and who relied on it?',
		'4. Which new behaviour has no test? And what does the change lean on outside the repository, such as a setting, a service or the way a dependency behaves? A risk that says something is missing, never called, or not tested carries absent, the text whose absence proves it; without absent, it must not make the claim.',
		'5. Each name below that no quote follows: read where it is used. Does the change still fit there?',
		"6. Each later fix below: what did this change leave open that the fix closed? Send it as a risk as of this change: quote the line of the fixing commit's message that says what was wrong, and say it has been fixed since, in which commit.",
		'',
		decisions.length === 0 ? 'Your answer names no decisions.' : 'The decisions in your answer:',
		...decisions.map((d, at) => `${at + 1}. ${d.question} Chosen: ${d.chosen} Why: ${d.reason.text}`),
		'',
		risks.length === 0 ? 'Your answer names no risks.' : 'The risks in your answer:',
		...risks.map(
			(risk, at) => `${at + 1}. (${risk.weight ? `${risk.weight}, ` : ''}${mark(risk.checked)}) ${risk.text}`,
		),
		'',
		...(notFollowed.length === 0
			? ['Every name ken found used elsewhere has a quote of your answer at one of its places.']
			: [`Names used elsewhere, at ${head}, that no quote of your answer follows:`, ...namesText(notFollowed)]),
		...(listed.length === 0 ? [] : ['', ...listed]),
		'',
		'Before you call revise_answer, write what you found in steps 2, 3, 4 and 6, one short line each: the two decisions, the line or the behaviour, and what happens. These lines are not part of the answer.',
		'Then call revise_answer once:',
		`- risks: each new risk, and each risk above that you rewrite, with replaces set to its number. A risk is one or two sentences: what can happen, who hits it (a host, an operator, a reader of results, a later developer) and when (always, on resume, only for runs made before this change, only under load). Quote the place it rests on, and give it its weight: ${WEIGHT_RULE}. A new risk that needs a rare case and costs little is left out, not sent as minor; ten risks is a sign of padding.`,
		`- withdraw: each risk above that the code shows does not happen, with what the code shows instead and, in quotes, the lines that show it: code at ${head}, or a line of a later commit's message.`,
		`- order: the numbers of all the risks the answer keeps, the heaviest first, by who hits each and when. A risk above keeps its number; the risks you send are ${risks.length + 1}, ${risks.length + 2} and on, in the order you send them. A minor or speculative risk goes last.`,
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
			const sourceProblems: string[] = []
			const asked = optionalList(read.args.withdraw).map((each) => {
				const item = readArgs(each, 'revise_answer withdraw')
				const quotes = optionalList(each.quotes).map((quote) => quoteOf(quote, sourceProblems))
				return { number: item.optionalLine('risk') ?? 0, reason: item.text('reason'), quotes }
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
			const head = held.answer.change?.head
			if (!head) throw new Error('revise_answer: ken holds only an answer about a change, so it has a head commit')
			const proofForm = await proofProblems(gate.sources.repo, head, withdrawn, ctx.signal)
			if (form.length + sourceProblems.length + proofForm.length > 0) {
				return sentBack([...form, ...sourceProblems, ...proofForm])
			}
			const risks = sent.map(({ risk }) => risk)
			const added = await checkAdditions(gate.sources, { risks, decisions }, head, ctx.signal)
			if (added.kind === 'form') return sentBack(added.problems)
			if (added.kind === 'rejected') return rejected(current, held, added.problems)
			const proved = await checkProof(gate.sources, withdrawn, ctx.signal)
			if (proved.kind === 'rejected') return rejected(current, held, proved.problems)
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
			}
			const taken = proved.withdrawn.flatMap(({ number, reason, proof }) => {
				const risk = held.answer.risks?.[number - 1]
				return risk ? [{ risk, reason, proof }] : []
			})
			const accepted = await accept(gate, current, merged, { revision, withdrawn: taken }, ctx.signal)
			if (accepted.kind === 'accepted') return reply(accepted.reply)
			if (accepted.kind === 'form') return sentBack(accepted.problems)
			return rejected(current, held, accepted.problems)
		},
	}
}

type Withdrawal = { number: number; reason: string; quotes: Quote[] }

// A withdrawal's form: it quotes at least one line, and each is the code at the change's head commit, where the risk
// would happen, or a line of the message of a commit made after it.
async function proofProblems(
	repo: Repository,
	head: CommitHash,
	withdrawn: Withdrawal[],
	signal: AbortSignal,
): Promise<string[]> {
	const problems: string[] = []
	const at = short(head)
	for (const { number, quotes } of withdrawn) {
		const where = `The withdrawal of risk ${number}`
		if (quotes.length === 0) {
			problems.push(
				`${where} has no quote. Quote the line that makes the risk false: code at the head commit ${at}, or a line of a later commit's message. A risk that is not new, or that costs little, is not withdrawn: keep it, weighed minor.`,
			)
		}
		for (const quote of quotes) {
			if ('session' in quote) {
				problems.push(`${where} quotes a saved session. Quote code at ${at} or a line of a later commit's message.`)
				continue
			}
			const resolved = await repo.resolve(quote.commit, signal)
			if (resolved.kind !== 'ok') continue
			if (quote.path !== null && resolved.commit !== head) {
				problems.push(`${where} quotes ${quote.path} at ${short(resolved.commit)}. Quote it at the head commit ${at}.`)
			}
			if (quote.path === null && !(await isLater(repo, head, resolved.commit, signal))) {
				problems.push(
					`${where} quotes the message of ${short(resolved.commit)}, which is not a commit made after ${at}. Quote code at ${at} or a later commit's message.`,
				)
			}
		}
	}
	return problems
}

async function isLater(repo: Repository, head: CommitHash, commit: CommitHash, signal: AbortSignal) {
	if (commit === head) return false
	const base = await repo.mergeBase(head, commit, signal)
	return base.kind === 'ok' && base.commit === head
}

// Each withdrawal's quotes are checked as every quote is: a line that is not there rejects the revision.
async function checkProof(
	sources: QuoteSources,
	withdrawn: Withdrawal[],
	signal: AbortSignal,
): Promise<
	| { kind: 'ok'; withdrawn: { number: number; reason: string; proof: VerifiedQuote[] }[] }
	| { kind: 'rejected'; problems: string[] }
> {
	const problems: string[] = []
	const checked = await Promise.all(
		withdrawn.map(async ({ number, reason, quotes }) => {
			const verdicts = await Promise.all(quotes.map((quote) => verifyQuote(sources, quote, signal)))
			const proof = verdicts.flatMap((verdict, at) => {
				if (verdict.kind === 'verified') return [verdict.quote]
				problems.push(`The withdrawal of risk ${number}, quote ${at + 1}: ${verdict.problem}`)
				return []
			})
			return { number, reason, proof }
		}),
	)
	return problems.length > 0 ? { kind: 'rejected', problems } : { kind: 'ok', withdrawn: checked }
}

// A revision's form, which the model fixes without reading code again: each risk of the first answer is kept in order,
// rewritten or withdrawn, once, and each risk it sends is in order.
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

const RISK = withoutDescriptions(RISK_SCHEMA)
const REVISE_SCHEMA = {
	type: 'object',
	properties: {
		risks: {
			type: 'array',
			description: 'New risks, and risks of your answer rewritten, each with its quotes',
			items: {
				...RISK,
				properties: {
					...RISK.properties,
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
					quotes: {
						type: 'array',
						description:
							"The lines that make the risk false: code at the head commit, or a line of a later commit's message. ken refuses a withdrawal without one.",
						items: QUOTE,
					},
				},
				required: ['risk', 'reason'],
				additionalProperties: false,
			},
		},
		order: {
			type: 'array',
			description: 'The numbers of every risk the answer keeps, the heaviest first',
			items: { type: 'integer', minimum: 1 },
		},
		decisions: { type: 'array', description: 'Decisions to add', items: withoutDescriptions(DECISION_SCHEMA) },
	},
	additionalProperties: false,
} as const
