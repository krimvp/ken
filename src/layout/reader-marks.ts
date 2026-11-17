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

// What the map says of a whole box, from its topics. changed: code the reader understood there changed since. unmet:
// they asked about none of its topics. open: they met some and have not said they understand them all. understood:
// they said they understand every one. none: ken knows no topic there. The box's line and the line over the level are
// both written from this, so they cannot disagree.
export type Standing = 'changed' | 'unmet' | 'open' | 'understood' | 'none'
export type BoxMap = { standing: Standing; line: string }

// The boxes of each standing that needs the reader, in the order of the boxes, and the one line on where to look next.
export type Next = { changed: string[]; unmet: string[]; open: string[]; line: string }

const SAID: Record<Standing, { box: string; level: (names: string, many: boolean) => string }> = {
	changed: {
		box: 'Code you understood here has changed since.',
		level: (names) => `Code you understood in ${names} has changed since. Look there first.`,
	},
	unmet: { box: 'You have not asked about this part yet.', level: (names) => `You have not asked about ${names} yet.` },
	open: {
		box: 'You asked about this part and have not said you understand all of it.',
		level: (names, many) => `You asked about ${names} and have not said you understand all of ${many ? 'them' : 'it'}.`,
	},
	understood: {
		box: 'You said you understand this part.',
		level: () => 'You said you understand every part here that ken has explained.',
	},
	none: { box: '', level: () => '' },
}

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

export function boxMap(topics: BoxTopic[]): BoxMap {
	const standing = standingOf(topics)
	return { standing, line: SAID[standing].box }
}

function standingOf(topics: BoxTopic[]): Standing {
	if (topics.length === 0) return 'none'
	if (topics.some((t) => t.mark === 'changed')) return 'changed'
	if (topics.every((t) => t.mark === 'new')) return 'unmet'
	if (topics.every((t) => t.mark === 'understood')) return 'understood'
	return 'open'
}

export function nextOf(boxes: { name: string; map: BoxMap }[]): Next {
	const named = (standing: Standing) => boxes.filter((box) => box.map.standing === standing).map((box) => box.name)
	const [changed, unmet, open] = [named('changed'), named('unmet'), named('open')]
	const said = (
		[
			['changed', changed],
			['unmet', unmet],
			['open', open],
		] as const
	).flatMap(([standing, list]) => (list.length === 0 ? [] : [SAID[standing].level(names(list), list.length > 1)]))
	const line = said.length > 0 ? said.join(' ') : named('understood').length > 0 ? SAID.understood.level('', false) : ''
	return { changed, unmet, open, line }
}

function names(list: string[]): string {
	return list.length === 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}
