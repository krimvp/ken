import { styleText } from 'node:util'
import type { Card, ChatEvent, Cost, Reply, Risk } from '../../agent/index.ts'
import { when } from '../../follow-up/index.ts'
import { type Decision, entryLine } from '../../record/index.ts'
import { formatDiagram, formatQuote } from './print-diagram.ts'

export type Paint = (format: Parameters<typeof styleText>[0], text: string) => string

// Said once, at the top of a chat, so no card has to say it again.
export const LEGEND = "Plain text is what ken's model says. A part marked [checked] is what ken checked against git."

// Prints one question's events as they arrive: the model's working steps dim, then its reply, words and cards in the
// order it gave them. Colour only reaches a terminal: styleText leaves it out for a pipe.
export async function printQuestion(events: AsyncIterable<ChatEvent>, out: NodeJS.WriteStream): Promise<boolean> {
	const paint: Paint = (format, text) => styleText(format, text, { stream: out })
	let answered = false
	const line = (text: string) => out.write(`${text}\n`)
	for await (const event of events) {
		switch (event.kind) {
			case 'text':
				break
			case 'tool':
				line(paint('dim', `  ${event.step}`))
				break
			case 'step':
				if (event.step.kind === 'sent-back') {
					line(paint('yellow', `  ken sent back ${event.step.what}:`))
					for (const problem of event.step.problems)
						line(paint('yellow', `    - ${problem.replaceAll('\n', '\n      ')}`))
				} else if (event.step.kind === 'text') line(paint('dim', `  ${event.step.text.replaceAll('\n', '\n  ')}`))
				break
			case 'item':
				line(`\n${event.item.kind === 'words' ? event.item.text : formatCard(event.item.card, paint)}`)
				break
			case 'replied':
				if (event.reply.change) line(`\n${formatChange(event.reply.change, paint)}`)
				if (event.recorded.length > 0) {
					line(paint('bold', `\nAdded to the project record (${event.recorded.length}):`))
					for (const entry of event.recorded) line(`  ${entryLine(entry)}`)
				}
				break
			case 'usage': {
				const look = event.secondLook ? `, of which the second look at risks took ${costLine(event.secondLook)}` : ''
				line(paint('dim', `\n${costLine(event)}${look}`))
				break
			}
			case 'done':
				answered = event.outcome === 'answered'
				if (event.outcome === 'no-answer') line(paint('red', "ken's model stopped without a reply."))
				if (event.outcome === 'out-of-turns') {
					line(paint('red', "ken's model was still reading when it ran out of turns, so it has no reply."))
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

// A whole reply, as a live note prints it.
export function formatReply(reply: Reply, paint: Paint): string {
	const parts = reply.items.map((item) => (item.kind === 'words' ? item.text : formatCard(item.card, paint)))
	return [...parts, ...(reply.change ? [formatChange(reply.change, paint)] : [])].join('\n\n')
}

export function formatCard(card: Card, paint: Paint): string {
	const checked = paint('green', '[checked]')
	switch (card.kind) {
		case 'claim':
			return [
				`${checked} ${card.claim.text} ${paint('cyan', `[${card.claim.label}]`)}`,
				...evidence(card.claim, paint),
			].join('\n')
		case 'risk':
			return [`${checked} Risk: ${card.risk.text}${riskMarks(card.risk, paint)}`, ...evidence(card.risk, paint)].join(
				'\n',
			)
		case 'decision':
			return [`${checked} Decision: ${decisionLines(card.decision, paint).join('\n')}`].join('\n')
		case 'diagram':
			return [checked, ...formatDiagram(card.diagram, paint)].join('\n')
		case 'topic':
			return [
				`${checked} Topic: ${card.topic.name}`,
				paint('dim', `   ${card.topic.note}`),
				...card.topic.quotes.flatMap((quote) => formatQuote(quote, paint)),
			].join('\n')
		case 'withdrawn': {
			const { risk, reason, proof } = card.withdrawn
			return [
				`${checked} Withdrawn by the second look: ${risk.text}`,
				`   Ruled out: ${reason}`,
				...proof.flatMap((quote) => formatQuote(quote, paint)),
			].join('\n')
		}
		default:
			return card satisfies never
	}
}

// What the reply's quotes cover of the change, from git.
function formatChange(change: NonNullable<Reply['change']>, paint: Paint): string {
	const { commits, covered, uncovered } = change
	const lines = [paint('bold', `Commits in scope, from git (${commits.length}):`)]
	for (const commit of commits) {
		lines.push(`  ${commit.hash.slice(0, 7)} ${when(commit.date)} ${commit.author}: ${commit.subject}`)
	}
	const total = covered.length + uncovered.length
	lines.push(paint('dim', `The cards quote ${covered.length} of ${total} changed hunks.`))
	return lines.join('\n')
}

function costLine(cost: Cost): string {
	return `${cost.inputTokens} tokens in, ${cost.outputTokens} out, ${cost.seconds} s`
}

// A risk carries ken's marks from git and, beside them, the model's weight, when it has them.
const CHECKED = { true: 'Quotes code outside the change', false: 'Quotes only the changed lines' } as const

function riskMarks(risk: Risk, paint: Paint): string {
	const marks = [
		risk.weight === undefined ? '' : `${risk.weight}, by ken's model`,
		risk.fixedIn === undefined ? '' : `Fixed since, in ${risk.fixedIn.slice(0, 7)}`,
		risk.unreviewed ? 'No second look: shown as ken first checked it' : '',
		risk.checked === undefined ? '' : CHECKED[`${risk.checked}`],
		risk.label,
	].filter((mark) => mark !== '')
	return marks.map((mark) => ` ${paint('cyan', `[${mark}]`)}`).join('')
}

function evidence(claim: Risk, paint: Paint): string[] {
	return [...searchedLine(claim.absent, paint), ...claim.quotes.flatMap((quote) => formatQuote(quote, paint))]
}

function decisionLines(d: Decision, paint: Paint): string[] {
	return [
		`${d.needsOwner ? `${paint('yellow', '[your call]')} ` : ''}${d.question} ${paint('cyan', `[${d.label}]`)}`,
		`   Chosen: ${d.chosen}`,
		...(d.reason ? [`   Why: ${d.reason.text}`, ...d.reason.quotes.flatMap((quote) => formatQuote(quote, paint))] : []),
		...d.quotes.flatMap((quote) => formatQuote(quote, paint)),
		...searchedLine(d.absent, paint),
	]
}

// ken's own search for what a card says is missing. A card that says nothing is missing has none.
function searchedLine(absent: Risk['absent'], paint: Paint): string[] {
	if (absent === undefined) return []
	const under = absent.under === null ? '' : ` under \`${absent.under}\``
	return [
		paint('dim', `   ken searched for \`${absent.text}\`${under} at ${absent.commit.slice(0, 7)} and found nothing.`),
	]
}
