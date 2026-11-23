// The understanding map on disk: ~/.ken/projects/<project id>/map.jsonl, beside the reader's history and never in the
// repository. ken only appends; a person may add or change lines by hand. Every line that parses counts, whoever wrote
// it. Each topic keeps its newest knowledge evidence and latest reply-length preference.
// A line that does not parse is skipped and named.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
	codeHash,
	type RecordEntry,
	type RecordRead,
	type RecordStore,
	sameName,
	type Topic,
	topicCode,
} from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import { lineFor, type MapSignal } from './learn.ts'
import { type DetailEntry, type MapEntry, type MapLine, parseMapLine } from './map-entry.ts'
import { stateOf, type TopicState } from './topic-state.ts'

// states holds every topic in the project record, in the record's order. problems names each line ken skipped.
export type MapRead = { states: TopicState[]; problems: string[] }

type SelectedTopics = { record?: RecordRead; names: string[] }

export type UnderstandingMap = {
	file: string
	read(now: Date, signal?: AbortSignal, selected?: SelectedTopics): Promise<MapRead>
	// Adds the lines a signal from the reader makes for these topics, and returns their states after it. A name with no
	// topic in the record is left out.
	learn(mapSignal: MapSignal, topics: string[], now: Date, signal?: AbortSignal): Promise<TopicState[]>
}

export async function openMap(
	home: string,
	repo: Repository,
	record: RecordStore,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; map: UnderstandingMap } | { kind: 'no-commits' }> {
	const first = await repo.firstCommit(signal)
	if (first === null) return { kind: 'no-commits' }
	const file = path.join(home, 'projects', first, 'map.jsonl')

	async function lines(): Promise<{ entries: MapLine[]; problems: string[] }> {
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		const entries: MapLine[] = []
		const problems: string[] = []
		for (const [index, line] of text.split('\n').entries()) {
			if (line.trim() === '') continue
			const parsed = parseMapLine(line)
			if (parsed.kind === 'ok') entries.push(parsed.entry)
			else problems.push(`Line ${index + 1} of the map is skipped: ${parsed.problem}.`)
		}
		return { entries, problems }
	}

	// The current topics, and every version of each, since a map line may hash a version the record has replaced.
	type Topics = { current: Topic[]; versions: Topic[] }
	async function topics(snapshot?: RecordRead): Promise<Topics> {
		const read = snapshot ?? (await record.read())
		const only = (entries: RecordEntry[]) => entries.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
		return { current: only(read.current), versions: only(read.entries) }
	}

	async function stateNow(
		topic: Topic,
		{ versions }: Topics,
		entries: MapLine[],
		now: Date,
		abort?: AbortSignal,
	): Promise<TopicState> {
		const entry = entries.findLast((line): line is MapEntry => 'evidence' in line && sameName(line.topic, topic.name))
		const preference = entries.findLast(
			(line): line is DetailEntry => 'detail' in line && sameName(line.topic, topic.name),
		)
		const code = await topicCode(repo, topic, abort)
		const knew =
			entry && code.hash !== entry.hash
				? versions.find((version) => sameName(version.name, topic.name) && codeHash(version.quotes) === entry.hash)
				: undefined
		const knewGone = knew ? (await topicCode(repo, knew, abort)).gone : []
		const state = stateOf(topic, entry, code, now, knewGone)
		return preference?.detail === 'shorter' ? { ...state, shorterSince: preference.date } : state
	}

	async function read(now: Date, abort?: AbortSignal, selected?: SelectedTopics): Promise<MapRead> {
		const [{ entries, problems }, known] = await Promise.all([lines(), topics(selected?.record)])
		const asked = selected
			? known.current.filter((topic) => selected.names.some((name) => sameName(name, topic.name)))
			: known.current
		const states = await Promise.all(asked.map((topic) => stateNow(topic, known, entries, now, abort)))
		for (const entry of entries) {
			if (!known.current.some((topic) => sameName(topic.name, entry.topic))) {
				problems.push(`The map names "${entry.topic}", which is not a topic in the project record, so ken skips it.`)
			}
		}
		return { states, problems: [...new Set(problems)] }
	}

	async function learn(mapSignal: MapSignal, names: string[], now: Date, abort?: AbortSignal) {
		const [{ entries }, known] = await Promise.all([lines(), topics()])
		const chosen = known.current.filter((topic) => names.some((name) => sameName(name, topic.name)))
		const before = await Promise.all(chosen.map((topic) => stateNow(topic, known, entries, now, abort)))
		const added = before.flatMap((state) => lineFor(mapSignal, state, now) ?? [])
		if (added.length === 0) return before
		await append(added)
		const updated = [...entries, ...added]
		return await Promise.all(chosen.map((topic) => stateNow(topic, known, updated, now, abort)))
	}

	async function append(entries: MapLine[]) {
		await mkdir(path.dirname(file), { recursive: true })
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		// A person may save the file without a newline at its end, which would join their last line to ken's first.
		const lead = text === '' || text.endsWith('\n') ? '' : '\n'
		await appendFile(file, `${lead}${entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')}`)
	}

	return { kind: 'ok', map: { file, read, learn } }
}

function emptyWhenMissing(error: unknown): string {
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
	throw error
}
