// The reader's history on disk: ~/.ken/projects/<project id>/history.jsonl, one entry per line, only ever appended.
// It is personal, so it lives in the reader's home and never in the repository. The project id is the project's first
// commit, so two clones of one project share one history.
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { SavedAnswer } from '../agent/index.ts'
import type { RecordStore } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import type { HistoryEntry } from './history-entry.ts'
import { parseLine } from './saved-line.ts'

export type History = {
	file: string
	// Oldest first.
	list(): Promise<HistoryEntry[]>
	readSaved(): Promise<SavedAnswer[]>
	add(entry: HistoryEntry): Promise<void>
}

// KEN_HOME moves ken's own folder, for tests and for readers who keep their home elsewhere.
export function kenHome(env: Record<string, string | undefined>): string {
	return env.KEN_HOME || path.join(homedir(), '.ken')
}

// record holds the decisions that lines saved before ken replied in words name by id.
export async function openHistory(
	home: string,
	repo: Repository,
	record: RecordStore,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; history: History } | { kind: 'no-commits' }> {
	const first = await repo.firstCommit(signal)
	if (first === null) return { kind: 'no-commits' }
	const file = path.join(home, 'projects', first, 'history.jsonl')

	async function list(): Promise<HistoryEntry[]> {
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		const decisions = text === '' ? [] : (await record.read()).entries
		return text.split('\n').flatMap((line) => {
			const entry = parseLine(line, decisions)
			return entry ? [entry] : []
		})
	}

	async function add(entry: HistoryEntry): Promise<void> {
		await mkdir(path.dirname(file), { recursive: true })
		// A line cut short by a crash would swallow the next one, so a file that does not end a line gets a newline.
		const last = await lastByte(file)
		const lead = last === '' || last === '\n' ? '' : '\n'
		// One write per entry. Two clones that finish a question in the same moment append to the same file, and a single
		// appended write keeps each line whole.
		await appendFile(file, `${lead}${JSON.stringify(entry)}\n`)
	}

	async function readSaved(): Promise<SavedAnswer[]> {
		return (await list()).flatMap((entry) =>
			'reply' in entry && entry.about === undefined
				? [{ id: entry.id, askedAt: entry.askedAt, head: entry.head, question: entry.question, reply: entry.reply }]
				: [],
		)
	}
	return { kind: 'ok', history: { file, list, add, readSaved } }
}

async function lastByte(file: string): Promise<string> {
	const handle = await open(file, 'r').catch((error: unknown) => {
		if (isMissing(error)) return null
		throw error
	})
	if (handle === null) return ''
	try {
		const { size } = await handle.stat()
		if (size === 0) return ''
		const { buffer } = await handle.read(Buffer.alloc(1), 0, 1, size - 1)
		return buffer.toString('utf8')
	} finally {
		await handle.close()
	}
}

function emptyWhenMissing(error: unknown): string {
	if (isMissing(error)) return ''
	throw error
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
