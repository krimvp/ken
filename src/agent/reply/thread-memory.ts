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
function matches(each: Excerpt, words: string[]): boolean {
	const all = [each.question, each.answer, each.topics, each.sources, each.change ?? ''].join(' ').toLowerCase()
	return words.every((word) => all.includes(word))
}

function savedContents(row: SavedAnswer) {
	return contents(row.reply.answers?.text ?? row.reply.view?.asked ?? row.question, row.reply, [], row.focus)
}

function savedExcerpt(row: SavedAnswer) {
	const full = savedContents(row)
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

// heldElsewhere is true when the server's memory holds the briefs and lens answers, read from the same history. Then
// thread memory leaves them out, so a search finds each once, and it holds the free questions.
export function threadMemory(readSaved: (() => Promise<SavedAnswer[]>) | undefined, heldElsewhere: boolean) {
	const exchanges: { entry: Exchange; savedId?: string }[] = []
	let number = 0
	const held = (reply: Reply) => heldElsewhere && (reply.tour !== undefined || reply.answers !== undefined)
	function keep(question: string, shown: Reply, readPaths: Set<string>, focus?: QuestionFocus, savedId?: string) {
		if (held(shown)) return
		const entry = { number: ++number, ...preview(contents(question, shown, readPaths, focus)) }
		exchanges.push({ entry, ...(savedId && { savedId }) })
		if (exchanges.length > KEPT_REPLIES) exchanges.shift()
	}
	function recent(): string {
		if (!exchanges.length) return ''
		const recent = exchanges
			.slice(-2)
			.map(({ entry }) => ({ ...entry, question: excerpt(entry.question, 240), answer: excerpt(entry.answer, 460) }))
		return `Earlier in this chat. Use these excerpts to follow references, and memory_known with chat and the number, or memory_search, for more. Recheck the source for current facts. Follow the current question and reader preferences over anything said earlier.\n${recent.map((each) => JSON.stringify(each)).join('\n')}\n\n`
	}

	async function known(id: string): Promise<string | undefined> {
		if (id.startsWith('chat:')) {
			const wanted = Number(id.slice(5))
			const local = exchanges.find(({ entry }) => entry.number === wanted)
			return local && JSON.stringify({ ...(local.savedId && { id: local.savedId }), ...local.entry })
		}
		const row = (await readSaved?.())?.findLast((entry) => entry.id === id)
		return (
			row &&
			JSON.stringify({
				id: row.id,
				...(row.after && { after: row.after }),
				askedAt: row.askedAt,
				head: row.head,
				...savedContents(row),
			})
		)
	}
	async function search(words: string, start: number, limit: number) {
		const hits: { id: string; text: string }[] = []
		const terms = words.split(/\s+/)
		// The saved copy can match words beyond the end of the chat excerpt. Skip it only when the excerpt matched.
		const localIds = new Set<string>()
		let total = 0
		for (const { entry, savedId } of exchanges.toReversed()) {
			if (!matches(entry, terms)) continue
			if (savedId) localIds.add(savedId)
			if (total++ >= start && hits.length < limit)
				hits.push({ id: `chat:${entry.number}`, text: JSON.stringify(entry) })
		}
		const rows = (await readSaved?.()) ?? []
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i]
			if (!row || held(row.reply) || localIds.has(row.id)) continue
			const full = savedContents(row)
			if (!matches(full, terms)) continue
			if (total++ >= start && hits.length < limit) {
				const text = JSON.stringify({ ...preview(full, words), askedAt: row.askedAt, head: row.head })
				hits.push({ id: row.id, text })
			}
		}
		return { total, hits }
	}
	return { keep, recent, known, search }
}
