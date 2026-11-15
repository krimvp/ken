import { styleText } from 'node:util'
import type { Answer, ChatEvent } from '../agent/index.ts'
import { entryLine } from '../record/index.ts'
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
				line(paint('dim', `  ${event.name} ${event.summary}`))
				break
			case 'rejected':
				line(paint('yellow', `Answer ${event.attempt} was rejected:`))
				for (const problem of event.problems) line(`  - ${problem.replaceAll('\n', '\n    ')}`)
				break
			case 'accepted':
				line(`\n${formatAnswer(event.answer, paint)}`)
				if (event.recorded.length > 0) {
					line(paint('bold', `\nAdded to the project record (${event.recorded.length}):`))
					for (const entry of event.recorded) line(`  ${entryLine(entry)}`)
				}
				break
			case 'usage':
				line(paint('dim', `\n${event.inputTokens} tokens in, ${event.outputTokens} out, ${event.seconds} s`))
				break
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

export function formatAnswer(answer: Answer, paint: Paint): string {
	const lines = [paint('bold', answer.summary), '']
	for (const diagram of answer.diagrams) lines.push(...formatDiagram(diagram, paint), '')
	for (const [index, statement] of answer.statements.entries()) {
		lines.push(`${index + 1}. ${statement.text} ${paint('cyan', `[${statement.label}]`)}`)
		for (const quote of statement.quotes) lines.push(...formatQuote(quote, paint))
	}
	if (answer.change) {
		const { commits, covered, uncovered, binary } = answer.change
		lines.push('', paint('bold', `Commits in scope, from git (${commits.length}):`))
		for (const commit of commits) {
			lines.push(`  ${commit.hash.slice(0, 7)} ${commit.date.slice(0, 10)} ${commit.author}: ${commit.subject}`)
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
	}
	return lines.join('\n')
}
