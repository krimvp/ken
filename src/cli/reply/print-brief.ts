import type { Card, Drawing, Item } from '../../agent/index.ts'
import { formatQuote } from './print-diagram.ts'
import type { Paint } from './print-reply.ts'

type Open = { number: number; points: number; terms: boolean; questions: string[] }

// A brief in the terminal, in the order the page shows it: its one line, its things to know by number, each with its
// drawing named and the lines it rests on, then its terms, then the questions worth asking. The items of a reply come
// one at a time, so the printer keeps the brief that is open and prints its questions when the next thing ends it.
// other prints an item that is no part of a brief.
export function briefPrinter(paint: Paint, other: (item: Item) => string) {
	let open: Open | null = null

	// The questions of the open brief, which closes it. Empty when none is open.
	function end(): string[] {
		const questions = open?.questions ?? []
		open = null
		if (questions.length === 0) return []
		return [paint('bold', '  Questions worth asking'), ...questions.map((question) => `    - ${question}`)]
	}

	function format(item: Item): string {
		if (item.kind === 'step' && item.questions) {
			const before = end()
			open = { number: item.number, points: 0, terms: false, questions: item.questions }
			return [...before, ...(before.length > 0 ? [''] : []), paint('bold', `Brief ${item.number}. ${item.text}`)].join(
				'\n',
			)
		}
		const mine = item.kind === 'card' && open !== null && item.step === open.number ? open : null
		const lines = mine && item.kind === 'card' ? cardLines(item.card, mine) : null
		if (lines) return lines.join('\n')
		// A thing to know that ken sent back and the model fixed comes after its brief closed. It prints alone.
		const late = item.kind === 'card' && item.step !== undefined && item.card.kind === 'claim' && item.card.claim.point
		if (late && item.kind === 'card') {
			const more = cardLines(item.card, null) ?? []
			return [...end(), paint('bold', `Brief ${item.step}, one more thing to know`), ...more].join('\n')
		}
		return [...end(), other(item)].join('\n')
	}

	// brief is the open brief the card belongs to, null for a thing to know that comes after its brief closed.
	function cardLines(card: Card, brief: Open | null): string[] | null {
		const quotes = (card.kind === 'claim' ? card.claim.quotes : card.kind === 'topic' ? card.topic.quotes : [])
			.flatMap((quote) => formatQuote(quote, paint))
			.map((line) => `  ${line}`)
		if (card.kind === 'claim' && card.claim.point) {
			const { line, long, drawing } = card.claim.point
			if (brief) brief.points += 1
			const drawn = drawingText(drawing)
			return [
				paint('bold', `  ${brief ? `${brief.points}.` : '-'} ${line}`),
				...(drawn ? [paint('dim', `     ${drawn}`)] : []),
				`     ${card.claim.text}`,
				...(long === card.claim.text ? [] : [`     ${long}`]),
				`     ${paint('green', '[checked]')}`,
				...quotes,
			]
		}
		if (card.kind !== 'topic' || !brief) return null
		const head = brief.terms ? [] : [paint('bold', '  Terms')]
		brief.terms = true
		return [...head, `    ${card.topic.name}: ${card.topic.note}`, ...quotes]
	}

	return { format, end: () => end().join('\n') }
}

// The page draws the drawing. The terminal names it, and says nothing for a dot, which shows nothing.
function drawingText({ kind, count, lit, label }: Drawing): string {
	if (kind === 'dot') return ''
	const parts = [
		`drawn as ${kind}`,
		...(count === undefined ? [] : [`${count} of them`]),
		...(lit === undefined ? [] : [`number ${lit} filled`]),
		...(label === undefined ? [] : [`"${label}"`]),
	]
	return parts.join(', ')
}
