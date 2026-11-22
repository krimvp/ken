// What the reader looked at: ~/.ken/projects/<project id>/seen.jsonl, beside the map and never in the repository. The
// map learns only from what the reader says. This file holds what they did: a part they opened, an explanation they
// read, code they opened, a change they walked through. ken only appends; a person may add or change lines by hand. A
// line that does not parse is skipped and named, never fatal.
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { type CommitHash, parsePath, type RepoPath, type Repository } from '../../repo/index.ts'

// opened: the reader picked the part. read: they stayed on its explanation, or moved on from its tour stop. code: they
// opened its files, quoted lines or a diff. said: they pressed "I know this part". forgot: they said they do not know
// it, which is the same as setting it to seen. change: they read a step or a diff of a change that touched the paths.
// set: they corrected what ken thinks they know of the paths, to the level they picked.
export const DID = ['opened', 'read', 'code', 'said', 'forgot', 'change', 'set'] as const
export type Did = (typeof DID)[number]

// How well the reader knows a part, weakest first. The layout owns the words for each and decides the level from the
// lines. They are named here because a correction keeps one in the file.
export const KNOWN = ['new', 'seen', 'read', 'code', 'said'] as const
export type Known = (typeof KNOWN)[number]

// What the reader did, as the page sends it. paths are what they looked at: a part's paths, or the files of a step.
// Only a change has the range of commits they read, and only a correction the level they picked.
export type Looked = { paths: RepoPath[] } & (
	| { did: Exclude<Did, 'change' | 'set'> }
	| { did: 'change'; change: { base: string; head: string } }
	| { did: 'set'; level: Known }
)

// One line of the file. at is when ken wrote it, and head the commit the project was at then. A hash read from the
// file is text until git resolves it, since a person may have typed it.
export type SeenLine = Looked & { at: string; head: string }

// The reader took a line back: undoes is the at of that line. The file only grows, so the line stays in it and this
// one cancels it.
type UndoLine = { at: string; did: 'undo'; undoes: string; head: string }

export type SeenRead = { lines: SeenLine[]; problems: string[] }

export type ReaderSeen = {
	file: string
	// Every line that parses and that the reader has not taken back, in the order of the file.
	read(): Promise<SeenRead>
	// Adds one line. A page may send the same thing twice, so the same did for the same paths within ten minutes
	// writes nothing, unless the reader took it back in between.
	add(looked: Looked, head: CommitHash, now: Date): Promise<'written' | 'repeat'>
	// Takes back the line written at the moment given. missing: no line was written then.
	undo(at: string, head: CommitHash, now: Date): Promise<'written' | 'repeat' | 'missing'>
}

const REPEAT_MS = 10 * 60 * 1000
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

export async function openSeen(
	home: string,
	repo: Repository,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; seen: ReaderSeen } | { kind: 'no-commits' }> {
	const first = await repo.firstCommit(signal)
	if (first === null) return { kind: 'no-commits' }
	const file = path.join(home, 'projects', first, 'seen.jsonl')

	type All = { lines: SeenLine[]; undone: Set<string>; problems: string[] }
	// The file is parsed once for each version of it, so the reads of one request, and of the next, share the parse.
	let parsed: { version: string; all: Promise<All> } | null = null
	async function readAll(): Promise<All> {
		const version = await stat(file).then(
			(info) => `${info.mtimeMs} ${info.size}`,
			() => 'none',
		)
		if (parsed?.version !== version) parsed = { version, all: parseAll() }
		return await parsed.all
	}

	async function parseAll(): Promise<All> {
		// A file ken cannot read leaves what ken thinks the reader knows empty, and says why, rather than failing the page.
		const text = await readFile(file, 'utf8').catch((error: unknown) =>
			isMissing(error)
				? ''
				: { problem: `ken could not read ${file}: ${error instanceof Error ? error.message : String(error)}` },
		)
		if (typeof text !== 'string') return { lines: [], undone: new Set(), problems: [text.problem] }
		const lines: SeenLine[] = []
		const undone = new Set<string>()
		const problems: string[] = []
		for (const [index, line] of text.split('\n').entries()) {
			if (line.trim() === '') continue
			const parsed = parseSeenLine(line)
			if (parsed.kind === 'skipped') {
				problems.push(`Line ${index + 1} of what you looked at is skipped: ${parsed.problem}.`)
			} else if (parsed.line.did === 'undo') undone.add(parsed.line.undoes)
			else lines.push(parsed.line)
		}
		return { lines, undone, problems }
	}

	async function read(): Promise<SeenRead> {
		const { lines, undone, problems } = await readAll()
		return { lines: lines.filter((line) => !undone.has(line.at)), problems }
	}

	async function append(line: SeenLine | UndoLine) {
		await mkdir(path.dirname(file), { recursive: true })
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		// A person may save the file without a newline at its end, which would join their last line to ken's.
		const lead = text === '' || text.endsWith('\n') ? '' : '\n'
		await appendFile(file, `${lead}${seenLine(line)}\n`)
	}

	async function add(looked: Looked, head: CommitHash, now: Date) {
		const recent = (await read()).lines.filter((line) => now.getTime() - Date.parse(line.at) < REPEAT_MS)
		const same = recent.findLastIndex((line) => sameLooked(line, looked))
		// A correction takes back what came before it, and anything after a correction may take it back. Past either,
		// the same line again says something new.
		const tookBack = (line: SeenLine) => corrects(looked) || corrects(line)
		if (same !== -1 && !recent.slice(same + 1).some(tookBack)) return 'repeat'
		await append({ ...looked, at: now.toISOString(), head })
		return 'written'
	}

	async function undo(at: string, head: CommitHash, now: Date) {
		const moment = Number.isNaN(Date.parse(at)) ? '' : new Date(at).toISOString()
		const { lines, undone } = await readAll()
		if (!lines.some((line) => line.at === moment)) return 'missing'
		if (undone.has(moment)) return 'repeat'
		await append({ at: now.toISOString(), did: 'undo', undoes: moment, head })
		return 'written'
	}

	return { kind: 'ok', seen: { file, read, add, undo } }
}

function corrects(looked: Looked): boolean {
	return looked.did === 'forgot' || looked.did === 'set'
}

function sameLooked(a: Looked, b: Looked): boolean {
	const paths = (looked: Looked) => looked.paths.toSorted().join('\n')
	const more = (looked: Looked) =>
		looked.did === 'change' ? `${looked.change.base}..${looked.change.head}` : looked.did === 'set' ? looked.level : ''
	return a.did === b.did && paths(a) === paths(b) && more(a) === more(b)
}

function seenLine(line: SeenLine | UndoLine): string {
	if (line.did === 'undo') return JSON.stringify(line)
	const { at, did, paths, head } = line
	const more = line.did === 'change' ? { change: line.change } : line.did === 'set' ? { level: line.level } : {}
	return JSON.stringify({ at, did, paths, head, ...more })
}

function parseSeenLine(line: string): { kind: 'ok'; line: SeenLine | UndoLine } | { kind: 'skipped'; problem: string } {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return { kind: 'skipped', problem: 'it is not JSON' }
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { kind: 'skipped', problem: 'it is not a JSON object' }
	}
	const [at, did, paths, head, change, level, undoes] = ['at', 'did', 'paths', 'head', 'change', 'level', 'undoes'].map(
		(name) => Reflect.get(value, name),
	)
	const known = DID.find((each) => each === did)
	const moment = (time: unknown) =>
		typeof time === 'string' && !Number.isNaN(Date.parse(time)) ? new Date(time).toISOString() : null
	const when = moment(at)
	if (when === null) return { kind: 'skipped', problem: 'its at is not a time such as 2026-11-22T10:33:00.000Z' }
	if (did === 'undo') {
		const taken = moment(undoes)
		if (taken === null) return { kind: 'skipped', problem: 'its undoes is not the at of the line it takes back' }
		if (typeof head !== 'string' || !HASH.test(head)) {
			return { kind: 'skipped', problem: 'its head is not the full hash of a commit' }
		}
		return { kind: 'ok', line: { at: when, did, undoes: taken, head } }
	}
	if (!known) return { kind: 'skipped', problem: `its did is not one of ${DID.join(', ')}, undo` }
	const parsed = Array.isArray(paths) ? paths.map((each) => (typeof each === 'string' ? parsePath(each) : null)) : []
	const inside = parsed.flatMap((each) => (each?.kind === 'ok' ? [each.path] : []))
	if (inside.length === 0 || inside.length !== parsed.length) {
		return { kind: 'skipped', problem: 'its paths are not a list of paths inside the project' }
	}
	if (typeof head !== 'string' || !HASH.test(head)) {
		return { kind: 'skipped', problem: 'its head is not the full hash of a commit' }
	}
	// Written one way, so the lines sort by time as text whoever typed them.
	const seen = { at: when, paths: inside, head }
	if (known === 'set') {
		const picked = KNOWN.find((each) => each === level)
		if (!picked) return { kind: 'skipped', problem: `its level is not one of ${KNOWN.join(', ')}` }
		return { kind: 'ok', line: { ...seen, did: known, level: picked } }
	}
	if (known !== 'change') return { kind: 'ok', line: { ...seen, did: known } }
	const [base, end] = ['base', 'head'].map((name) =>
		typeof change === 'object' && change !== null ? Reflect.get(change, name) : undefined,
	)
	if (typeof base !== 'string' || typeof end !== 'string' || !HASH.test(base) || !HASH.test(end)) {
		return { kind: 'skipped', problem: 'a change needs change: { base, head }, each the full hash of a commit' }
	}
	return { kind: 'ok', line: { ...seen, did: known, change: { base, head: end } } }
}

function emptyWhenMissing(error: unknown): string {
	if (isMissing(error)) return ''
	throw error
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
