// The briefs of what "In its world" and "Where it runs" draw: a frame, a store, an outside system and a crossing. Plain
// code builds each from the drawings the top level holds, with no model: the model's one line, the lines ken found,
// the crossings into and out of it as Sideways, and for a frame what sits in it and the parts in it as Deeper.
import type { LayoutLook } from '../../layout/index.ts'
import { partId } from './concept.ts'
import { type BriefQuote, fileQuotes } from './told.ts'

type LookViews = NonNullable<LayoutLook['views']>
type Runtime = NonNullable<LookViews['runtime']>
type Thing = Runtime['things'][number]
type Kind = 'frame' | 'store' | 'outside' | 'crossing'
type Named = { id: string; name: string }
type Neighbour = Named & { verb: string }

// The fields of a brief that a view concept fills. inside is what sits right in a frame, parts the parts in it and in
// the frames inside it, gaps what the repository does not say about it, and topics a bus's topics.
export type ViewBrief = {
	id: string
	kind: Kind
	name: string
	line: string
	quotes: BriefQuote[]
	sideways: { uses: Neighbour[]; usedBy: Neighbour[] }
	inside?: Named[]
	parts?: Named[]
	gaps?: string[]
	topics?: string[]
}

// How each way of crossing reads after what crosses: "prompts, over HTTPS".
const HOW_WORDS = {
	http: 'over HTTP',
	https: 'over HTTPS',
	grpc: 'over gRPC',
	sql: 'in SQL',
	event: 'as events',
	file: 'through files',
	process: 'by starting a process',
	library: 'as a library call',
	other: 'some other way',
} as const

const PROJECT = 'the project'

export function viewBrief(kind: Kind, id: string, views: LookViews): ViewBrief | null {
	const world = views.world ?? { outside: [], crossings: [] }
	const runtime: Runtime = views.runtime ?? { frames: [], things: [], crossings: [], gaps: [] }
	const outsideNamed = (outside: string) => world.outside.find((each) => each.id === outside)?.name ?? outside
	const thingOf = (thing: string) => runtime.things.find((each) => each.id === thing)
	const nameOf = (thing: Thing | undefined) =>
		thing === undefined
			? ''
			: thing.kind === 'part'
				? thing.part
				: thing.kind === 'store'
					? thing.name
					: outsideNamed(thing.id)
	const gapsOn = (on: string) => runtime.gaps.flatMap((gap) => (gap.on === on ? [gap.text] : []))
	// The crossings of "Where it runs" that leave the things in from for one outside it, and those that come in.
	const sideways = (from: (thing: string) => boolean) => ({
		uses: runtime.crossings.flatMap((each) =>
			from(each.from) && !from(each.to)
				? [{ id: `crossing:${each.id}`, name: nameOf(thingOf(each.to)), verb: verbOf(each) }]
				: [],
		),
		usedBy: runtime.crossings.flatMap((each) =>
			from(each.to) && !from(each.from)
				? [{ id: `crossing:${each.id}`, name: nameOf(thingOf(each.from)), verb: verbOf(each) }]
				: [],
		),
	})
	const base = (name: string, line: string, quotes: Parameters<typeof fileQuotes>[0]) => ({
		id: `${kind}:${id}`,
		kind,
		name,
		line,
		quotes: fileQuotes(quotes),
	})

	switch (kind) {
		case 'frame': {
			const frame = runtime.frames.find((each) => each.id === id)
			if (!frame) return null
			const within = framesUnder(id, runtime.frames)
			const inFrame = (thing: string) => within.includes(thingOf(thing)?.frame ?? '')
			const children = runtime.frames
				.filter((each) => each.in === id)
				.map((each) => ({ id: `frame:${each.id}`, name: each.name }))
			const things = runtime.things
				.filter((thing) => thing.frame === id)
				.map((thing) => conceptOf(thing, nameOf(thing)))
			const parts = runtime.things.flatMap((thing) =>
				thing.kind === 'part' && within.includes(thing.frame ?? '') ? [conceptOf(thing, thing.part)] : [],
			)
			const quotes = [...frame.quotes, ...(frame.copies ? [frame.copies.quote] : [])]
			return {
				...base(frame.name, frame.line, quotes),
				sideways: sideways(inFrame),
				inside: [...children, ...things],
				parts: parts.filter((part, at) => parts.findIndex((other) => other.id === part.id) === at),
				gaps: gapsOn(id),
			}
		}
		case 'store': {
			const store = thingOf(id)
			if (store?.kind !== 'store') return null
			return {
				...base(store.name, store.line, store.quotes),
				sideways: sideways((thing) => thing === id),
				gaps: gapsOn(id),
				topics: store.topics,
			}
		}
		case 'outside': {
			const outside = world.outside.find((each) => each.id === id)
			if (!outside) return null
			const across = world.crossings.filter((each) => each.outside === id)
			const out = (each: (typeof across)[number]) => ({ id: `crossing:${each.id}`, name: PROJECT, verb: wordsOf(each) })
			const runs = sideways((thing) => thing === id)
			return {
				...base(outside.name, outside.line, outside.quotes),
				sideways: {
					uses: [...across.filter((each) => each.direction !== 'out').map(out), ...runs.uses],
					usedBy: [...across.filter((each) => each.direction !== 'in').map(out), ...runs.usedBy],
				},
				gaps: gapsOn(id),
			}
		}
		case 'crossing': {
			const across = world.crossings.find((each) => each.id === id)
			if (across) {
				const other = outsideNamed(across.outside)
				const [from, to] = across.direction === 'in' ? [other, PROJECT] : [PROJECT, other]
				const both = across.direction === 'both' ? ', both ways' : ''
				const line = `${capital(from)} sends ${wordsOf(across)} to ${to}${both}.`
				return { ...base(`${capital(from)} to ${to}`, line, across.quotes), sideways: { uses: [], usedBy: [] } }
			}
			const crossing = runtime.crossings.find((each) => each.id === id)
			if (!crossing) return null
			const [from, to] = [nameOf(thingOf(crossing.from)), nameOf(thingOf(crossing.to))]
			const line =
				crossing.kind === 'call'
					? `${from} calls ${to} and waits for the answer: ${crossing.text}, ${HOW_WORDS[crossing.how]}.`
					: `${from} sends ${crossing.text} on ${crossing.topic}, and ${to} picks it up later.`
			const quotes = [...crossing.quotes.from, ...crossing.quotes.to]
			return { ...base(`${from} to ${to}`, line, quotes), sideways: { uses: [], usedBy: [] } }
		}
		default:
			return kind satisfies never
	}
}

// What search can find of the drawings: each frame, each store and each outside system.
export function viewRows(
	views: LookViews,
): { id: string; kind: 'frame' | 'store' | 'outside'; name: string; line: string }[] {
	const stores = (views.runtime?.things ?? []).flatMap((thing) => (thing.kind === 'store' ? [thing] : []))
	return [
		...(views.runtime?.frames ?? []).map((frame) => ({
			id: `frame:${frame.id}`,
			kind: 'frame' as const,
			name: frame.name,
			line: frame.line,
		})),
		...stores.map((store) => ({ id: `store:${store.id}`, kind: 'store' as const, name: store.name, line: store.line })),
		...(views.world?.outside ?? []).map((each) => ({
			id: `outside:${each.id}`,
			kind: 'outside' as const,
			name: each.name,
			line: each.line,
		})),
	]
}

// A frame and every frame inside it, at any depth.
function framesUnder(id: string, frames: Runtime['frames']): string[] {
	const found = [id]
	for (let at = 0; at < found.length; at++) {
		for (const frame of frames) if (frame.in === found[at] && !found.includes(frame.id)) found.push(frame.id)
	}
	return found
}

// What a press on a thing opens: a part opens the part of the top level.
function conceptOf(thing: Thing, name: string): Named {
	return { id: thing.kind === 'part' ? partId([], thing.part) : `${thing.kind}:${thing.id}`, name }
}

function verbOf(crossing: Runtime['crossings'][number]): string {
	return crossing.kind === 'call'
		? `${crossing.text}, ${HOW_WORDS[crossing.how]}`
		: `${crossing.text}, on ${crossing.topic}, picked up later`
}

function wordsOf(crossing: { text: string; how: keyof typeof HOW_WORDS }): string {
	return `${crossing.text}, ${HOW_WORDS[crossing.how]}`
}

function capital(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}
