import { styleText } from 'node:util'
import type { Answer, ChatEvent, Revision, Risk } from '../../agent/index.ts'
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
				if (event.revision) line(`\n${revisionLine(event.revision)}`)
				if (event.recorded.length > 0) {
					line(paint('bold', `\nAdded to the project record (${event.recorded.length}):`))
					for (const entry of event.recorded) line(`  ${entryLine(entry)}`)
				}
				break
			case 'usage': {
				const { riskPass } = event
				const pass = riskPass
					? `, of which the second look at risks took ${riskPass.inputTokens} in, ${riskPass.outputTokens} out, ${riskPass.seconds} s`
					: ''
				line(paint('dim', `\n${event.inputTokens} tokens in, ${event.outputTokens} out, ${event.seconds} s${pass}`))
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

// The order of the page: the summary, the diagrams, the decisions, the risks, then the other statements. entries are
// the record entries the answer stands on, or a draft's decisions, which the record does not hold.
export function formatAnswer(answer: Answer, entries: Entry[], paint: Paint): string {
	const lines = [paint('bold', answer.summary), '']
	for (const diagram of answer.diagrams) lines.push(...formatDiagram(diagram, paint), '')
	const decisions = entries.flatMap((entry) => (entry.kind === 'decision' ? [entry] : []))
	if (decisions.length > 0) {
		lines.push(paint('bold', `Decisions (${decisions.length}):`))
		for (const [index, d] of decisions.entries()) {
			lines.push(`${index + 1}. ${d.question} ${paint('cyan', `[${d.label}]`)}`, `   Chosen: ${d.chosen}`)
			if (d.reason)
				lines.push(`   Why: ${d.reason.text}`, ...d.reason.quotes.flatMap((quote) => formatQuote(quote, paint)))
		}
		lines.push('')
	}
	if (answer.risks?.length === 0) lines.push(paint('bold', "Risks: ken's model looked and found none."), '')
	if (answer.risks?.length)
		lines.push(paint('bold', `Risks (${answer.risks.length}):`), ...claims(answer.risks, paint), '')
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

function revisionLine({ added, withdrawn }: Revision): string {
	const changes = [
		added.risks > 0 ? `added ${added.risks === 1 ? '1 risk' : `${added.risks} risks`}` : '',
		added.decisions > 0 ? `added ${added.decisions === 1 ? '1 decision' : `${added.decisions} decisions`}` : '',
		withdrawn.length > 0 ? `withdrew ${withdrawn.length === 1 ? '1 risk' : `${withdrawn.length} risks`}` : '',
	].filter((part) => part !== '')
	if (changes.length === 0) return 'A second look at risks found nothing to change.'
	return `A second look at risks ${changes.join(', ')}. The last risks and decisions above came from it.`
}

// A risk carries ken's own mark of whether it was checked past the diff; a statement, and an older risk, has none.
const CHECKED = { true: 'Checked in the code', false: 'Not checked outside the change' } as const

function claims(list: Risk[], paint: Paint): string[] {
	return list.flatMap((claim, index) => [
		`${index + 1}. ${claim.text} ${paint('cyan', `[${claim.label}]`)}${claim.checked === undefined ? '' : ` ${paint('cyan', `[${CHECKED[`${claim.checked}`]}]`)}`}`,
		...claim.quotes.flatMap((quote) => formatQuote(quote, paint)),
	])
}
