// How the model reads the project record: an index at the start of every question, and one tool to list, search or
// read entries. The model never writes the record here; only a reply does, through the cards it shows.
import type { Tool } from 'aigent/plugin'
import { stateLine, type UnderstandingMap } from '../../map/index.ts'
import {
	describeEntry,
	entryLine,
	type Kind,
	noteFreshness,
	type RecordEntry,
	type RecordRead,
	type RecordStore,
} from '../../record/index.ts'
import type { Repository } from '../../repo/index.ts'
import type { Asking } from '../reply/show-tool.ts'
import { readArgs, refuse, reply } from './tool-edge.ts'

const KINDS = ['work', 'decision', 'topic', 'note', 'layout'] as const satisfies Kind[]
const MAX_LISTED = 25
const MAX_INDEXED = 12

export function recordTool(store: RecordStore, repo: Repository, map?: UnderstandingMap): Tool {
	return {
		name: 'read_record',
		description: `Read the project record: the pieces of work, decisions, topics and notes that earlier replies stored. Give id to read one entry in full, with its quotes; a topic also shows its note and whether the note is still fresh. Otherwise it lists the newest entry of each chain, ${MAX_LISTED} per page, newest first, filtered by kind and by words in the entry.`,
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The id of one entry' },
				kind: { type: 'string', enum: KINDS },
				page: { type: 'integer', minimum: 1, description: 'The page of matches. Defaults to 1.' },
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
				const full = await describeEntry(repo, record, entry, ctx.signal)
				if (entry.kind !== 'topic' || !map) return reply(full)
				const read = await map.read(new Date(), ctx.signal, { record, names: [entry.name] })
				const state = read.states[0]
				return reply(state ? `${full}\nReader: ${stateLine(state)}` : full)
			}
			const kind = read.optionalText('kind')
			const words = read.optionalText('search')?.toLowerCase()
			const found = record.current.filter(
				(entry) =>
					(kind === undefined || entry.kind === kind) &&
					(words === undefined || JSON.stringify(entry).toLowerCase().includes(words)),
			)
			const page = read.optionalLine('page') ?? 1
			found.reverse().sort((a, b) => b.at.localeCompare(a.at))
			const shown = found.slice((page - 1) * MAX_LISTED, page * MAX_LISTED).map(entryLine)
			const more = page * MAX_LISTED < found.length ? `\nRead page ${page + 1} for more.` : ''
			return reply(`${found.length} entries:\n${shown.join('\n')}${more}`)
		},
	}
}

// A lens puts instructions and examples after the question. Match its subject, so those words cannot outrank it.
function focus(question: string, as: Asking): string {
	switch (as.kind) {
		case 'answer':
			return `${as.text} ${as.concept}`
		case 'explain':
			return as.tour.stops.flatMap((stop) => [stop.name, ...stop.paths]).join(' ')
		case 'view':
			return [as.text, ...as.within].join(' ')
		case 'change':
			return `${as.range.base.slice(0, 12)} ${as.range.head.slice(0, 12)}`
		default:
			return question
	}
}

function entrySubject(entry: Exclude<RecordEntry, { kind: 'note' }>): string {
	switch (entry.kind) {
		case 'work':
			return `${entry.title} ${entry.range.base.slice(0, 12)} ${entry.range.head.slice(0, 12)}`
		case 'topic':
			return `${entry.name} ${entry.quotes.map((quote) => quote.path).join(' ')}`
		case 'decision':
			return `${entry.question} ${entry.topic ?? ''}`
		case 'layout':
			return [...entry.within, ...entry.parts.map((part) => part.name)].join(' ')
	}
}

// Send a few names first. Read one matching note at HEAD so a follow-up can use it without a model tool call.
export async function recordIndex(
	record: RecordRead,
	question: string,
	as: Asking,
	repo: Repository,
	signal?: AbortSignal,
) {
	const words = new Set(
		focus(question, as)
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu),
	)
	const ranked = record.current
		.toReversed()
		.filter((entry) => entry.kind !== 'note')
		.map((entry) => {
			const line = entryLine(entry)
			const terms = new Set(`${entry.id} ${entrySubject(entry)}`.toLowerCase().match(/[\p{L}\p{N}]+/gu))
			const matches = [...terms].filter((word) => words.has(word)).length
			return { entry, line, matches }
		})
	ranked.sort((a, b) => b.matches - a.matches || b.entry.at.localeCompare(a.entry.at))
	const shown = ranked.slice(0, MAX_INDEXED)
	const topics = shown.flatMap(({ entry }) => (entry.kind === 'topic' ? [entry.name] : []))
	if (shown.length === 0) return { text: 'The project record is empty.', topics }
	const rows = [
		...partsIndex(record),
		`The project record has ${ranked.length} entries besides notes. These match the question or were saved recently. Search the rest with read_record.`,
		...shown.map(({ line }) => shortLine(line)),
	]
	const first = shown.find(({ entry, matches }) => entry.kind === 'topic' && matches > 0)?.entry
	if (first?.kind === 'topic') {
		const note = record.current.findLast((entry) => entry.kind === 'note' && entry.topic === first.id)
		if (note?.kind === 'note') {
			const freshness = await noteFreshness(repo, first, note, signal)
			rows.push(
				freshness.kind === 'fresh'
					? `Saved note for ${first.name}, checked at HEAD: ${note.text}`
					: `The saved note for ${first.name} is stale. Read the current code in ${freshness.changed.join(', ')}.`,
			)
		}
	}
	return { text: rows.join('\n'), topics }
}

// The top level of the project's layout as the reader sees it on the page, so the model speaks in the reader's part
// names. The newest named level of the whole project, one line per part.
function partsIndex(record: RecordRead): string[] {
	const top = record.current.findLast((entry) => entry.kind === 'layout' && entry.within.length === 0)
	if (top?.kind !== 'layout') return []
	return [
		"The project's main parts, as the reader sees them. Use these names when you talk about the parts:",
		...top.parts.map((part) =>
			shortLine(`- ${part.name} (${part.places.map((place) => place.path).join(', ')}): ${part.job}`),
		),
		'',
	]
}

function shortLine(line: string): string {
	return line.length > 300 ? `${line.slice(0, 297)}...` : line
}
