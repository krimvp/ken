import type { Answer } from '../../agent/index.ts'
import { type Diagram, diagramElements } from '../../diagram/index.ts'
import type { Paint } from './print-question.ts'

type Quote = Answer['statements'][number]['quotes'][number]

// A diagram in the terminal: its title and label, then each element by number with the lines it rests on. The drawing
// itself is for the page; ken ask --json carries its Mermaid text.
export function formatDiagram(diagram: Diagram, paint: Paint): string[] {
	const kind = diagram.kind.replaceAll('-', ' ')
	const lines = [
		paint('bold', `Diagram: ${diagram.title}`) + paint('cyan', ` [${diagram.label}]`),
		paint('dim', `a ${kind} diagram`),
	]
	for (const element of diagramElements(diagram)) {
		const label = element.label === null ? '' : ` ${paint('cyan', `[${element.label}]`)}`
		lines.push(`${element.number}. ${element.text}${label}`)
		for (const quote of element.quotes) lines.push(...formatQuote(quote, paint))
	}
	return lines
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatQuote(quote: Quote, paint: Paint): string[] {
	const span =
		quote.startLine === quote.endLine ? `line ${quote.startLine}` : `lines ${quote.startLine}-${quote.endLine}`
	return [
		paint('dim', `   ${quoteSource(quote)}, ${span}`),
		...quote.text
			.split('\n')
			.map((text, offset) => `   ${paint('dim', String(quote.startLine + offset).padStart(5))}  ${text}`),
	]
}

// A quote of a session names no file and no commit: it says when the session ran and who wrote the lines.
export function quoteSource(quote: Quote): string {
	if ('session' in quote) {
		const at = new Date(quote.at)
		const day = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${quote.at.slice(11, 16)} UTC`
		return `from the session of ${day}, ${quote.by === 'user' ? 'what you asked' : 'what the agent said'}`
	}
	return quote.path === null
		? `commit message of ${quote.commit.slice(0, 7)}`
		: `${quote.path} @ ${quote.commit.slice(0, 7)}`
}
