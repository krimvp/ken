// The second look. When a reply about a change has sent its risks, ken holds them and asks the same session once more,
// before the reader sees them, to check those risks against the code and to look for what two parts of the change do
// together, in fixed steps. The model may rewrite, add and withdraw risks, which go through the same checks, and sends
// their final order, heaviest first. A withdrawal carries the lines that rule its risk out. When nothing passes, the
// risks it held show as they were.
import type { Tool } from 'aigent/plugin'
import { type NotFollowed, type Quote, type QuoteSources, type VerifiedQuote, verifyQuote } from '../../checks/index.ts'
import type { Decision } from '../../record/index.ts'
import type { Commit, CommitHash, Range, Repository } from '../../repo/index.ts'
import { namesText } from '../tools/elsewhere-text.ts'
import { readArgs, refuse, reply, short } from '../tools/tool-edge.ts'
import { checkCard, isLater } from './check-card.ts'
import { allowJsonText, readJsonText } from './json-text.ts'
import type { Card, Risk } from './reply.ts'
import {
	claimOf,
	contextOf,
	type Gate,
	optionalList,
	QUOTE,
	quoteOf,
	RISK_SCHEMA,
	type Round,
	WEIGHT_RULE,
	withoutDescriptions,
} from './show-tool.ts'

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
// held is what the reply showed and sent of the change: its risks, its decisions, and the names used elsewhere that no
// quote of it follows.
export type Held = { head: CommitHash; risks: Risk[]; decisions: Decision[]; notFollowed: NotFollowed[] }

export function riskPassQuestion(held: Held, later: LaterCommits): string {
	const { risks, decisions, notFollowed } = held
	const head = short(held.head)
	const mark = (checked: boolean | undefined) =>
		checked === undefined ? '' : checked ? 'quotes code outside the change' : 'quotes only the changed lines'
	const listed = laterText(later, head)
	return [
		`ken checked the risks you sent, and the reader has not seen them yet. Now check them against the code at the head commit ${head}, with the same tools. Take these steps in order:`,
		`1. Each risk below: find the code that would make it false, and read it: a check that stops the case, a caller that never passes the value. Withdraw the risk when that code shows it does not happen; that is a normal result. A withdrawal quotes the line that makes the risk false, the code at ${head} or a line of a later commit's message below, and ken refuses a withdrawal with no such quote. "This is not new behaviour" and "this costs little" are not reasons to withdraw: such a risk stays, weighed minor. A later commit below that fixed the risk shows it was real: keep it, and say it was fixed since, in which commit. A risk that begins with "if" ends settled: rewrite it without the "if" and quote the line that settles it, or withdraw it. It may stay unsettled only when the code that decides it is not in git, such as a dependency's, and then it says so. Otherwise rewrite the risk with a quote of the place it rests on, or keep it as it is. ken marks a risk "Quotes code outside the change" when a file quote at the head commit holds no changed line, "Quotes only the changed lines" when every file quote holds one, and neither when it quotes no file. A dependency's code is not in git, so ken cannot read it.`,
		'2. Each pair of decisions that touch the same file, function, record, id or signal, such as one that writes or keeps a thing and one that deletes or skips it: what happens when both apply?',
		'3. Each early return, refusal, delete or catch in the changed lines: what no longer happens after it, and who relied on it?',
		'4. Which new behaviour has no test? And what does the change lean on outside the repository, such as a setting, a service or the way a dependency behaves? A risk that says something is missing, never called, or not tested carries absent, the text whose absence proves it; without absent, it must not make the claim.',
		'5. Each name below that no quote follows: read where it is used. Does the change still fit there?',
		"6. Each later fix below: what did this change leave open that the fix closed? Send it as a risk as of this change: quote the line of the fixing commit's message that says what was wrong, and say it has been fixed since, in which commit.",
		'',
		decisions.length === 0 ? 'Your reply shows no decisions.' : 'The decisions in your reply:',
		...decisions.map((d, at) => `${at + 1}. ${d.question} Chosen: ${d.chosen} Why: ${d.reason?.text ?? ''}`),
		'',
		'The risks you sent:',
		...risks.map((risk, at) => {
			const marks = [risk.weight, mark(risk.checked)].filter(Boolean)
			return `${at + 1}. ${marks.length > 0 ? `(${marks.join(', ')}) ` : ''}${risk.text}`
		}),
		'',
		...(notFollowed.length === 0
			? ['Every name ken found used elsewhere has a quote of your reply at one of its places.']
			: [`Names used elsewhere, at ${head}, that no quote of your reply follows:`, ...namesText(notFollowed)]),
		...(listed.length === 0 ? [] : ['', ...listed]),
		'',
		'Before you call revise_risks, write what you found in steps 2, 3, 4 and 6, one short line each: the two decisions, the line or the behaviour, and what happens. The reader sees these lines folded with your other working.',
		'Then call revise_risks once:',
		`- risks: each new risk, and each risk above that you rewrite, with replaces set to its number. A risk is one or two sentences: what can happen, who hits it (a host, an operator, a reader of results, a later developer) and when (always, on resume, only for runs made before this change, only under load). Quote the place it rests on, and give it its weight: ${WEIGHT_RULE}. A new risk that needs a rare case and costs little is left out, not sent as minor; ten risks is a sign of padding.`,
		`- withdraw: each risk above that the code shows does not happen, with what the code shows instead and, in quotes, the lines that show it: code at ${head}, or a line of a later commit's message.`,
		`- order: the numbers of all the risks you keep, the heaviest first, by who hits each and when. A risk above keeps its number; the risks you send are ${risks.length + 1}, ${risks.length + 2} and on, in the order you send them. A minor or speculative risk goes last.`,
	].join('\n')
}

export function reviseTool(gate: Gate, round: () => Round): Tool {
	return {
		name: 'revise_risks',
		description:
			'After ken asks you to check your risks: rewrite, add and withdraw risks, and put them in order. ken checks every quote as it checked the first risks, then shows the reader the risks you keep.',
		parameters: allowJsonText(REVISE_SCHEMA),
		async execute(args, ctx) {
			const current = round()
			const { scope } = current
			if (current.step !== 'risks' || !scope) return refuse('ken holds no risks for a second look now.')
			if (current.passRejections >= MAX_PASS_REJECTIONS) {
				return refuse('No attempts are left. Your first risks stand. Stop now.')
			}
			const read = readJsonText(REVISE_SCHEMA, args)
			if (read.kind === 'refused') return rejected(current, read.problems)
			const first = current.held
			const sent = optionalList(read.args.risks).map((raw) => {
				const { replaces, ...risk } = raw
				return { risk, replaces: readArgs(raw, 'revise_risks risk').optionalLine('replaces') }
			})
			const sourceProblems: string[] = []
			const asked = optionalList(read.args.withdraw).map((each) => {
				const item = readArgs(each, 'revise_risks withdraw')
				const quotes = optionalList(each.quotes).map((quote) => quoteOf(quote, sourceProblems))
				return { number: item.optionalLine('risk') ?? 0, reason: item.text('reason'), quotes }
			})
			const withdrawn = asked.filter(({ number }, at) => asked.findIndex((other) => other.number === number) === at)
			const given = read.args.order
			const order = Array.isArray(given) ? given.flatMap((n) => (typeof n === 'number' ? [n] : [])) : []
			const replaced = sent.map(({ replaces }) => replaces)
			const form =
				given === undefined && first.length + sent.length > 0
					? ['Send order: the numbers of all the risks you keep, the heaviest first.']
					: orderProblems(
							first.length,
							replaced,
							withdrawn.map(({ number }) => number),
							order,
						)
			const { head } = scope.range
			const proofForm = await proofProblems(gate.sources.repo, head, withdrawn, ctx.signal)
			if (form.length + sourceProblems.length + proofForm.length > 0) {
				return sentBack([...form, ...sourceProblems, ...proofForm])
			}
			const context = contextOf(gate, current)
			const problems: string[] = []
			const added: Risk[] = []
			for (const [at, { risk }] of sent.entries()) {
				const where = `Risk ${first.length + at + 1}`
				const draftProblems: string[] = []
				const draft = claimOf(risk, 'revise_risks risk', (quote) => quoteOf(quote, draftProblems))
				const checked =
					draftProblems.length > 0
						? { kind: 'refused' as const, problems: draftProblems }
						: await checkCard(context, { kind: 'risk', draft }, where, ctx.signal)
				if (checked.kind === 'refused') problems.push(...checked.problems)
				else if (checked.card.kind === 'risk') added.push(checked.card.risk)
			}
			const proved = await checkProof(gate.sources, withdrawn, ctx.signal)
			if (proved.kind === 'rejected') problems.push(...proved.problems)
			if (problems.length > 0 || proved.kind === 'rejected') return rejected(current, problems)
			const pick = (number: number) => (number <= first.length ? first[number - 1] : added[number - first.length - 1])
			const kept: Card[] = order.flatMap((number) => {
				const risk = pick(number)
				return risk ? [{ kind: 'risk', risk }] : []
			})
			const out: Card[] = proved.withdrawn.flatMap(({ number, reason, proof }) => {
				const risk = first[number - 1]
				return risk ? [{ kind: 'withdrawn', withdrawn: { risk, reason, proof } }] : []
			})
			current.pending.push(...kept, ...out)
			current.held = []
			return reply(
				`ken shows the reader ${kept.length} ${kept.length === 1 ? 'risk' : 'risks'}${out.length > 0 ? ` and ${out.length} withdrawn, each with the lines that rule it out` : ''}. Now tell the reader in a sentence or two what the second look found.`,
			)
		},
	}
}

function sentBack(problems: string[]) {
	return refuse(
		[
			'Revision sent back. This did not use one of your attempts. The reader has not seen the risks yet.',
			...problems.map((problem) => `- ${problem}`),
			'Fix this and call revise_risks again.',
		].join('\n'),
	)
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

// A revision's form, which the model fixes without reading code again: each risk sent first is kept in order,
// rewritten or withdrawn, once, and each risk it sends is in order.
function orderProblems(n: number, replaced: (number | undefined)[], withdrawn: number[], order: number[]): string[] {
	const problems: string[] = []
	const last = n + replaced.length
	for (const number of [...withdrawn, ...replaced.flatMap((each) => each ?? [])]) {
		if (number > n) problems.push(`You sent ${n} risks, so there is no risk ${number} to withdraw or rewrite.`)
	}
	for (const [at, number] of order.entries()) {
		if (number > last) problems.push(`order names risk ${number}, but the last risk is ${last}.`)
		if (order.indexOf(number) !== at) problems.push(`order names risk ${number} twice.`)
	}
	for (let number = 1; number <= n; number++) {
		const fates = [order.includes(number), withdrawn.includes(number), replaced.includes(number)]
		const count = fates.filter(Boolean).length
		if (count === 0) {
			problems.push(`Risk ${number} is not in order, not withdrawn and not rewritten. Give it one of the three.`)
		}
		if (count > 1) {
			problems.push(`Risk ${number} is given more than one of: in order, withdrawn, rewritten. Give it one.`)
		}
	}
	for (let number = n + 1; number <= last; number++) {
		if (!order.includes(number))
			problems.push(`The risk you send as number ${number} is not in order. Put it there, or leave it out.`)
	}
	return problems
}

function rejected(current: Round, problems: string[]) {
	current.passRejections += 1
	current.emit({ kind: 'step', step: { kind: 'sent-back', what: 'The second look', problems } })
	const tail =
		current.passRejections >= MAX_PASS_REJECTIONS
			? 'That was the last attempt, so your first risks stand as ken checked them. Stop now.'
			: 'Fix these and call revise_risks again. Copy each quote from read_file or diff output.'
	const head = `Revision refused, attempt ${current.passRejections} of ${MAX_PASS_REJECTIONS}. Your first risks are unchanged.`
	return refuse([head, ...problems.map((problem) => `- ${problem}`), tail].join('\n'))
}

const RISK = withoutDescriptions(RISK_SCHEMA)
const REVISE_SCHEMA = {
	type: 'object',
	properties: {
		risks: {
			type: 'array',
			description: 'New risks, and risks you sent rewritten, each with its quotes',
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
			description: 'Risks you sent that the code shows do not happen',
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
			description: 'The numbers of every risk you keep, the heaviest first',
			items: { type: 'integer', minimum: 1 },
		},
	},
	additionalProperties: false,
} as const
