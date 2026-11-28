// What the reader's understanding map says about each box, and the one line on where to look next (plan: the layout
// is also the guide's home view). A topic sits in every box that holds a file it quotes. The map judges topics at
// HEAD, so the marks say what the reader knows of the code now, whatever commit the boxes show.
import type { Knows, TopicState } from '../../map/index.ts'
import { sameName, type Topic } from '../../record/index.ts'
import { under } from '../folder-split.ts'
import type { NextItem } from './next-items.ts'

// new: the reader never met the topic. met: they asked about it or read on it, and did not say they understand it.
// understood: they said so, or wrote it. changed: they understood it, and its code changed since.
export type Mark = 'new' | 'met' | 'understood' | 'changed'
export type BoxTopic = { topic: string; mark: Mark }

// Where a whole box stands for the reader, read from what ken thinks they know of it. changed: they said they know
// it, or a topic in it, and commits touched it since they looked. understood: they said they know it. open: they
// looked at it and have not said so. unmet: they never looked, and ken has topics there. none: they never looked, and
// ken knows no topic there. The box's line and the line over the level are both written from this, so they cannot
// disagree.
export type Standing = 'changed' | 'unmet' | 'open' | 'understood' | 'none'
export type BoxMap = { standing: Standing; line: string }

// The boxes of each standing that needs the reader, in the order of the boxes, the one line on where to look next,
// and the few things to look at next, the first one first.
export type Next = { changed: string[]; unmet: string[]; open: string[]; line: string; items: NextItem[] }

const SAID: Record<Standing, { box: string; level: (names: string, many: boolean) => string }> = {
	changed: {
		box: 'Code you understood here has changed since.',
		level: (names) => `Code you understood in ${names} has changed since. Look there first.`,
	},
	unmet: { box: 'You have not asked about this part yet.', level: (names) => `You have not asked about ${names} yet.` },
	open: {
		box: 'You looked at this part and have not said you understand all of it.',
		level: (names, many) => `You looked at ${names} and have not said you understand all of ${many ? 'them' : 'it'}.`,
	},
	understood: {
		box: 'You said you understand this part.',
		level: () => 'You said you understand every part here that ken has explained.',
	},
	none: { box: '', level: () => '' },
}

// With nothing to look at next, no box is at the level "new" and none is stale, so this is true of every such level.
const NOTHING_NEXT = 'Nothing here is new to you or changed since you looked.'

// The map's topics that sit in a box, each with its state for this reader.
export function topicsIn(
	paths: string[],
	topics: Pick<Topic, 'name' | 'quotes'>[],
	states: TopicState[],
): { topic: string; state: TopicState }[] {
	return topics.flatMap((topic) => {
		const quoted = topic.quotes.flatMap((quote) => quote.path ?? [])
		if (!quoted.some((file) => paths.some((place) => under(file, place)))) return []
		const state = states.find((each) => sameName(each.topic, topic.name))
		return state ? [{ topic: topic.name, state }] : []
	})
}

export function markOf(state: TopicState): Mark {
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

export function boxMap(knows: Knows, topics: BoxTopic[]): BoxMap {
	const standing = standingOf(knows, topics)
	return { standing, line: SAID[standing].box }
}

function standingOf({ level, stale }: Knows, topics: BoxTopic[]): Standing {
	if (level === 'new') return topics.length === 0 ? 'none' : 'unmet'
	if (stale && (level === 'said' || topics.some((topic) => topic.mark === 'changed'))) return 'changed'
	return level === 'said' ? 'understood' : 'open'
}

export function nextOf(boxes: { name: string; map: BoxMap }[], items: NextItem[]): Next {
	const named = (standing: Standing) => boxes.filter((box) => box.map.standing === standing).map((box) => box.name)
	const [changed, unmet, open] = [named('changed'), named('unmet'), named('open')]
	const said = (
		[
			['changed', changed],
			['unmet', unmet],
			['open', open],
		] as const
	).flatMap(([standing, list]) => (list.length === 0 ? [] : [SAID[standing].level(names(list), list.length > 1)]))
	const known = named('understood').length > 0 ? [SAID.understood.level('', false)] : []
	const line = [...(said.length > 0 ? said : known), ...(items.length === 0 ? [NOTHING_NEXT] : [])].join(' ')
	return { changed, unmet, open, line, items }
}

function names(list: string[]): string {
	return list.length === 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}
