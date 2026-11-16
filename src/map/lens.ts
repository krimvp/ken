// The lenses of slice 4, each a thin layer over asking a question. ken writes the question from facts it has without a
// model: the topics whose code changed since the reader understood them, the work recorded since their last question,
// the topics in a part of the project. The first line is what the reader asked; the lines under it are ken's list,
// which the page and the terminal show before the agent explains it.
import type { RecordRead } from '../record/index.ts'
import { linesText, type TopicState } from './topic-state.ts'

// What a lens reads from the reader's history: when each question was asked, at which HEAD, and what it recorded.
export type Asked = { askedAt: string; head: string | null; recorded?: string[] }

const MAX_LISTED_WORK = 10

// head is the project's HEAD now.
export function catchUpQuestion(facts: {
	states: TopicState[]
	record: RecordRead
	asked: Asked[]
	head: string | null
}): string {
	const { states, record, asked, head } = facts
	const last = asked.at(-1)
	// Work the reader's own questions recorded is work they have seen.
	const seen = asked.flatMap((each) => each.recorded ?? [])
	const changed = states.flatMap((state) =>
		(state.kind === 'changed' || state.kind === 'long-ago') && state.changed.length > 0
			? [
					`- ${state.topic}: I understood it on ${state.entry.date}, and its code changed since: ${state.changed.map(linesText).join(', ')}`,
				]
			: [],
	)
	const work = record.current
		.flatMap((entry) => (entry.kind === 'work' ? [entry] : []))
		.filter((entry) => !seen.includes(entry.id) && (last === undefined || entry.at > last.askedAt))
		.slice(-MAX_LISTED_WORK)
		.map(
			(entry) =>
				`- Work recorded since my last question: "${entry.title}", ${entry.range.base.slice(0, 7)}..${entry.range.head.slice(0, 7)}`,
		)
	const moved =
		last?.head && head && last.head !== head
			? [`- My last question was asked at ${last.head.slice(0, 7)}. The project is at ${head.slice(0, 7)} now.`]
			: []
	const list = [...changed, ...work, ...moved]
	return [
		'Catch me up: what differs from what I understood?',
		...(list.length > 0
			? list
			: ['- ken lists no topic I understood that changed, and no work recorded since my last question.']),
	].join('\n')
}

export function areaQuestion(area: string, states: TopicState[], record: RecordRead): string {
	const inside = (path: string | null) => path !== null && (path === area || path.startsWith(`${area}/`))
	const topics = record.current.flatMap((entry) =>
		entry.kind === 'topic' && entry.quotes.some((quote) => inside(quote.path)) ? [entry.name] : [],
	)
	const listed = states.filter((state) => topics.includes(state.topic)).map((state) => `- ${areaLine(state)}`)
	return [
		`What do I need to know to work in ${area} today?`,
		...(listed.length > 0 ? listed : [`- The record has no topic in ${area} yet.`]),
	].join('\n')
}

export function deeperQuestion(topics: string[], asked: string): string {
	return `Go one level deeper on ${topics.join(', ')} than your answer to "${asked}". I need more detail than it gave.`
}

function areaLine(state: TopicState): string {
	switch (state.kind) {
		case 'never-met':
			return `${state.topic}: I never met it`
		case 'met':
			return `${state.topic}: I asked about it, and do not know it yet`
		case 'unchanged':
			return `${state.topic}: I know it, unchanged since ${state.entry.date}`
		case 'changed':
		case 'long-ago':
			return state.changed.length === 0
				? `${state.topic}: I knew it on ${state.entry.date}, unchanged since`
				: `${state.topic}: I knew it on ${state.entry.date}, and its code changed since`
		default:
			return state satisfies never
	}
}
