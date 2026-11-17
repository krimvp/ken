// What the reader's understanding map says about each box, and the one line on where to look next (plan: the layout
// is also the guide's home view). A topic sits in every box that holds a file it quotes. The map judges topics at
// HEAD, so the marks say what the reader knows of the code now, whatever commit the boxes show.
import type { TopicState } from '../map/index.ts'
import { sameName, type Topic } from '../record/index.ts'
import { under } from './folder-split.ts'

// new: the reader never met the topic. met: they asked about it or read on it, and did not say they understand it.
// understood: they said so, or wrote it. changed: they understood it, and its code changed since.
export type Mark = 'new' | 'met' | 'understood' | 'changed'
export type BoxTopic = { topic: string; mark: Mark }

// changed names the boxes with a topic the reader understood whose code changed since, unmet the boxes whose topics
// the reader has never met, each in the order of the boxes.
export type Next = { changed: string[]; unmet: string[]; line: string }

export function boxTopics(paths: string[], topics: Topic[], states: TopicState[]): BoxTopic[] {
	return topics.flatMap((topic) => {
		const quoted = topic.quotes.flatMap((quote) => quote.path ?? [])
		if (!quoted.some((file) => paths.some((place) => under(file, place)))) return []
		const state = states.find((each) => sameName(each.topic, topic.name))
		return state ? [{ topic: topic.name, mark: markOf(state) }] : []
	})
}

function markOf(state: TopicState): Mark {
	switch (state.kind) {
		case 'never-met':
			return 'new'
		case 'met':
			return 'met'
		case 'unchanged':
			return 'understood'
		case 'changed':
			return 'changed'
		case 'long-ago':
			return state.changed.length > 0 ? 'changed' : 'understood'
		default:
			return state satisfies never
	}
}

export function nextOf(boxes: { name: string; topics: BoxTopic[] }[]): Next {
	const changed = boxes.filter((box) => box.topics.some((t) => t.mark === 'changed')).map((box) => box.name)
	const unmet = boxes
		.filter((box) => box.topics.length > 0 && box.topics.every((t) => t.mark === 'new'))
		.map((box) => box.name)
	const anyTopic = boxes.some((box) => box.topics.length > 0)
	return { changed, unmet, line: nextLine(changed, unmet, anyTopic) }
}

function nextLine(changed: string[], unmet: string[], anyTopic: boolean): string {
	if (!anyTopic)
		return 'ken knows no topic in these boxes yet. Ask about a part, and the topics ken explains show on its box.'
	if (changed.length === 0 && unmet.length === 0) {
		return 'Nothing you understood here has changed, and you have asked about every box that has topics.'
	}
	const said: string[] = []
	if (changed.length > 0) said.push(`Code you understood in ${names(changed)} has changed since. Look there first.`)
	if (unmet.length > 0) {
		said.push(`You have not asked about the topics in ${names(unmet)} yet.`)
	}
	return said.join(' ')
}

function names(list: string[]): string {
	return list.length === 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}
