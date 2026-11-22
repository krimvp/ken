// A brief's point line may hold BRIEF_BOUNDS.lineWords words and a term's meaning BRIEF_BOUNDS.meansWords. No schema
// can count words, so the model sometimes sends one too long, and sending the brief back made the model resend the
// whole conversation to fix one line. ken counts the words itself and asks for the shorter line in a small request of
// its own: the line, its limit, what it says in full and the lines it quotes. A line that still does not fit goes
// back to the model as before.
import type { JsonObject, JsonValue } from 'aigent/plugin'
import { BRIEF_BOUNDS, wordCount } from './brief.ts'

export type TooLong = { text: string; most: number; whole: string; quotes: string[] }

// Returns the shorter texts in the order asked, or null for one the request did not give.
export type Shorten = (lines: TooLong[], signal: AbortSignal) => Promise<(string | null)[]>

export const SHORTEN_PROMPT =
	'You shorten lines that ken shows a developer about their own code. Each line has more words than its limit. Write each again as one whole sentence in at most its limit of words. Keep what it says, and say only what its quoted lines show: cut words, never add a fact. Use short, literal words. Reply with a JSON list of the new lines, in the order given, and nothing else.'

export function shortenQuestion(lines: TooLong[]): string {
	return lines
		.map((line, at) =>
			[
				`${at + 1}. At most ${line.most} words. The line: ${JSON.stringify(line.text)}`,
				...(line.whole === '' ? [] : [`It says in full: ${JSON.stringify(line.whole)}`]),
				...line.quotes.map((quote) => `Quoted lines:\n${quote}`),
			].join('\n'),
		)
		.join('\n\n')
}

// The texts of a reply to shortenQuestion, in order. A reply that is not a list of texts gives none.
export function shortened(reply: string, count: number): (string | null)[] {
	const start = reply.indexOf('[')
	const end = reply.lastIndexOf(']')
	let parsed: unknown = null
	try {
		parsed = start === -1 ? null : JSON.parse(reply.slice(start, end + 1))
	} catch {}
	const texts = Array.isArray(parsed) ? parsed : []
	return Array.from({ length: count }, (_, at) => {
		const text = texts[at]
		return typeof text === 'string' && text.trim() !== '' ? text.trim() : null
	})
}

// The brief as the model sent it, with each line that was too long and now fits put in its place. said names each
// line ken shortened, for the model's result.
export async function shortenBrief(
	brief: JsonObject,
	shorten: Shorten,
	signal: AbortSignal,
): Promise<{ brief: JsonObject; said: string[] }> {
	const points = objects(brief.points)
	const terms = objects(brief.terms)
	const asks: { at: { list: 'points' | 'terms'; index: number; field: 'line' | 'means' }; line: TooLong }[] = []
	for (const [index, point] of points.entries()) {
		const line = text(point.line)
		if (wordCount(line) <= BRIEF_BOUNDS.lineWords) continue
		const quotes = objects(point.quotes).map((quote) => text(quote.text))
		const at = { list: 'points' as const, index, field: 'line' as const }
		asks.push({ at, line: { text: line, most: BRIEF_BOUNDS.lineWords, whole: text(point.more), quotes } })
	}
	for (const [index, term] of terms.entries()) {
		const means = text(term.means)
		if (wordCount(means) <= BRIEF_BOUNDS.meansWords) continue
		const quote = isObject(term.quote) ? [text(term.quote.text)] : []
		const at = { list: 'terms' as const, index, field: 'means' as const }
		asks.push({ at, line: { text: means, most: BRIEF_BOUNDS.meansWords, whole: '', quotes: quote } })
	}
	if (asks.length === 0) return { brief, said: [] }
	const answers = await shorten(
		asks.map((ask) => ask.line),
		signal,
	)
	const lists = { points: [...points], terms: [...terms] }
	const said: string[] = []
	for (const [k, { at, line }] of asks.entries()) {
		const answer = answers[k]
		if (!answer || wordCount(answer) > line.most) continue
		const list = lists[at.list]
		const one = list[at.index]
		if (!one) continue
		list[at.index] = { ...one, [at.field]: answer }
		const what = at.list === 'points' ? `the line of Point ${at.index + 1}` : `the meaning of Term ${at.index + 1}`
		said.push(`ken cut ${what} to ${line.most} words or fewer: ${JSON.stringify(answer)}`)
	}
	return { brief: { ...brief, points: lists.points, terms: lists.terms }, said }
}

function objects(value: JsonValue | undefined): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : []
}

function text(value: JsonValue | undefined): string {
	return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
