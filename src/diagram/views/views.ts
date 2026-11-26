// Two more drawings of the top level of a project, named by ken's model and kept on the level's layout entry. "In its
// world": the people and outside systems the project deals with, and what crosses between them. "Where it runs": the
// places code runs (frames, which nest), the parts, stores and outside systems in them, the crossings between those,
// and the gaps where the repository says nothing. Every item rests on quoted lines, except a gap, which says what is not
// there. Items name each other by an id the model gives, and one id names one thing across both drawings.
import type { VerifiedGitQuote } from '../../checks/index.ts'

export const OUTSIDE_KINDS = ['person', 'system'] as const
export const HOWS = ['http', 'https', 'grpc', 'sql', 'event', 'file', 'process', 'library', 'other'] as const
export const DIRECTIONS = ['in', 'out', 'both'] as const
export const FRAME_KINDS = [
	'browser',
	'machine',
	'cluster',
	'process',
	'container',
	'thread',
	'vm',
	'sandbox',
	'function',
	'other',
] as const
export const STORE_KINDS = ['database', 'cache', 'queue', 'bus', 'files', 'other'] as const
export const THING_KINDS = ['part', 'store', 'outside'] as const
export const CROSSING_KINDS = ['call', 'event'] as const

export type OutsideKind = (typeof OUTSIDE_KINDS)[number]
export type How = (typeof HOWS)[number]
export type Direction = (typeof DIRECTIONS)[number]
export type FrameKind = (typeof FRAME_KINDS)[number]
export type StoreKind = (typeof STORE_KINDS)[number]

type Q = VerifiedGitQuote

// direction is said from the project: "in" comes from the outside thing, "out" goes to it.
export type Outside = { id: string; kind: OutsideKind; name: string; line: string; quotes: Q[] }
export type WorldCrossing = { id: string; outside: string; text: string; how: How; direction: Direction; quotes: Q[] }
export type World = { outside: Outside[]; crossings: WorldCrossing[] }

// in is the frame it sits in, null at the top. copies is there only when a line of the repository gives the number.
export type Frame = {
	id: string
	kind: FrameKind
	name: string
	line: string
	in: string | null
	copies: { count: number; quote: Q } | null
	quotes: Q[]
}

// A part is named as the level names it, and sits in one frame: a drawing shows each name once. An outside thing
// places an outside system of "In its world" in this drawing: its id is that system's id, and it rests on that
// system's lines.
export type Thing =
	| { id: string; kind: 'part'; part: string; frame: string | null; quotes: Q[] }
	| {
			id: string
			kind: 'store'
			store: StoreKind
			name: string
			line: string
			topics: string[]
			frame: string | null
			quotes: Q[]
	  }
	| { id: string; kind: 'outside'; frame: string | null }

// A call waits for its answer; an event is picked up later. quotes holds the lines on each side where the repository
// has them, at least one in all.
export type Crossing = {
	id: string
	from: string
	to: string
	text: string
	quotes: { from: Q[]; to: Q[] }
} & ({ kind: 'call'; how: How } | { kind: 'event'; topic: string })

export type Gap = { id: string; on: string; text: string }

export type Runtime = { frames: Frame[]; things: Thing[]; crossings: Crossing[]; gaps: Gap[] }

// A drawing is null when nothing of it passed the check.
export type Views = { world: World | null; runtime: Runtime | null }

export const VIEWS_BOUNDS = {
	outside: 10,
	worldCrossings: 12,
	frames: 12,
	things: 30,
	crossings: 20,
	gaps: 10,
	quotes: 3,
	topics: 12,
	id: 40,
	name: 40,
	line: 120,
	text: 40,
	topic: 60,
	gap: 80,
} as const
