// What ken thinks the reader knows of a thing that is no box: a term or a drawn process. It is worked out as a box's
// belief is, from the lines on what they looked at that name a file the thing quotes, and for a term from its own
// topic on the map. null says ken holds nothing on it yet.
import { type RecordEntry, type RecordRead, sameName } from '../../record/index.ts'
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

// A free question gets the reader's last statement when it names one part of the current layouts.
export async function readerPart(sources: LayoutSources, question: string, record: RecordRead, signal?: AbortSignal) {
	const levels = new Map<string, Extract<RecordEntry, { kind: 'layout' }>>()
	for (const entry of record.current) {
		if (entry.kind !== 'layout') continue
		const key = JSON.stringify(entry.within)
		const older = levels.get(key)
		if (!older || older.at <= entry.at) levels.set(key, entry)
	}
	const matches = [...levels.values()].flatMap((level) =>
		level.parts.filter((part) => namesPart(question, part.name)).map((part) => ({ level, part })),
	)
	const named = matches[0]
	if (matches.length !== 1 || !named) return null
	const { level, part } = named
	const paths = part.places.map((place) => place.path)
	const seen = await sources.seen.read()
	const statements = seen.lines.filter((line) => line.did === 'set' || line.did === 'said' || line.did === 'forgot')
	const looks = looksAt(paths, statements, [])
	const last = looks.evidence.at(-1)
	if (!last) return null
	const head = await sources.repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') return null
	const drawn = part.places.map((place) => place.id)
	const ids = head.commit === level.drawnAt ? drawn : await sources.repo.objectIds(head.commit, paths, signal)
	if (ids.every((id) => id === null)) return null
	let why = believe(looks, null, head.commit, new Date()).why
	// Compare this part at two commits without reading the whole history or the files themselves.
	const at = looks.lookedAt[0]?.[0]
	if (at && at !== head.commit && (last.kind === 'said' || (last.kind === 'set' && last.level === 'said'))) {
		let then: typeof ids = drawn
		if (at !== level.drawnAt) {
			const before = await sources.repo.resolve(at, signal)
			then = before.kind === 'ok' ? await sources.repo.objectIds(before.commit, paths, signal) : []
		}
		if (then.every((id) => id === null)) why += ' ken could not check that version.'
		else if (then.some((id, i) => id !== ids[i])) why += ' The code has changed since you looked.'
	}
	return `${part.name}: ${why}`
}

function namesPart(question: string, name: string): boolean {
	const word = /[\p{L}\p{N}_]/u
	for (let at = question.indexOf(name); at >= 0; at = question.indexOf(name, at + name.length)) {
		if (!word.test(question[at - 1] ?? '') && !word.test(question[at + name.length] ?? '')) return true
	}
	return false
}
