// The understanding map on disk: ~/.ken/projects/<project id>/map.jsonl, beside the reader's history and never in the
// repository. ken only appends; a person may add or change lines by hand. Every line that parses counts, whoever wrote
// it, and the newest line for a topic wins. A line that does not parse is skipped and named, never fatal.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { type RecordStore, sameName, type Topic, topicCode } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import { lineFor, type MapSignal } from './learn.ts'
import { type MapEntry, mapLine, parseMapLine } from './map-entry.ts'
import { stateOf, type TopicState } from './topic-state.ts'

// states holds every topic in the project record, in the record's order. problems names each line ken skipped.
export type MapRead = { states: TopicState[]; problems: string[] }

export type UnderstandingMap = {
	file: string
	read(now: Date, signal?: AbortSignal): Promise<MapRead>
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

	async function lines(): Promise<{ entries: MapEntry[]; problems: string[] }> {
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		const entries: MapEntry[] = []
		const problems: string[] = []
		for (const [index, line] of text.split('\n').entries()) {
			if (line.trim() === '') continue
			const parsed = parseMapLine(line)
			if (parsed.kind === 'ok') entries.push(parsed.entry)
			else problems.push(`Line ${index + 1} of the map is skipped: ${parsed.problem}.`)
		}
		return { entries, problems }
	}

	async function topics(): Promise<Topic[]> {
		return (await record.read()).current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
	}

	async function stateNow(topic: Topic, entries: MapEntry[], now: Date, abort?: AbortSignal): Promise<TopicState> {
		const entry = entries.findLast((each) => sameName(each.topic, topic.name))
		return stateOf(topic, entry, await topicCode(repo, topic, abort), now)
	}

	async function read(now: Date, abort?: AbortSignal): Promise<MapRead> {
		const [{ entries, problems }, known] = await Promise.all([lines(), topics()])
		const states = await Promise.all(known.map((topic) => stateNow(topic, entries, now, abort)))
		for (const entry of entries) {
			if (!known.some((topic) => sameName(topic.name, entry.topic))) {
				problems.push(`The map names "${entry.topic}", which is not a topic in the project record, so ken skips it.`)
			}
		}
		return { states, problems: [...new Set(problems)] }
	}

	async function learn(mapSignal: MapSignal, names: string[], now: Date, abort?: AbortSignal) {
		const [{ entries }, known] = await Promise.all([lines(), topics()])
		const chosen = known.filter((topic) => names.some((name) => sameName(name, topic.name)))
		const added: MapEntry[] = []
		for (const topic of chosen) {
			const line = lineFor(mapSignal, await stateNow(topic, entries, now, abort), now)
			if (line) added.push(line)
		}
		if (added.length > 0) await append(added)
		return await Promise.all(chosen.map((topic) => stateNow(topic, [...entries, ...added], now, abort)))
	}

	async function append(entries: MapEntry[]) {
		await mkdir(path.dirname(file), { recursive: true })
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		// A person may save the file without a newline at its end, which would join their last line to ken's first.
		const lead = text === '' || text.endsWith('\n') ? '' : '\n'
		await appendFile(file, `${lead}${entries.map((entry) => `${mapLine(entry)}\n`).join('')}`)
	}

	return { kind: 'ok', map: { file, read, learn } }
}

function emptyWhenMissing(error: unknown): string {
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
	throw error
}
