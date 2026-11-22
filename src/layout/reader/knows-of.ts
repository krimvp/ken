// What ken thinks the reader knows of a thing that is no box: a term or a drawn process. It is worked out as a box's
// belief is, from the lines on what they looked at that name a file the thing quotes, and for a term from its own
// topic on the map. null says ken holds nothing on it yet.
import { sameName } from '../../record/index.ts'
import type { LayoutSources } from '../layout-look.ts'
import { believe, type Knows, looksAt, type Thing } from './box-knows.ts'
import { sinceLooked } from './since-looked.ts'

// paths are the files the thing's quotes are in. topic is the term's own name in the record, null for a process.
export type Known = { thing: Thing; paths: string[]; topic: string | null }

export async function knowsOf(
	sources: LayoutSources,
	things: Known[],
	now: Date,
	signal?: AbortSignal,
): Promise<(Knows | null)[]> {
	const head = await sources.repo.resolve('HEAD', signal)
	if (head.kind !== 'ok' || things.length === 0) return things.map(() => null)
	const [read, map, seen] = await Promise.all([
		sources.record.read(),
		sources.map.read(now, signal),
		sources.seen.read(),
	])
	const drawn = things.map(({ paths, topic }) => {
		const states = map.states.filter((state) => topic !== null && sameName(state.topic, topic))
		const inBox = states.map((state) => ({ state }))
		return { box: { paths }, inBox, looks: looksAt(paths, seen.lines, states) }
	})
	const sinces = await sinceLooked(sources.repo, read, head.commit, drawn, signal)
	return drawn.map(({ looks }, index) =>
		looks.evidence.length === 0 ? null : believe(looks, sinces[index] ?? null, head.commit, now, things[index]?.thing),
	)
}
