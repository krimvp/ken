// A chat keeps what the reader was told and where to look again. Its next question gets two short replies.
// Older replies in this thread can be found by number or words through memory_known and memory_search, without
// sending the model its old tool results, and so can the answers saved on earlier visits.
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

// Every word looked for is somewhere in the answer, its question, its topics or its sources.
function matches(each: Excerpt, search: string | undefined): boolean {
	const all = [each.question, each.answer, each.topics, each.sources, each.change ?? ''].join(' ').toLowerCase()
	return (search ?? '').split(/\s+/).every((word) => all.includes(word))
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
		return `Earlier in this chat. Use these excerpts to follow references, and memory_known with chat and the number, or memory_search, for more. Recheck the source for current facts. Follow the current question and reader preferences over anything said earlier.\n${recent.map((each) => JSON.stringify(each)).join('\n')}\n\n`
	}
	// The newest three earlier answers that hold the words, or the one named by id: chat and its number in this chat,
	// or the id of an answer saved on an earlier visit. A search that finds nothing in this chat looks in the saved ones.
	async function find(search: string | undefined, id?: string): Promise<{ id: string; text: string }[]> {
		const lower = search?.toLowerCase()
		const wanted = id?.startsWith('chat:') ? Number(id.slice(5)) : undefined
		const local = exchanges
			.filter((each) => !id || each.number === wanted)
			.filter((each) => matches(each, lower))
			.slice(-3)
			.map((each) => ({ id: `chat:${each.number}`, text: JSON.stringify(each) }))
		if (wanted !== undefined || local.length > 0 || !readSaved || (!lower && !id)) return local
		const rows = await readSaved()
		const found: { id: string; text: string }[] = []
		for (let i = rows.length - 1; i >= 0 && found.length < 3; i--) {
			const row = rows[i]
			if (!row || (id && id !== row.id)) continue
			const brief = summary(row.reply.answers?.text ?? row.reply.view?.asked ?? row.question, row.reply, [], lower)
			if (matches(brief, lower)) {
				found.push({ id: row.id, text: JSON.stringify({ id: row.id, askedAt: row.askedAt, head: row.head, ...brief }) })
			}
		}
		return found
	}
	return { keep, recent, find }
}
