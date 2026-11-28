// What ken thinks the reader knows of a thing that is no box: a term or a drawn process. It is worked out as a box's
// belief is, from the lines on what they looked at that name a file the thing quotes, and for a term from its own
// topic on the map. null says ken holds nothing on it yet.
import { onDay } from '../../follow-up/index.ts'
import { believe, type Knows, looksAt, type Thing } from '../../map/index.ts'
import { type RecordEntry, type RecordRead, sameName } from '../../record/index.ts'
import type { CommitHash, RepoPath, Repository } from '../../repo/index.ts'
import type { LayoutSources } from '../layout-look.ts'
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
		looks.evidence.length === 0
			? null
			: believe(looks, sinces[index] ?? null, head.commit, (date) => onDay(date, now), things[index]?.thing),
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
		level.parts.flatMap((part) => {
			const match = partMention(question, part.name)
			return match ? [{ level, part, match }] : []
		}),
	)
	const named = matches[0]
	if (matches.length !== 1 || named?.match !== 'named') return null
	const { level, part } = named
	const head = await sources.repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') return null
	const paths = part.places.map((place) => place.path)
	const seen = await sources.seen.read()
	const statements = seen.lines.filter((line) => line.did === 'set' || line.did === 'said' || line.did === 'forgot')
	const looks = looksAt(paths, statements, [])
	const last = looks.evidence.at(-1)
	const arrow = level.arrows.find((edge) => edge.from === part.name || edge.to === part.name)
	const connected = arrow?.from === part.name ? arrow.to : arrow?.from
	const nextReading = /\b(?:read|look|explore|next|connects?|related)\b/i.test(question)
	const neighbor = level.parts.find((other) =>
		connected ? other.name === connected : nextReading && other.name !== part.name,
	)
	const neighborPath = neighbor?.places[0]
	const drawn = part.places.map((place) => place.id)
	const places = neighborPath ? [...part.places, neighborPath] : part.places
	const current =
		head.commit === level.drawnAt
			? places.map((place) => place.id)
			: await sources.repo.objectIds(
					head.commit,
					places.map((place) => place.path),
					signal,
				)
	const ids = current.slice(0, paths.length)
	if (ids.every((id) => id === null)) return null
	const place = part.places.length === 1 ? part.places[0] : undefined
	const [source, nearby] = await Promise.all([
		place && sourceStart(sources.repo, head.commit, place.path, 16, 1200, signal),
		nextReading && neighbor?.places.length === 1 && neighborPath && current[paths.length]
			? sourceStart(sources.repo, head.commit, neighborPath.path, 5, 400, signal)
			: null,
	])
	const next =
		neighbor && neighborPath && current[paths.length]
			? {
					name: neighbor.name,
					path: neighborPath.path,
					source: nearby,
					arrow: arrow && level.drawnAt === head.commit ? [arrow.from, arrow.text, arrow.to] : null,
				}
			: null
	let why = last ? believe(looks, null, head.commit, onDay).why : ''
	// Compare this part at two commits without reading the whole history or the files themselves.
	const at = looks.lookedAt[0]?.[0]
	if (last && at && at !== head.commit && (last.kind === 'said' || (last.kind === 'set' && last.level === 'said'))) {
		let then: typeof ids = drawn
		if (at !== level.drawnAt) {
			const before = await sources.repo.resolve(at, signal)
			then = before.kind === 'ok' ? await sources.repo.objectIds(before.commit, paths, signal) : []
		}
		if (then.every((id) => id === null)) why += ' ken could not check that version.'
		else if (then.some((id, i) => id !== ids[i])) why += ' The code has changed since you looked.'
	}
	return {
		name: part.name,
		within: level.within,
		commit: head.commit,
		source,
		reader: why,
		neighbor: next,
		earlier: level.drawnAt !== head.commit,
		drawnAt: level.drawnAt,
	}
}

async function sourceStart(
	repo: Repository,
	commit: CommitHash,
	path: RepoPath,
	count: number,
	chars: number,
	signal?: AbortSignal,
) {
	const file = await repo.readFile(commit, path, signal, 64 * 1024)
	if (file.kind !== 'ok' || file.text.includes('\0')) return null
	const lines = file.text.split(/\r?\n/, count + 1)
	if (lines.at(-1) === '') lines.pop()
	let text = ''
	let end = 0
	for (const line of lines.slice(0, count)) {
		const row = `${end + 1}\t${JSON.stringify(line)}\n`
		if (text.length + row.length > chars) break
		text += row
		end++
	}
	return lines.slice(0, end).some((line) => line.trim()) ? { path, end, text } : null
}

function partMention(question: string, name: string): 'named' | 'mentioned' | null {
	const lower = question.toLowerCase()
	const term = name.toLowerCase()
	const word = /[\p{L}\p{N}_]/u
	let mention: 'mentioned' | null = null
	for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) {
		if (word.test(question[at - 1] ?? '') || word.test(question[at + term.length] ?? '')) continue
		const before = question.slice(0, at).trimEnd()
		if (
			/\b(?:skip|ignore|exclude|instead of|other than|except|(?:do not|don['\u2019]t) (?:explain|cover|discuss))(?: the)?$/i.test(
				before,
			)
		)
			continue
		const exact = question.slice(at, at + name.length) === name && name !== term
		const addressed =
			/\b(?:explain|describe|compare|about|understand|explore|review|walk me through|how does|what does|what is|inside|start with|look at)(?: the)?$/i.test(
				before,
			)
		if (exact || addressed || (before === '' && /^[?.!\s]*$/.test(question.slice(at + name.length)))) return 'named'
		mention = 'mentioned'
	}
	return mention
}
