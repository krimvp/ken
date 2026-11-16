import { styleText } from 'node:util'
import type { Answer, ChatEvent, Cost, Revision, Risk } from '../../agent/index.ts'
import { when } from '../../follow-up/index.ts'
import { type Entry, entryLine } from '../../record/index.ts'
import { formatDiagram, formatQuote } from './print-diagram.ts'

export type Paint = (format: Parameters<typeof styleText>[0], text: string) => string

// Prints one question's events as they arrive. Colour only reaches a terminal: styleText leaves it out for a pipe.
export async function printQuestion(events: AsyncIterable<ChatEvent>, out: NodeJS.WriteStream): Promise<boolean> {
	const paint: Paint = (format, text) => styleText(format, text, { stream: out })
	let answered = false
	let midLine = false
	const line = (text: string) => {
		out.write(`${midLine ? '\n' : ''}${text}\n`)
		midLine = false
	}
	for await (const event of events) {
		switch (event.kind) {
			case 'text':
				out.write(event.delta)
				midLine = !event.delta.endsWith('\n')
				break
			case 'tool':
				line(paint('dim', `  ${event.step}`))
				break
			case 'rejected':
				line(paint('yellow', `Answer ${event.attempt} was rejected:`))
				for (const problem of event.problems) line(`  - ${problem.replaceAll('\n', '\n    ')}`)
				break
			case 'accepted':
				line(`\n${formatAnswer(event.answer, event.recorded, paint)}`)
				if (event.revision) line(`\n${revisionLine(event.revision, event.answer.withdrawn?.length ?? 0)}`)
				if (event.recorded.length > 0) {
					line(paint('bold', `\nAdded to the project record (${event.recorded.length}):`))
					for (const entry of event.recorded) line(`  ${entryLine(entry)}`)
				}
				break
			case 'usage': {
				const steps: [string, Cost | null][] = [
					['turning the draft into the answer', event.fromDraft],
					['the second look at risks', event.riskPass],
				]
				const parts = steps.flatMap(([name, cost]) => (cost ? [`${name} took ${costLine(cost)}`] : []))
				const of = parts.length === 0 ? '' : `, of which ${parts.join(' and ')}`
				line(paint('dim', `\n${costLine(event)}${of}`))
				break
			}
			case 'done':
				answered = event.outcome === 'answered'
				if (event.outcome === 'rejected') {
					line(paint('red', 'ken could not produce a checked answer: every answer the model sent failed the checks.'))
				}
				if (event.outcome === 'no-answer') line(paint('red', 'The model stopped without sending a checked answer.'))
				if (event.outcome === 'out-of-turns') {
					line(paint('red', `The model was still exploring when it ran out of turns, so there is no checked answer.`))
				}
				break
			case 'error':
				line(paint('red', `Error: ${event.message}`))
				break
			default:
				event satisfies never
		}
	}
	return answered
}

// The order of the page: the summary, the diagrams, the decisions, the risks, then the other statements. An answer about
// a change whose risks the model weighed leads, as on the page, with its risks in their order, heaviest first, each
// with its weight, and the decisions that need the reader's call; a terminal cannot fold, so the rest follows under one
// line each with its count. entries are the record entries the answer stands on, or a draft's decisions, which the
// record does not hold.
export function formatAnswer(answer: Answer, entries: Entry[], paint: Paint): string {
	const lines = [paint('bold', answer.summary), '']
	const leftOut = answer.leftOut ?? 0
	if (leftOut > 0) {
		const said =
			leftOut === 1
				? '1 point of the draft had no line to quote and was'
				: `${leftOut} points of the draft had no line to quote and were`
		lines.push(paint('dim', `${said} left out.`), '')
	}
	const withdrawn = answer.withdrawn ?? []
	if (withdrawn.length > 0) {
		lines.push(paint('bold', `${withdrawnLine(withdrawn.length)}:`))
		for (const [index, { risk, reason, proof }] of withdrawn.entries()) {
			const weight = risk.weight === undefined ? '' : ` ${paint('cyan', `[${risk.weight}, by ken's model]`)}`
			lines.push(`${index + 1}. ${risk.text}${weight}`, `   Ruled out: ${reason}`)
			for (const quote of proof) lines.push(...formatQuote(quote, paint))
		}
		lines.push('')
	}
	for (const diagram of answer.diagrams) lines.push(...formatDiagram(diagram, paint), '')
	const decisions = entries.flatMap((entry) => (entry.kind === 'decision' ? [entry] : []))
	// Open risks first, then those a later commit fixed, each in the answer's order.
	const all = answer.risks ?? []
	const open = all.filter((risk) => risk.fixedIn === undefined)
	const risks = [...open, ...all.filter((risk) => risk.fixedIn !== undefined)]
	const fixed = risks.length - open.length
	const marks = [
		...(fixed > 0
			? [
					paint(
						'dim',
						'Open risks come first. A risk marked Fixed since quotes the message of a later commit that fixed it, and comes last.',
					),
				]
			: []),
		...(risks.some((risk) => risk.checked !== undefined)
			? [paint('dim', 'ken checks where the quote is, not whether the risk is true.')]
			: []),
	]
	const weighed = answer.change !== null && risks.some((risk) => risk.weight !== undefined)
	if (weighed) {
		const calls = decisions.filter((d) => d.needsOwner)
		const others = decisions.filter((d) => !d.needsOwner)
		const weight = paint(
			'dim',
			"ken's model weighs each risk. Serious: someone who uses the code in the normal way loses work, gets a wrong result or a failure, or finds refused what worked before. Minor: it needs a rare case or costs little.",
		)
		if (risks.length === 0) lines.push(paint('bold', "Risks: ken's model looked and found none."), '')
		else
			lines.push(
				paint(
					'bold',
					fixed > 0 ? `${risks.length} risks, ${fixed} fixed since:` : `Risks, heaviest first (${risks.length}):`,
				),
				weight,
				...claims(risks, paint),
				...marks,
				'',
			)
		if (calls.length > 0)
			lines.push(paint('bold', `Decisions that need your call (${calls.length}):`), ...decisionLines(calls, paint), '')
		if (others.length > 0) {
			const head = calls.length === 0 ? 'Decisions' : 'Other decisions'
			lines.push(paint('bold', `${head} (${others.length}):`), ...decisionLines(others, paint), '')
		}
	} else {
		if (decisions.length > 0)
			lines.push(paint('bold', `Decisions (${decisions.length}):`), ...decisionLines(decisions, paint), '')
		if (answer.risks?.length === 0) lines.push(paint('bold', "Risks: ken's model looked and found none."), '')
		if (risks.length > 0) {
			const head = fixed > 0 ? `${risks.length} risks, ${fixed} fixed since:` : `Risks (${risks.length}):`
			lines.push(paint('bold', head), ...claims(risks, paint), ...marks, '')
		}
	}
	const said = answer.change ? 'What the change did' : 'Statements'
	lines.push(paint('bold', `${said} (${answer.statements.length}):`), ...claims(answer.statements, paint))
	const fromSessions = [
		...[...answer.statements, ...(answer.risks ?? [])].flatMap((claim) => claim.quotes),
		...decisions.flatMap((d) => [...(d.reason?.quotes ?? []), ...d.quotes]),
	].filter((quote) => 'session' in quote).length
	if (fromSessions > 0) {
		lines.push(
			'',
			paint('bold', `Quotes from saved sessions: ${fromSessions}.`),
			'  ken found these lines in the saved session. It did not check that they give the true reason.',
		)
	}
	if (answer.change) {
		const { commits, covered, uncovered, binary } = answer.change
		if (commits.length > 0) lines.push('', paint('bold', `Commits in scope, from git (${commits.length}):`))
		for (const commit of commits) {
			lines.push(`  ${commit.hash.slice(0, 7)} ${when(commit.date)} ${commit.author}: ${commit.subject}`)
		}
		const total = covered.length + uncovered.length
		lines.push('', paint('bold', `Not covered by a quote (${uncovered.length} of ${total} changed hunks):`))
		for (const { path, oldPath, hunk } of uncovered) {
			const [file, start, length, what] =
				hunk.newLength === 0
					? [oldPath, hunk.oldStart, hunk.oldLength, 'removed']
					: [path, hunk.newStart, hunk.newLength, hunk.oldLength === 0 ? 'added' : 'changed']
			const span = length === 1 ? `line ${start}` : `lines ${start}-${start + length - 1}`
			lines.push(`  - ${file}, ${span} ${what}`)
		}
		if (uncovered.length === 0) lines.push('  none')
		for (const path of binary) lines.push(`  - ${path}, a binary file`)
		const { messages } = answer.change
		if (messages) {
			const total = messages.quoted.length + messages.unquoted.length
			const left = messages.unquoted.length === 0 ? '' : ' Not quoted:'
			lines.push('', paint('bold', `Commit messages quoted: ${messages.quoted.length} of ${total}.${left}`))
			const subjects = new Map(commits.map((commit) => [commit.hash, commit.subject]))
			for (const hash of messages.unquoted) lines.push(`  - ${hash.slice(0, 7)} ${subjects.get(hash) ?? ''}`)
		}
		const { usedElsewhere } = answer.change
		if (usedElsewhere) {
			const total = usedElsewhere.followed.length + usedElsewhere.notFollowed.length
			const head = `Names used elsewhere, found by search, that no quote follows: ${usedElsewhere.notFollowed.length} of ${total}.`
			lines.push('', paint('bold', head))
			for (const { name, places, first } of usedElsewhere.notFollowed) {
				const at = first.slice(0, 2).map((site) => `${site.path}:${site.line}`)
				lines.push(
					`  - ${name}, at ${places === 1 ? '1 place' : `${places} places`}: ${at.join(', ')}${places > at.length ? ', ...' : ''}`,
				)
			}
		}
	}
	return lines.join('\n')
}

function costLine(cost: Cost): string {
	return `${cost.inputTokens} tokens in, ${cost.outputTokens} out, ${cost.seconds} s`
}

// The same words as the page's line, so the reader meets one name for it.
function withdrawnLine(n: number): string {
	return n === 1
		? '1 risk withdrawn by the second look, with the line that rules it out'
		: `${n} risks withdrawn by the second look, each with the line that rules it out`
}

function revisionLine({ risks, decisions }: Revision, withdrawn: number): string {
	const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)
	const numbers = (kind: 'added' | 'rewritten') => risks.flatMap((risk, at) => (risk.kind === kind ? [at + 1] : []))
	const [added, rewritten] = [numbers('added'), numbers('rewritten')]
	const changes = [
		added.length > 0 ? `added ${count(added.length, 'risk')} (number ${added.join(', ')})` : '',
		rewritten.length > 0 ? `rewrote ${count(rewritten.length, 'risk')} (number ${rewritten.join(', ')})` : '',
		decisions > 0 ? `added ${count(decisions, 'decision')}, the last above` : '',
		withdrawn > 0 ? `withdrew ${count(withdrawn, 'risk')}, listed above` : '',
	].filter((part) => part !== '')
	const kept = risks.flatMap((risk) => (risk.kind === 'added' ? [] : [risk.was]))
	const moved = kept.some((was, at) => at > 0 && was < (kept[at - 1] ?? 0))
	if (changes.length === 0 && !moved) return 'A second look at risks found nothing to change.'
	const order = moved ? ' It put the risks in a new order, the heaviest first.' : ''
	return `A second look at risks ${changes.length === 0 ? 'changed nothing in them' : changes.join(', ')}.${order}`
}

// A risk carries ken's own mark of whether a quote lies outside the change; a statement, and an older risk, has none.
const CHECKED = { true: 'Quotes code outside the change', false: 'Quotes only the changed lines' } as const

function decisionLines(decisions: Extract<Entry, { kind: 'decision' }>[], paint: Paint): string[] {
	return decisions.flatMap((d, index) => [
		`${index + 1}. ${d.needsOwner ? `${paint('yellow', '[your call]')} ` : ''}${d.question} ${paint('cyan', `[${d.label}]`)}`,
		`   Chosen: ${d.chosen}`,
		...(d.reason ? [`   Why: ${d.reason.text}`, ...d.reason.quotes.flatMap((quote) => formatQuote(quote, paint))] : []),
		...searchedLine(d.absent, paint),
	])
}

type Absence = NonNullable<Answer['statements'][number]['absent']>

// ken's own search for what an entry says is missing. An entry that says nothing is missing has none.
function searchedLine(absent: Absence | undefined, paint: Paint): string[] {
	if (absent === undefined) return []
	const under = absent.under === null ? '' : ` under \`${absent.under}\``
	return [
		paint('dim', `   ken searched for \`${absent.text}\`${under} at ${absent.commit.slice(0, 7)} and found nothing.`),
	]
}

// A risk shows ken's mark and, beside it, the model's weight, when it has them.
function claims(list: Risk[], paint: Paint): string[] {
	return list.flatMap((claim, index) => [
		`${index + 1}. ${claim.text} ${paint('cyan', `[${claim.label}]`)}${claim.fixedIn === undefined ? '' : ` ${paint('cyan', `[Fixed since, in ${claim.fixedIn.slice(0, 7)}]`)}`}${claim.checked === undefined ? '' : ` ${paint('cyan', `[${CHECKED[`${claim.checked}`]}]`)}`}${claim.weight === undefined ? '' : ` ${paint('cyan', `[${claim.weight}, by ken's model]`)}`}`,
		...searchedLine(claim.absent, paint),
		...claim.quotes.flatMap((quote) => formatQuote(quote, paint)),
	])
}
