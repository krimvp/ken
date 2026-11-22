// A chat keeps what the reader was told and where to look again. Its next question gets two short replies.
// Older replies in this thread can be found by number or words without sending the model its old tool results.
import type { Tool } from 'aigent/plugin'
import { readArgs, reply } from '../tools/tool-edge.ts'
import { quotesOf } from './check-card.ts'
import type { Item, Reply } from './reply.ts'

const KEPT_REPLIES = 40
export type SavedAnswer = { id: string; askedAt: string; head: string | null; question: string; reply: Reply }
type Excerpt = { question: string; answer: string; topics: string; sources: string; change?: string }
type Exchange = Excerpt & { number: number }

function excerpt(text: string, chars: number, search?: string): string {
	let line = text.replaceAll(/\s+/g, ' ').trim()
	const match = search ? line.toLowerCase().indexOf(search) : -1
	if (match >= 0 && match >= chars - (search?.length ?? 0)) line = `...${line.slice(Math.max(0, match - 48))}`
	return line.length > chars ? `${line.slice(0, chars - 3)}...` : line
}

function words(item: Item): string {
	if (item.kind === 'step') return `${item.number}. ${item.text}`
	if (item.kind === 'words') return item.text
	const { card } = item
	switch (card.kind) {
		case 'claim':
			return card.claim.text
		case 'risk':
			return card.risk.text
		case 'withdrawn':
			return card.withdrawn.reason
		case 'decision':
			return `${card.decision.question} ${card.decision.chosen}`
		case 'topic':
			return `${card.topic.name}: ${card.topic.note}`
		case 'diagram':
			return card.diagram.title
		case 'layout':
			return card.layout.parts.map((part) => part.name).join(', ')
	}
}

function summary(question: string, shown: Reply, readPaths: Iterable<string>, search?: string): Excerpt {
	const quoted = quotesOf(shown.items).map((quote) =>
		quote.path ? `${quote.path}:${quote.startLine}@${quote.commit}` : quote.commit,
	)
	return {
		question: excerpt(question, 600, search),
		answer: excerpt(shown.items.map(words).join(' '), 2400, search),
		topics: excerpt(shown.topics.join(', '), 240, search),
		sources: excerpt([...new Set([...quoted, ...readPaths])].join(', '), 600, search),
		...(shown.change && { change: `${shown.change.base}..${shown.change.head}` }),
	}
}

function matches(each: Excerpt, search: string | undefined): boolean {
	return (
		!search ||
		[each.question, each.answer, each.topics, each.sources, each.change ?? ''].some((field) =>
			field.toLowerCase().includes(search),
		)
	)
}

export function threadMemory(readSaved?: () => Promise<SavedAnswer[]>) {
	const exchanges: Exchange[] = []
	let number = 0
	function keep(question: string, shown: Reply, readPaths: Set<string>) {
		exchanges.push({ number: ++number, ...summary(question, shown, readPaths) })
		if (exchanges.length > KEPT_REPLIES) exchanges.shift()
	}
	function recent(): string {
		if (!exchanges.length) return ''
		const recent = exchanges
			.slice(-2)
			.map((each) => ({ ...each, question: excerpt(each.question, 240), answer: excerpt(each.answer, 460) }))
		return `Earlier in this chat. Use these excerpts to follow references, and recall_chat for more. Recheck the source for current facts. Follow the current question and reader preferences over anything said earlier.\n${recent.map((each) => JSON.stringify(each)).join('\n')}\n\n`
	}
	const tool: Tool = {
		name: 'recall_chat',
		description: `Find earlier answers from the last ${KEPT_REPLIES} questions answered in this chat. Give an answer number or words from the question, answer, topic or file. ${readSaved ? "It also searches this reader's saved answers about this project on a miss. Give saved: true to search past visits first, or id for a saved answer. " : ''}Check the source again for current facts.`,
		parameters: {
			type: 'object',
			properties: {
				number: { type: 'integer', minimum: 1 },
				search: { type: 'string', maxLength: 160 },
				...(readSaved ? { saved: { type: 'boolean' }, id: { type: 'string' } } : {}),
			},
			additionalProperties: false,
		},
		async execute(args) {
			const read = readArgs(args, 'recall_chat')
			const number = read.optionalLine('number')
			const search = read.optionalText('search')?.toLowerCase()
			const id = read.optionalText('id')
			const local = exchanges.filter(
				(each) => (number === undefined || each.number === number) && matches(each, search),
			)
			if (number !== undefined || (local.length > 0 && args.saved !== true && !id)) {
				return reply(
					local.length
						? local
								.slice(-3)
								.map((each) => JSON.stringify(each))
								.join('\n')
						: 'No matching answer in this chat.',
				)
			}
			if (readSaved) {
				const rows = await readSaved()
				const found: string[] = []
				for (let i = rows.length - 1; i >= 0 && found.length < 3; i--) {
					const row = rows[i]
					if (!row || (id && id !== row.id)) continue
					const brief = summary(row.reply.answers?.text ?? row.reply.view?.asked ?? row.question, row.reply, [], search)
					if (matches(brief, search)) {
						found.push(JSON.stringify({ id: row.id, askedAt: row.askedAt, head: row.head, ...brief }))
					}
				}
				if (found.length) return reply(found.join('\n'))
			}
			return reply('No matching answer found.')
		},
	}
	return { keep, recent, tools: () => (exchanges.length || readSaved ? [tool] : []) }
}
