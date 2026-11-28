import type { MapEntry, MapLine } from './map-entry.ts'
import type { TopicState } from './topic-state.ts'

// asked: a question named the topic. know: "I know this". too-much: "Too much". deeper: "Go deeper". forgot: "I do not
// know this any more", on the map's own page. toured: the reader reached the stop of a tour on the topic's part.
export const SIGNALS = ['asked', 'know', 'too-much', 'deeper', 'usual', 'forgot', 'toured'] as const
export type MapSignal = (typeof SIGNALS)[number]

// What a reply was, which decides what it teaches the map. answer: ken answered something asked of it, so every topic
// the reply names is marked as asked. tour: the briefs of a tour's stops, which the page marks as toured when the
// reader reaches each one. live-note: a note ken wrote by itself in live mode, which tells the map nothing.
export type ReplyKind = 'answer' | 'tour' | 'live-note'

type Line = Pick<MapEntry, 'depth' | 'evidence'>

type KnowledgeSignal = Exclude<MapSignal, 'too-much' | 'deeper' | 'usual'>

const SIGNAL_LINES: Record<KnowledgeSignal, (now: MapEntry | null) => Line | null> = {
	asked: (now) => (now === null ? { depth: 'heard-of', evidence: 'asked' } : null),
	know: (now) => ({ depth: now?.depth === 'could-change' ? 'could-change' : 'can-follow', evidence: 'said' }),
	forgot: () => ({ depth: 'heard-of', evidence: 'forgot' }),
	toured: (now) => (now === null ? { depth: 'heard-of', evidence: 'toured' } : null),
}

export function lineFor(signal: MapSignal, state: TopicState, now: Date): MapLine | null {
	const date = now.toISOString().slice(0, 10)
	if (signal === 'too-much' || signal === 'deeper' || signal === 'usual') {
		const shorter = signal === 'too-much'
		if (shorter === Boolean(state.shorterSince)) return null
		return { topic: state.topic, detail: shorter ? 'shorter' : 'usual', date }
	}
	const line = SIGNAL_LINES[signal](state.kind === 'never-met' ? null : state.entry)
	return line && { topic: state.topic, ...line, date, hash: state.hash }
}
