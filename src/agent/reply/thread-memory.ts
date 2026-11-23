// A chat keeps what the reader was told and where to look again. Its next question gets two short replies.
// Older replies in this thread can be found by number or words through memory_known and memory_search, without
// sending the model its old tool results, and so can the answers saved on earlier visits.
import { quotesOf, unverifiedSource } from './check-card.ts'
import type { Item, Reply } from './reply.ts'
import type { QuestionFocus } from './show-tool.ts'

const KEPT_REPLIES = 40
export type SavedAnswer = {
	id: string
	askedAt: string
	after?: string | null
	head: string | null
	question: string
	reply: Reply
	focus?: QuestionFocus
}
type Excerpt = { question: string; answer: string; topics: string; sources: string; change?: string }
type Exchange = Excerpt & { number: number }

function excerpt(text: string, chars: number, search?: string): string {
	let line = text.replaceAll(/\s+/g, ' ').trim()
	if (search) {
		const lower = line.toLowerCase()
		const match = search.split(/\s+/).reduce((last, word) => Math.max(last, lower.indexOf(word)), -1)
		if (match >= chars - search.length && match > 48) line = `...${line.slice(match - 48)}`
	}
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

function contents(question: string, shown: Reply, readPaths: Iterable<string>, focus?: QuestionFocus): Excerpt {
	const quoted = quotesOf(shown.items).map((quote) =>
		quote.path ? `${quote.path}:${quote.startLine}@${quote.commit}` : quote.commit,
	)
	const source = focus && 'path' in focus ? `${focus.path}:${focus.start}-${focus.end}@${focus.commit}` : null
	if (source && unverifiedSource(focus, shown.items)) {
		return {
			question,
			answer: 'The reply had no checked source. Read the open lines before using it.',
			topics: '',
			sources: source,
		}
	}
	return {
		question,
		answer: [
			...(shown.missingParts ? [`Still to cover: ${shown.missingParts.join(', ')}.`] : []),
			...shown.items.map(words),
		].join(' '),
		topics: shown.topics.join(', '),
		sources: [...new Set([...(source ? [source] : []), ...quoted, ...readPaths])].join(', '),
		...(shown.change && { change: `${shown.change.base}..${shown.change.head}` }),
	}
}

function preview(full: Excerpt, search?: string): Excerpt {
	return {
		...full,
		question: excerpt(full.question, 600, search),
		answer: excerpt(full.answer, 2400, search),
		topics: excerpt(full.topics, 240, search),
		sources: excerpt(full.sources, 600, search),
	}
}

// Every word looked for is somewhere in the answer, its question, its topics or its sources.
function matches(each: Excerpt, search: string | undefined): boolean {
	const all = [each.question, each.answer, each.topics, each.sources, each.change ?? ''].join(' ').toLowerCase()
	return (search ?? '').split(/\s+/).every((word) => all.includes(word))
}

function savedExcerpt(row: SavedAnswer) {
	const full = contents(row.reply.answers?.text ?? row.reply.view?.asked ?? row.question, row.reply, [], row.focus)
	return {
		id: row.id,
		...(row.after && { after: row.after }),
		head: row.head,
		...preview(full),
		question: excerpt(full.question, 240),
		answer: excerpt(full.answer, 460),
	}
}

// A chosen reply and its parent give a follow-up its subject, even after ken restarts.
export function savedOpening(selected: SavedAnswer, parent?: SavedAnswer): string {
	const replies = parent ? [parent, selected] : [selected]
	return `The reader is following up on the last saved reply below. Use memory_known with an id for the full reply or its after id for the preceding reply. Recheck the source for current facts and follow what the reader asks now.\n${replies.map((row) => JSON.stringify(savedExcerpt(row))).join('\n')}\n\n`
}

export function threadMemory(readSaved?: () => Promise<SavedAnswer[]>) {
	const exchanges: Exchange[] = []
	let number = 0
	function keep(question: string, shown: Reply, readPaths: Set<string>, focus?: QuestionFocus) {
		exchanges.push({ number: ++number, ...preview(contents(question, shown, readPaths, focus)) })
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
			const full = contents(row.reply.answers?.text ?? row.reply.view?.asked ?? row.question, row.reply, [], row.focus)
			if (id || matches(full, lower)) {
				const brief = id ? full : preview(full, lower)
				found.push({
					id: row.id,
					text: JSON.stringify({
						id: row.id,
						...(row.after && { after: row.after }),
						askedAt: row.askedAt,
						head: row.head,
						...brief,
					}),
				})
			}
		}
		return found
	}
	return { keep, recent, find }
}
