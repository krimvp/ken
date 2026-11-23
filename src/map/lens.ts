// The lenses of slice 4, each a thin layer over asking a question. ken writes the question from facts it has without a
// model: the topics whose code changed since the reader understood them, the work recorded since their last question,
// the topics in a part of the project. The first line is what the reader asked, in their voice. ken's list under it
// speaks to the reader as "you", since the page and the terminal show it to them. The line between tells the model who
// "you" is, and the page leaves it out.
import type { RecordRead } from '../record/index.ts'
import { linesText, type TopicState } from './topic-state.ts'

export const LIST_SAID = 'ken wrote the lines below from git, the project record and my map. In them, "you" means me.'

// What a lens reads from the reader's history: when each question was asked, at which HEAD, and what it recorded.
export type Asked = { askedAt: string; head: string | null; recorded?: string[] }

// Writes a map line's day in a sentence, such as "earlier today" or "on 16 Nov", as the page does.
export type DayWords = (date: string) => string

const MAX_LISTED_WORK = 10

// head is the project's HEAD now.
export function catchUpQuestion(facts: {
	states: TopicState[]
	record: RecordRead
	asked: Asked[]
	head: string | null
	day: DayWords
}): string {
	const { states, record, asked, head, day } = facts
	const last = asked.at(-1)
	// Work the reader's own questions recorded is work they have seen.
	const seen = asked.flatMap((each) => each.recorded ?? [])
	const changed = states.flatMap((state) =>
		(state.kind === 'changed' || state.kind === 'long-ago') && state.changed.length > 0
			? [
					`- You understood ${state.topic} ${day(state.entry.date)}, and its code changed since: ${state.changed.map(linesText).join(', ')}.`,
				]
			: [],
	)
	const work = record.current
		.flatMap((entry) => (entry.kind === 'work' ? [entry] : []))
		.filter((entry) => !seen.includes(entry.id) && (last === undefined || entry.at > last.askedAt))
		.slice(-MAX_LISTED_WORK)
		.map(
			(entry) =>
				`- Work recorded since your last question: "${entry.title}", ${entry.range.base.slice(0, 7)}..${entry.range.head.slice(0, 7)}.`,
		)
	const moved =
		last?.head && head && last.head !== head
			? [`- You asked your last question at ${last.head.slice(0, 7)}. The project is at ${head.slice(0, 7)} now.`]
			: []
	const list = [...changed, ...work, ...moved]
	return [
		'Catch me up: what differs from what I understood?',
		LIST_SAID,
		...(list.length > 0
			? list
			: ['- ken lists no topic you understood that changed, and no work recorded since your last question.']),
	].join('\n')
}

export function areaQuestion(area: string, states: TopicState[], record: RecordRead, day: DayWords): string {
	const inside = (path: string | null) => path !== null && (path === area || path.startsWith(`${area}/`))
	const topics = record.current.flatMap((entry) =>
		entry.kind === 'topic' && entry.quotes.some((quote) => inside(quote.path)) ? [entry.name] : [],
	)
	const listed = states.filter((state) => topics.includes(state.topic)).map((state) => `- ${areaLine(state, day)}.`)
	return [
		`What do I need to know to work in ${area} today?`,
		LIST_SAID,
		...(listed.length > 0 ? listed : [`- The record has no topic in ${area} yet.`]),
	].join('\n')
}

export function deeperQuestion(topics: string[], asked: string): string {
	return `Go one level deeper on ${topics.join(', ')} than your answer to "${asked}". I need more detail than it gave.`
}

function areaLine(state: TopicState, day: DayWords): string {
	switch (state.kind) {
		case 'never-met':
			return state.shorterSince
				? `You asked for shorter replies on ${state.topic}. Your familiarity is unknown`
				: `You have not met ${state.topic}`
		case 'met':
			return `You have met ${state.topic}. Your map has no confirmation that you understand it`
		case 'unchanged':
			return `You know ${state.topic}, unchanged since you understood it ${day(state.entry.date)}`
		case 'changed':
		case 'long-ago':
			return state.changed.length === 0
				? `You knew ${state.topic} ${day(state.entry.date)}, unchanged since`
				: `You knew ${state.topic} ${day(state.entry.date)}, and its code changed since`
		default:
			return state satisfies never
	}
}
