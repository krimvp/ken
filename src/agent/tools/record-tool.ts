// How the model reads the project record: an index at the start of every question, and one tool to list, search or
// read entries. The model never writes the record here; only an accepted answer does, through the answer tool.
import type { Tool } from 'aigent/plugin'
import { describeEntry, entryLine, type Kind, type RecordRead, type RecordStore } from '../../record/index.ts'
import type { Repository } from '../../repo/index.ts'
import { readArgs, refuse, reply } from './tool-edge.ts'

const KINDS = ['work', 'decision', 'topic', 'note'] as const satisfies Kind[]
const MAX_LISTED = 100
const MAX_INDEXED = 150

export function recordTool(store: RecordStore, repo: Repository): Tool {
	return {
		name: 'read_record',
		description: `Read the project record: the pieces of work, decisions, topics and notes that earlier answers stored. Give id to read one entry in full, with its quotes; a topic also shows its note and whether the note is still fresh. Otherwise it lists the newest entry of each chain, at most ${MAX_LISTED}, filtered by kind and by words in the entry.`,
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The id of one entry' },
				kind: { type: 'string', enum: KINDS },
				search: { type: 'string', description: 'Words to look for, in any case' },
			},
			additionalProperties: false,
		},
		async execute(args, ctx) {
			const read = readArgs(args, 'read_record')
			const record = await store.read()
			const id = read.optionalText('id')
			if (id !== undefined) {
				const entry = record.entries.find((other) => other.id === id)
				if (!entry) return refuse(`There is no entry ${id} in the record.`)
				return reply(await describeEntry(repo, record, entry, ctx.signal))
			}
			const kind = read.optionalText('kind')
			const words = read.optionalText('search')?.toLowerCase()
			const found = record.current.filter(
				(entry) =>
					(kind === undefined || entry.kind === kind) &&
					(words === undefined || JSON.stringify(entry).toLowerCase().includes(words)),
			)
			const shown = found.slice(0, MAX_LISTED).map(entryLine)
			const more = found.length > shown.length ? `\nShowing ${shown.length}. Narrow the search.` : ''
			return reply(`${found.length} entries:\n${shown.join('\n')}${more}`)
		},
	}
}

// Notes are left out: read a topic to see its note.
export function recordIndex(record: RecordRead): string {
	const listed = record.current.filter((entry) => entry.kind !== 'note')
	if (listed.length === 0) return 'The project record is empty.'
	const order = (kind: Kind) => KINDS.indexOf(kind)
	const sorted = [...listed].sort((a, b) => order(a.kind) - order(b.kind))
	const shown = sorted.slice(0, MAX_INDEXED).map(entryLine)
	const more =
		sorted.length > shown.length ? [`and ${sorted.length - shown.length} more; search with read_record.`] : []
	return ['The project record, newest entry of each chain. Read one in full with read_record.', ...shown, ...more].join(
		'\n',
	)
}
