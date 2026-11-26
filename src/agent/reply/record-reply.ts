// What a reply adds to the project record when its question ends: the piece of work it explains, with its claims,
// risks and diagrams, the decisions it showed, and its topics with a note each. It runs once, from what the reply
// holds, so a question stopped halfway records nothing, and asking again writes the same entries, which the record
// keeps once because ids hash content. The record checks each entry again, and one it refuses leaves out that entry
// and those that name it, never the rest.
//
// The draft rule lives here too. ken keeps snapshots of uncommitted work in its own store, which no collaborator has, so
// a reply that cites a commit the project's own git cannot find adds nothing to the project record. The reader's
// history keeps it, decisions and all.
import type { Quote, VerifiedQuote } from '../../checks/index.ts'
import { diagramDraft, layoutDraft, type Views, viewsDraft } from '../../diagram/index.ts'
import {
	type EntryDraft,
	type EntryId,
	type RecordEntry,
	type RecordStore,
	type Statement,
	sameName,
} from '../../record/index.ts'
import type { Range, Repository } from '../../repo/index.ts'
import { changeOf, quotesOf } from './check-card.ts'
import { firstWords, type Item, type Reply, type Tour } from './reply.ts'
import type { Gate, Round } from './show-tool.ts'

// Long enough for the story of a change, short enough for the record's limit on a summary.
const MAX_SUMMARY_CHARS = 1000
// The quotes of a stop's step that the topic of its part rests on.
const TOUR_QUOTES = 3

// problems says why the record refused the entries it left out.
export type Recorded =
	| { kind: 'recorded'; entries: RecordEntry[]; problems: string[] }
	| { kind: 'draft' }
	| { kind: 'refused'; problems: string[] }

// project reads the project's own git, never ken's snapshot store. scope is the change the reply is about, with the
// title of its piece of work when it has one. views is what the reply holds of the drawings of the top level.
export async function recordReply(
	store: RecordStore,
	project: Repository,
	items: Item[],
	scope: { range: Range; work: string | null } | null,
	tour: Tour | null,
	views: Views | null,
	signal: AbortSignal,
): Promise<Recorded> {
	const cards = items.flatMap((item) => (item.kind === 'card' ? [item.card] : []))
	const named = cards.flatMap((card) => (card.kind === 'layout' ? [card.layout.drawnAt] : []))
	const commits = new Set([
		...quotesOf(items).map((quote) => quote.commit),
		...(scope ? [scope.range.head] : []),
		...named,
	])
	for (const commit of commits) {
		if ((await project.resolve(commit, signal)).kind !== 'ok') return { kind: 'draft' }
	}
	const claim = (s: Statement) => ({ text: s.text, label: s.label, quotes: s.quotes.map(raw) })
	const claims = cards.flatMap((card) => (card.kind === 'claim' ? [claim(card.claim)] : []))
	const risks = cards.flatMap((card) => (card.kind === 'risk' ? [claim(card.risk)] : []))
	const diagrams = cards.flatMap((card) => (card.kind === 'diagram' ? [diagramDraft(card.diagram)] : []))
	const pending: RecordEntry[] = []
	const drafts: EntryDraft[] = []
	const problems: string[] = []
	const add = async (where: string, draft: EntryDraft) => {
		const checked = await store.check(draft, pending, signal)
		if (checked.kind === 'refused') {
			problems.push(...checked.problems.map((problem) => `${where}: ${problem}`))
			return null
		}
		pending.push(checked.entry)
		drafts.push(draft)
		return checked.entry
	}

	const range = scope?.range
	// A range that already has a piece of work keeps it, so asking about the same change twice does not split it in two.
	const kept = range
		? ((await store.read()).current.find(
				(entry) => entry.kind === 'work' && entry.range.base === range.base && entry.range.head === range.head,
			)?.id ?? null)
		: null
	let work: EntryId | null = kept
	if (scope?.work && range && !kept && claims.length > 0) {
		const entry = await add('Work', {
			kind: 'work',
			title: scope.work,
			summary: firstWords(items, MAX_SUMMARY_CHARS) || (claims[0]?.text ?? ''),
			range,
			statements: claims,
			...(risks.length === 0 ? {} : { risks }),
			diagrams,
		})
		work = entry?.id ?? null
	}
	// Topics go first, so a decision can name a topic this reply adds.
	for (const card of cards) {
		if (card.kind !== 'topic') continue
		const { name, quotes, note, replaces } = card.topic
		const where = `Topic "${name}"`
		const entry = await add(where, { kind: 'topic', name, quotes: quotes.map(raw), replaces: replaces ?? undefined })
		if (entry) await add(`${where}, its note`, { kind: 'note', topic: entry.id, text: note })
	}
	// Each stop of a tour is the topic of its part, resting on the lines its step quotes, so the map can follow it. A
	// part the record already has as a topic keeps that topic.
	for (const [k, stop] of (tour?.stops ?? []).entries()) {
		const known = [...(await store.read()).current, ...pending].some(
			(entry) => entry.kind === 'topic' && sameName(entry.name, stop.name),
		)
		const quotes = quotesOf(items.filter((item) => item.kind === 'card' && item.step === k + 1))
			.filter(({ path }) => path !== null && stop.paths.some((place) => path === place || path.startsWith(`${place}/`)))
			.slice(0, TOUR_QUOTES)
		if (known || quotes.length === 0) continue
		await add(`Topic "${stop.name}"`, { kind: 'topic', name: stop.name, quotes: quotes.map(raw) })
	}
	for (const card of cards) {
		if (card.kind !== 'decision') continue
		const { decision } = card
		await add(`Decision "${decision.question}"`, {
			kind: 'decision',
			question: decision.question,
			chosen: decision.chosen,
			reason: decision.reason && { text: decision.reason.text, quotes: decision.reason.quotes.map(raw) },
			rejected: decision.rejected,
			undo: decision.undo,
			needsOwner: decision.needsOwner,
			quotes: decision.quotes.map(raw),
			work,
			topic: decision.topic ?? undefined,
			...(decision.absent && { absent: decision.absent }),
		})
	}
	// A new level of the same paths replaces the one before. The record keeps both, so an old commit can still use it.
	// The drawings go with the last top level the reply names, else with the one the record holds, as a new version.
	const isTop = (card: (typeof cards)[number]) => card.kind === 'layout' && card.layout.within.length === 0
	const lastTop = cards.findLast(isTop)
	const drawings = views && { views: viewsDraft(views) }
	const sameLevel = async (within: string[]) =>
		[...(await store.read()).current, ...pending].findLast(
			(entry) => entry.kind === 'layout' && entry.within.join('\n') === within.join('\n'),
		)
	for (const card of cards) {
		if (card.kind !== 'layout') continue
		const before = await sameLevel(card.layout.within)
		const kept = card === lastTop ? drawings : {}
		await add('The layout', { kind: 'layout', ...layoutDraft(card.layout), ...kept, replaces: before?.id })
	}
	if (drawings && !lastTop) {
		const before = await sameLevel([])
		if (before?.kind === 'layout') {
			await add('The drawings', { kind: 'layout', ...layoutDraft(before), ...drawings, replaces: before.id })
		} else problems.push('The drawings: the record has no named parts of the project to keep them with.')
	}
	if (drafts.length === 0) return { kind: 'recorded', entries: [], problems }
	const appended = await store.append(drafts, signal)
	if (appended.kind === 'refused') return appended
	const entries = appended.entries.filter((each) => each.written).map((each) => each.entry)
	return { kind: 'recorded', entries, problems }
}

function raw(quote: VerifiedQuote): Quote {
	if ('session' in quote) return { session: quote.session, text: quote.text }
	return { path: quote.path, commit: quote.commit, text: quote.text, line: quote.startLine }
}

// The end of a question with a reply: the change facts from git over every quote the reader saw, the record entries
// the reply adds, and the topics it names, marked as asked on the reader's map. withTopics is false when the
// reply's topics stay in the reader's history and out of the record (see readerWords in start-chat.ts). problems says why the record
// left out an entry; the reply stands either way.
export async function endReply(
	gate: Gate,
	round: Round,
	withTopics: boolean,
	signal: AbortSignal,
): Promise<{ reply: Reply; recorded: RecordEntry[]; problems: string[] }> {
	const { scope } = round
	const change = scope && (await changeOf(gate.sources.repo, scope.range, round.items, signal))
	const kept = withTopics
		? round.items
		: round.items.filter((item) => item.kind !== 'card' || item.card.kind !== 'topic')
	const recorded = await recordReply(gate.store, gate.project, kept, scope, round.tour, round.views, signal)
	// Each card names a topic the record holds as the record spells it.
	const names = (await gate.store.read()).current.flatMap((entry) => (entry.kind === 'topic' ? [entry.name] : []))
	const canonical = (name: string) => names.find((other) => sameName(other, name)) ?? name
	const items = round.items.map((item) => spelled(item, canonical))
	const stops = (round.tour?.stops ?? []).map((stop) => canonical(stop.name)).filter((name) => names.includes(name))
	const topics = [...new Set([...stops, ...items.flatMap(topicsOf)])]
	if (round.asked) await gate.map?.learn('asked', topics, new Date(), signal)
	return {
		reply: {
			items,
			change,
			topics,
			...(round.tour ? { tour: round.tour } : {}),
			...(round.view ? { view: { within: round.view.within, asked: round.view.text } } : {}),
			...(round.want ? { want: round.want } : {}),
			...(round.answers ? { answers: round.answers } : {}),
		},
		recorded: recorded.kind === 'recorded' ? recorded.entries : [],
		problems: recorded.kind === 'draft' ? [] : recorded.problems,
	}
}

function spelled(item: Item, canonical: (name: string) => string): Item {
	if (item.kind !== 'card') return item
	const { card } = item
	const named = <T extends { topic?: string | null }>(each: T): T =>
		each.topic ? { ...each, topic: canonical(each.topic) } : each
	switch (card.kind) {
		case 'claim':
			return { ...item, card: { kind: 'claim', claim: named(card.claim) } }
		case 'risk':
			return { ...item, card: { kind: 'risk', risk: named(card.risk) } }
		case 'decision':
			return { ...item, card: { kind: 'decision', decision: named(card.decision) } }
		case 'topic':
			return { ...item, card: { kind: 'topic', topic: { ...card.topic, name: canonical(card.topic.name) } } }
		default:
			return item
	}
}

function topicsOf(item: Item): string[] {
	if (item.kind !== 'card') return []
	const { card } = item
	switch (card.kind) {
		case 'claim':
			return card.claim.topic ? [card.claim.topic] : []
		case 'risk':
			return card.risk.topic ? [card.risk.topic] : []
		case 'decision':
			return card.decision.topic ? [card.decision.topic] : []
		case 'topic':
			return [card.topic.name]
		case 'diagram':
		case 'layout':
		case 'withdrawn':
			return []
		default:
			return card satisfies never
	}
}
