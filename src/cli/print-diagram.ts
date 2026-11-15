import type { Answer } from '../agent/index.ts'
import { type Diagram, diagramElements, mermaidText } from '../diagram/index.ts'
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

export function formatQuote(quote: Quote, paint: Paint): string[] {
	const span =
		quote.startLine === quote.endLine ? `line ${quote.startLine}` : `lines ${quote.startLine}-${quote.endLine}`
	return [
		paint('dim', `   ${quote.path} @ ${quote.commit.slice(0, 7)}, ${span}`),
		...quote.text
			.split('\n')
			.map((text, offset) => `   ${paint('dim', String(quote.startLine + offset).padStart(5))}  ${text}`),
	]
}

// For ken ask --json: each diagram as data, with the Mermaid text that draws it.
export function withMermaid(answer: Answer): Answer & { diagrams: (Diagram & { mermaid: string })[] } {
	return { ...answer, diagrams: answer.diagrams.map((diagram) => ({ ...diagram, mermaid: mermaidText(diagram) })) }
}
