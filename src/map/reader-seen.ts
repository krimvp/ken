// What the reader looked at: ~/.ken/projects/<project id>/seen.jsonl, beside the map and never in the repository. The
// map learns only from what the reader says. This file holds what they did: a part they opened, an explanation they
// read, code they opened, a change they walked through. ken only appends; a person may add or change lines by hand. A
// line that does not parse is skipped and named, never fatal.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { type CommitHash, parsePath, type RepoPath, type Repository } from '../repo/index.ts'

// opened: the reader picked the part. read: they stayed on its explanation, or moved on from its tour stop. code: they
// opened its files, quoted lines or a diff. said: they pressed "I know this part". forgot: they pressed "Not right".
// change: they read a step or a diff of a change that touched the paths.
export const DID = ['opened', 'read', 'code', 'said', 'forgot', 'change'] as const
export type Did = (typeof DID)[number]

// What the reader did, as the page sends it. paths are what they looked at: a part's paths, or the files of a step.
// Only a change has the range of commits they read.
export type Looked = { paths: RepoPath[] } & (
	| { did: Exclude<Did, 'change'> }
	| { did: 'change'; change: { base: string; head: string } }
)

// One line of the file. at is when ken wrote it, and head the commit the project was at then. A hash read from the
// file is text until git resolves it, since a person may have typed it.
export type SeenLine = Looked & { at: string; head: string }

export type SeenRead = { lines: SeenLine[]; problems: string[] }

export type ReaderSeen = {
	file: string
	// Every line that parses, in the order of the file.
	read(): Promise<SeenRead>
	// Adds one line. A page may send the same thing twice, so the same did for the same paths within ten minutes
	// writes nothing, unless the reader took it back in between.
	add(looked: Looked, head: CommitHash, now: Date): Promise<'written' | 'repeat'>
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

	async function read(): Promise<SeenRead> {
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		const lines: SeenLine[] = []
		const problems: string[] = []
		for (const [index, line] of text.split('\n').entries()) {
			if (line.trim() === '') continue
			const parsed = parseSeenLine(line)
			if (parsed.kind === 'ok') lines.push(parsed.line)
			else problems.push(`Line ${index + 1} of what you looked at is skipped: ${parsed.problem}.`)
		}
		return { lines, problems }
	}

	async function add(looked: Looked, head: CommitHash, now: Date) {
		const recent = (await read()).lines.filter((line) => now.getTime() - Date.parse(line.at) < REPEAT_MS)
		const same = recent.findLastIndex((line) => sameLooked(line, looked))
		// "Not right" takes back what came before it, and anything after takes back a "Not right". Past either, the
		// same line again says something new.
		const tookBack = (line: SeenLine) => (line.did === 'forgot') !== (looked.did === 'forgot')
		if (same !== -1 && !recent.slice(same + 1).some(tookBack)) return 'repeat'
		await mkdir(path.dirname(file), { recursive: true })
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		// A person may save the file without a newline at its end, which would join their last line to ken's.
		const lead = text === '' || text.endsWith('\n') ? '' : '\n'
		await appendFile(file, `${lead}${seenLine({ ...looked, at: now.toISOString(), head })}\n`)
		return 'written'
	}

	return { kind: 'ok', seen: { file, read, add } }
}

function sameLooked(a: Looked, b: Looked): boolean {
	const paths = (looked: Looked) => looked.paths.toSorted().join('\n')
	const range = (looked: Looked) => (looked.did === 'change' ? `${looked.change.base}..${looked.change.head}` : '')
	return a.did === b.did && paths(a) === paths(b) && range(a) === range(b)
}

function seenLine(line: SeenLine): string {
	const { at, did, paths, head } = line
	return JSON.stringify({ at, did, paths, head, ...(line.did === 'change' ? { change: line.change } : {}) })
}

function parseSeenLine(line: string): { kind: 'ok'; line: SeenLine } | { kind: 'skipped'; problem: string } {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return { kind: 'skipped', problem: 'it is not JSON' }
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { kind: 'skipped', problem: 'it is not a JSON object' }
	}
	const [at, did, paths, head, change] = ['at', 'did', 'paths', 'head', 'change'].map((name) =>
		Reflect.get(value, name),
	)
	const known = DID.find((each) => each === did)
	if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
		return { kind: 'skipped', problem: 'its at is not a time such as 2026-11-22T10:33:00.000Z' }
	}
	if (!known) return { kind: 'skipped', problem: `its did is not one of ${DID.join(', ')}` }
	const parsed = Array.isArray(paths) ? paths.map((each) => (typeof each === 'string' ? parsePath(each) : null)) : []
	const inside = parsed.flatMap((each) => (each?.kind === 'ok' ? [each.path] : []))
	if (inside.length === 0 || inside.length !== parsed.length) {
		return { kind: 'skipped', problem: 'its paths are not a list of paths inside the project' }
	}
	if (typeof head !== 'string' || !HASH.test(head)) {
		return { kind: 'skipped', problem: 'its head is not the full hash of a commit' }
	}
	// Written one way, so the lines sort by time as text whoever typed them.
	const seen = { at: new Date(at).toISOString(), paths: inside, head }
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
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
	throw error
}
