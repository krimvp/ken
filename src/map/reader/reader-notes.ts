// Reader notes: plain sentences ken keeps about how this reader wants things shown, or what they already know. They
// sit beside the map, in ~/.ken/projects/<project id>/notes.jsonl, and never in the repository. The file only grows: a
// line adds a note, and another removes it by its id. A person may edit the file, and a line that does not parse is
// skipped.
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Repository } from '../../repo/index.ts'

export type ReaderNote = { id: string; text: string; at: string; by?: 'reader' }

type Line = { kind: 'note'; note: ReaderNote } | { kind: 'removes'; id: string }

const NOTE_CHARS = 200
// A question starts with the notes, so only the newest few are read.
const MAX_READ = 12

export type ReaderNotes = {
	file: string
	// The notes that are not removed, oldest first, at most the newest 12.
	read(): Promise<ReaderNote[]>
	// Keeps a note in the latest twelve. Adding an older note again brings it back with the same id.
	add(
		text: string,
		now: Date,
		by?: 'reader',
	): Promise<{ kind: 'kept'; notes: ReaderNote[] } | { kind: 'refused'; problem: string }>
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
		const notes = new Map<string, ReaderNote>()
		for (const line of text.split('\n').flatMap((each) => parseLine(each) ?? [])) {
			if (line.kind === 'removes') notes.delete(line.id)
			else {
				// Keeping an older note again moves it to the end of the twelve the model sees.
				notes.delete(line.note.id)
				notes.set(line.note.id, line.note)
			}
		}
		return [...notes.values()]
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
			async add(text, now, by) {
				const said = oneLine(text)
				if (!isNote(said)) {
					return { kind: 'refused', problem: `A note is one line of 1 to ${NOTE_CHARS} characters.` }
				}
				const all = await kept()
				const index = all.findIndex((note) => sameWords(note.text, said))
				const earlier = all[index]
				if (!earlier || index < all.length - MAX_READ || (by === 'reader' && earlier.by !== by)) {
					await append({
						id: earlier?.id ?? randomUUID().slice(0, 8),
						text: said,
						at: now.toISOString(),
						by: by ?? earlier?.by,
					})
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
	return text !== '' && text.length <= NOTE_CHARS
}

// Every run of white space, line breaks of any kind among them, is one space: a note starts each question on one line.
function oneLine(text: string): string {
	return text.replaceAll(/\s+/g, ' ').trim()
}

function sameWords(a: string, b: string): boolean {
	return oneLine(a).toLowerCase() === oneLine(b).toLowerCase()
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
	const by = Reflect.get(value, 'by') === 'reader' ? { by: 'reader' as const } : {}
	return isNote(oneLine(text)) ? { kind: 'note', note: { id, text: oneLine(text), at, ...by } } : null
}

function emptyWhenMissing(error: unknown): string {
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
	throw error
}
