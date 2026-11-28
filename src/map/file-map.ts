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
	type TopicCode,
	topicCode,
} from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import { lineFor, type MapSignal } from './learn.ts'
import { type DetailEntry, type MapEntry, type MapLine, parseMapLine } from './map-entry.ts'
import { stateOf, type TopicState } from './topic-state.ts'

// A topic the reader met that the project record does not hold, with the lines its reply quoted: a reply given the
// reader's own words keeps its topics in their history (see Heard in the record).
export type OwnTopic = Pick<Topic, 'name' | 'quotes'>

// states holds every topic in the project record, in the record's order, then the reader's own topics, which own
// lists with their lines. problems names each line ken skipped.
export type MapRead = { states: TopicState[]; own: OwnTopic[]; problems: string[] }

type SelectedTopics = { record?: RecordRead; names: string[] }

type CodeOf = (topic: Pick<Topic, 'quotes'>) => Promise<TopicCode>

export type UnderstandingMap = {
	file: string
	read(now: Date, signal?: AbortSignal, selected?: SelectedTopics): Promise<MapRead>
	// Adds the lines a signal from the reader makes for these topics, and returns their states after it. A name with no
	// topic in the record or the map is left out, unless quoted gives its lines: then it is one of the reader's own.
	learn(
		mapSignal: MapSignal,
		topics: string[],
		now: Date,
		signal?: AbortSignal,
		quoted?: OwnTopic[],
	): Promise<TopicState[]>
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

	// The current topics, and every version of each, since a map line may hash a version the record has replaced. A
	// topic the record lacks is the reader's own, with the lines of its newest map line, or of quoted, which is newer.
	type Topics = { current: OwnTopic[]; versions: OwnTopic[]; own: OwnTopic[] }
	async function topics(entries: MapLine[], snapshot?: RecordRead, quoted: OwnTopic[] = []): Promise<Topics> {
		const read = snapshot ?? (await record.read())
		const only = (entries: RecordEntry[]) => entries.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
		const recorded = only(read.current)
		const own: OwnTopic[] = []
		const kept = entries.flatMap((line) =>
			'quotes' in line && line.quotes ? [{ name: line.topic, quotes: line.quotes }] : [],
		)
		for (const topic of [...kept, ...quoted]) {
			if (recorded.some((each) => sameName(each.name, topic.name))) continue
			const older = own.findIndex((each) => sameName(each.name, topic.name))
			if (older === -1) own.push(topic)
			else own[older] = topic
		}
		return { current: [...recorded, ...own], versions: [...only(read.entries), ...own], own }
	}

	// A topic's code at one commit never changes, so each topic is checked once per HEAD and every read at that HEAD
	// shares it. A new HEAD starts afresh. The shared check takes no signal: one reader's abort must not fail another's.
	let shared: { head: string; codes: Map<string, Promise<TopicCode>> } | null = null
	async function codesNow(abort?: AbortSignal): Promise<CodeOf> {
		const head = await repo.resolve('HEAD', abort)
		if (head.kind !== 'ok') return (topic) => topicCode(repo, topic, abort)
		if (shared?.head !== head.commit) shared = { head: head.commit, codes: new Map() }
		const { codes } = shared
		return (topic) => {
			const key = JSON.stringify(topic.quotes.map((quote) => [quote.path, quote.text, quote.startLine]))
			let code = codes.get(key)
			if (!code) {
				code = topicCode(repo, topic, undefined, head.commit)
				codes.set(key, code)
				code.catch(() => codes.delete(key))
			}
			return code
		}
	}

	async function stateNow(
		topic: OwnTopic,
		{ versions }: Topics,
		entries: MapLine[],
		now: Date,
		codeOf: CodeOf,
	): Promise<TopicState> {
		const entry = entries.findLast((line): line is MapEntry => 'evidence' in line && sameName(line.topic, topic.name))
		const preference = entries.findLast(
			(line): line is DetailEntry => 'detail' in line && sameName(line.topic, topic.name),
		)
		const code = await codeOf(topic)
		const knew =
			entry && code.hash !== entry.hash
				? versions.find((version) => sameName(version.name, topic.name) && codeHash(version.quotes) === entry.hash)
				: undefined
		const knewGone = knew ? (await codeOf(knew)).gone : []
		const state = stateOf(topic, entry, code, now, knewGone)
		return preference?.detail === 'shorter' ? { ...state, shorterSince: preference.date } : state
	}

	async function read(now: Date, abort?: AbortSignal, selected?: SelectedTopics): Promise<MapRead> {
		const { entries, problems } = await lines()
		const known = await topics(entries, selected?.record)
		const asked = selected
			? known.current.filter((topic) => selected.names.some((name) => sameName(name, topic.name)))
			: known.current
		const codeOf = await codesNow(abort)
		const states = await Promise.all(asked.map((topic) => stateNow(topic, known, entries, now, codeOf)))
		for (const entry of entries) {
			if (!known.current.some((topic) => sameName(topic.name, entry.topic))) {
				problems.push(`The map names "${entry.topic}", which is not a topic in the project record, so ken skips it.`)
			}
		}
		return { states, own: known.own, problems: [...new Set(problems)] }
	}

	async function learn(mapSignal: MapSignal, names: string[], now: Date, abort?: AbortSignal, quoted?: OwnTopic[]) {
		const { entries } = await lines()
		const known = await topics(entries, undefined, quoted)
		const chosen = known.current.filter((topic) => names.some((name) => sameName(name, topic.name)))
		const codeOf = await codesNow(abort)
		const before = await Promise.all(chosen.map((topic) => stateNow(topic, known, entries, now, codeOf)))
		const added = before.flatMap((state, at) => {
			const line = lineFor(mapSignal, state, now)
			const own = known.own.find((topic) => topic === chosen[at])
			return line === null ? [] : own && 'hash' in line ? [{ ...line, quotes: own.quotes }] : [line]
		})
		if (added.length === 0) return before
		await append(added)
		const updated = [...entries, ...added]
		return await Promise.all(chosen.map((topic) => stateNow(topic, known, updated, now, codeOf)))
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
