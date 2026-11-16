// The project record on disk: .ken/record/ at the root of the project's repository, one JSON Lines file per kind, one
// entry per line, so a person can read it and the owner can commit it. This file holds the plan's third deterministic
// rule: the record only grows. append is the one write. It checks every draft and writes all of them or none. There is
// no update and no delete; a correction is a new entry whose replaces names the old one, which stays readable.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Repository } from '../repo/index.ts'
import { checkEntry, type EntryDraft } from './check-entry.ts'
import { contentId, type Entry, entryId, type Kind, type RecordEntry } from './entry.ts'

const FILES: Record<Kind, string> = {
	work: 'work.jsonl',
	decision: 'decisions.jsonl',
	topic: 'topics.jsonl',
	note: 'notes.jsonl',
}
// Two people who each append to the same file then merge keep both sets of lines instead of a conflict.
const GITATTRIBUTES = 'record/*.jsonl merge=union\n'

// entries is every entry in file order; current leaves out each entry that a later one replaces. problems names the
// lines ken skipped because they were not written by append.
export type RecordRead = { entries: RecordEntry[]; current: RecordEntry[]; problems: string[] }

export type Refusal = { kind: 'refused'; problems: string[] }

export type RecordStore = {
	directory: string
	read(): Promise<RecordRead>
	// What append would make of one draft, without writing it. pending holds entries an append will write first.
	check(
		draft: EntryDraft,
		pending?: RecordEntry[],
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; entry: RecordEntry } | Refusal>
	append(
		drafts: EntryDraft[],
		signal?: AbortSignal,
	): Promise<{ kind: 'appended'; entries: { entry: RecordEntry; written: boolean }[] } | Refusal>
}

export function fileRecordStore(root: string, repo: Repository): RecordStore {
	const directory = path.join(root, '.ken', 'record')

	async function read(): Promise<RecordRead> {
		const entries: RecordEntry[] = []
		const problems: string[] = []
		const seen = new Set<string>()
		for (const [kind, name] of Object.entries(FILES)) {
			const lines = (await readText(path.join(directory, name))).split('\n')
			for (const [index, line] of lines.entries()) {
				if (line.trim() === '') continue
				const entry = parseLine(line, kind)
				if (entry === null) {
					problems.push(`.ken/record/${name} line ${index + 1} was not written by ken, so ken skips it.`)
				} else if (!seen.has(entry.id)) {
					seen.add(entry.id)
					entries.push(entry)
				}
			}
		}
		return { entries, current: currentOf(entries), problems }
	}

	async function check(draft: EntryDraft, pending: RecordEntry[] = [], signal?: AbortSignal) {
		const known = [...(await read()).entries, ...pending]
		const checked = await checkEntry(repo, { known, current: currentOf(known) }, draft, signal)
		if (checked.kind === 'refused') return checked
		return { kind: 'ok', entry: stored(checked.entry, checked.replaces) } as const
	}

	async function append(drafts: EntryDraft[], signal?: AbortSignal) {
		const known = (await read()).entries
		const entries: { entry: RecordEntry; written: boolean }[] = []
		const problems: string[] = []
		for (const [index, draft] of drafts.entries()) {
			const checked = await checkEntry(repo, { known, current: currentOf(known) }, draft, signal)
			if (checked.kind === 'refused') {
				problems.push(...checked.problems.map((problem) => `${draft.kind} ${index + 1}: ${problem}`))
				continue
			}
			const entry = stored(checked.entry, checked.replaces)
			const before = known.find((other) => other.id === entry.id)
			entries.push(before ? { entry: before, written: false } : { entry, written: true })
			if (!before) known.push(entry)
		}
		if (problems.length > 0) return { kind: 'refused', problems } as const

		const written = entries.filter((each) => each.written).map((each) => each.entry)
		if (written.length > 0) {
			await mkdir(directory, { recursive: true })
			await writeFile(path.join(directory, '..', '.gitattributes'), GITATTRIBUTES, { flag: 'wx' }).catch(ignoreExists)
		}
		for (const [kind, name] of Object.entries(FILES)) {
			const lines = written.filter((entry) => entry.kind === kind).map((entry) => `${JSON.stringify(entry)}\n`)
			if (lines.length === 0) continue
			const file = path.join(directory, name)
			// A line cut short by a crash would swallow the next one, so a file that does not end a line gets a newline.
			const text = await readText(file)
			await appendFile(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${lines.join('')}`)
		}
		return { kind: 'appended', entries } as const
	}

	return { directory, read, check, append }
}

// Key order is what a person sees in the file: the id, then the content, then the links and the time.
function stored(entry: Entry, replaces: RecordEntry['replaces']): RecordEntry {
	return { id: entryId(entry, replaces), ...entry, replaces, at: new Date().toISOString() }
}

function currentOf(entries: RecordEntry[]): RecordEntry[] {
	const replaced = new Set(entries.map((entry) => entry.replaces))
	return entries.filter((entry) => !replaced.has(entry.id))
}

function parseLine(line: string, kind: string): RecordEntry | null {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return null
	}
	if (!isObject(value)) return null
	const { id, at, ...content } = value
	if (content.kind !== kind || typeof at !== 'string' || contentId(content) !== id) return null
	// The id is a hash of the content, and only append writes ids, so this line holds an entry that passed checkEntry.
	// A piece of work written before ken kept diagrams or risks has none; its id still matches, since it hashes the line
	// as written. Its risks are null, not an empty list, because nobody looked for them. A decision written before ken
	// asked for a reason has none.
	const entry = value as RecordEntry
	if (entry.kind === 'decision') return { ...entry, reason: entry.reason ?? null }
	if (entry.kind !== 'work') return entry
	return { ...entry, diagrams: entry.diagrams ?? [], risks: entry.risks ?? null }
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readText(file: string): Promise<string> {
	try {
		return await readFile(file, 'utf8')
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
		throw error
	}
}

function ignoreExists(error: unknown) {
	if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return
	throw error
}
