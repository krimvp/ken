// What each signal from the reader adds to the map, as the plan lists them: a question, and the three buttons under an
// answer. A signal writes a new line and never edits one, so the newest line says what the reader showed last.
import type { Depth, MapEntry } from './map-entry.ts'
import type { TopicState } from './topic-state.ts'

// asked: a question named the topic. know: "I know this". too-much: "Too much". deeper: "Go deeper".
export const SIGNALS = ['asked', 'know', 'too-much', 'deeper'] as const
export type MapSignal = (typeof SIGNALS)[number]

type Line = Pick<MapEntry, 'depth' | 'evidence'>

// A question marks only a topic the reader never met: asking again says nothing new. "I know this" says the reader
// understands the code as it is now. "Too much" says the answer went deeper than the reader needed, so ken counts them
// one step further on, which makes the next answer shorter; it is not understanding. "Go deeper" keeps the depth and
// drops the understanding, so the next answer on the topic explains again.
const SIGNAL_LINES: Record<MapSignal, (now: MapEntry | null) => Line | null> = {
	asked: (now) => (now === null ? { depth: 'heard-of', evidence: 'asked' } : null),
	know: (now) => ({ depth: now?.depth === 'could-change' ? 'could-change' : 'can-follow', evidence: 'said' }),
	'too-much': (now) => ({ depth: stepUp(now?.depth ?? 'heard-of'), evidence: 'read' }),
	deeper: (now) => ({ depth: now?.depth ?? 'heard-of', evidence: 'asked' }),
}

export function lineFor(signal: MapSignal, state: TopicState, now: Date): MapEntry | null {
	const line = SIGNAL_LINES[signal](state.kind === 'never-met' ? null : state.entry)
	return line && { topic: state.topic, ...line, date: now.toISOString().slice(0, 10), hash: state.hash }
}

function stepUp(depth: Depth): Depth {
	return depth === 'heard-of' ? 'can-follow' : 'could-change'
}
