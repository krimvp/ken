// Reader notes: plain sentences ken keeps about how this reader wants things shown, or what they already know. They
// sit beside the map, in ~/.ken/projects/<project id>/notes.jsonl, and never in the repository. The file only grows: a
// line adds a note, and another removes it by its id. A person may edit the file, and a line that does not parse is
// skipped.
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Repository } from '../repo/index.ts'

export type ReaderNote = { id: string; text: string; at: string }

type Line = { kind: 'note'; note: ReaderNote } | { kind: 'removes'; id: string }

const NOTE_CHARS = 200
// A question starts with the notes, so only the newest few are read.
const MAX_READ = 12

export type ReaderNotes = {
	file: string
	// The notes that are not removed, oldest first, at most the newest 12.
	read(): Promise<ReaderNote[]>
	// Keeps one more note, and answers with the notes as read does. A text the notes already hold, case and spaces
	// aside, adds nothing.
	add(text: string, now: Date): Promise<{ kind: 'kept'; notes: ReaderNote[] } | { kind: 'refused'; problem: string }>
	remove(id: string, now: Date): Promise<ReaderNote[]>
}

export async function openNotes(
	home: string,
	repo: Repository,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; notes: ReaderNotes } | { kind: 'no-commits' }> {
	const first = await repo.firstCommit(signal)
	if (first === null) return { kind: 'no-commits' }
	const file = path.join(home, 'projects', first, 'notes.jsonl')

	async function kept(): Promise<ReaderNote[]> {
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		let notes: ReaderNote[] = []
		for (const line of text.split('\n').flatMap((each) => parseLine(each) ?? [])) {
			if (line.kind === 'note') notes.push(line.note)
			else notes = notes.filter((note) => note.id !== line.id)
		}
		return notes
	}

	async function append(line: object) {
		await mkdir(path.dirname(file), { recursive: true })
		const text = await readFile(file, 'utf8').catch(emptyWhenMissing)
		// A person may save the file without a newline at its end, which would join their last line to ken's.
		await appendFile(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${JSON.stringify(line)}\n`)
	}

	const read = async () => (await kept()).slice(-MAX_READ)

	return {
		kind: 'ok',
		notes: {
			file,
			read,
			async add(text, now) {
				const said = text.trim()
				if (!isNote(said)) {
					return { kind: 'refused', problem: `A note is one line of 1 to ${NOTE_CHARS} characters.` }
				}
				if (!(await kept()).some((note) => sameWords(note.text, said))) {
					await append({ id: randomUUID().slice(0, 8), text: said, at: now.toISOString() })
				}
				return { kind: 'kept', notes: await read() }
			},
			async remove(id, now) {
				if ((await kept()).some((note) => note.id === id)) await append({ removes: id, at: now.toISOString() })
				return await read()
			},
		},
	}
}

function isNote(text: string): boolean {
	return text !== '' && text.length <= NOTE_CHARS && !text.includes('\n')
}

function sameWords(a: string, b: string): boolean {
	const words = (text: string) => text.toLowerCase().replaceAll(/\s+/g, ' ').trim()
	return words(a) === words(b)
}

function parseLine(line: string): Line | null {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return null
	}
	if (typeof value !== 'object' || value === null) return null
	const [id, text, at, removes] = ['id', 'text', 'at', 'removes'].map((name) => Reflect.get(value, name))
	if (typeof removes === 'string') return { kind: 'removes', id: removes }
	if (typeof id !== 'string' || id === '' || typeof text !== 'string' || typeof at !== 'string') return null
	return isNote(text.trim()) ? { kind: 'note', note: { id, text: text.trim(), at } } : null
}

function emptyWhenMissing(error: unknown): string {
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
	throw error
}
