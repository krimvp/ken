// What each way of asking gets: its tools, the fields of show it may send, its system prompt, and whether it follows
// up on the record and the thread. Every question runs in a session of its own and finds the thread again through
// excerpts and the memory tools (see tools/memory-tool.ts). A question in the reader's words, a live note and a change
// get every tool. A lens ken wrote itself carries all it needs in its question, so it gets only what it uses: every
// request sends the tools and the prompt again, and a brief sent 16 tools and the whole show schema for the 5 tools
// and the one field it used.
import type { Asking, ShowField } from '../reply/show-tool.ts'
import { lensPrompt } from '../system-prompt.ts'
import type { MemoryTool } from '../tools/memory-tool.ts'

// tools are the tools it reads with, by name. Every lens has show as well, with only the fields in show. A follow-up
// starts, as a question in the reader's words does, with the record entries that match it, the reader's map of their
// topics, and excerpts of the last answers in this chat.
export type Lens = { tools: readonly string[]; show: readonly ShowField[]; systemPrompt: string; followUp: boolean }

const READS = ['read_file', 'list_files', 'search']

// A part's brief and the parts of a level are saved and shown again in any later chat, so they come from the code
// alone. A brief of a top part gets the level it stands in from memory, which its question already sums up. One
// deeper down, and the parts inside a part, also ask memory what the brief above them said and what quotes their
// files. A question about a concept is a follow-up, which may build on what this reader was told.
const BRIEF: Lens = {
	tools: [...READS, 'memory_level'],
	show: ['brief'],
	systemPrompt: lensPrompt('brief', ['memory_level']),
	followUp: false,
}
const DEEP: MemoryTool[] = ['memory_known', 'memory_level', 'memory_quoted_in']
const INNER_BRIEF: Lens = { ...BRIEF, tools: [...READS, ...DEEP], systemPrompt: lensPrompt('brief', DEEP) }
const ASKED: MemoryTool[] = ['memory_known', 'memory_quoted_in', 'memory_search']
const ANSWER: Lens = {
	tools: [...READS, ...ASKED],
	show: ['brief'],
	systemPrompt: lensPrompt('answer', ASKED),
	followUp: true,
}
// The reader's own words may say how they want to be answered, so ken may keep a note of it.
const TYPED_ANSWER: Lens = {
	...ANSWER,
	tools: [...ANSWER.tools, 'remember'],
	systemPrompt: lensPrompt('typed', ASKED),
}
const PARTS: Lens = { tools: READS, show: ['layout', 'views'], systemPrompt: lensPrompt('layout', []), followUp: false }
const INSIDE: MemoryTool[] = ['memory_known', 'memory_quoted_in']
const INNER_PARTS: Lens = { ...PARTS, tools: [...READS, ...INSIDE], systemPrompt: lensPrompt('layout', INSIDE) }
const VIEWS: Lens = { tools: READS, show: ['views'], systemPrompt: lensPrompt('layout', []), followUp: false }

// The most lines of files a run may read in all, said in its question and kept by read_file. A brief of one part read
// 1,493 lines to quote 36; with the outline of its files, a part's brief needs the few ranges where the work happens.
// Naming the parts was the heaviest run left, at about 232,000 input, with no outline and no cap.
const READ_PER_PART = 800
const READ_FOR_ANSWER = 600
const READ_FOR_PARTS = 1500
const READ_FOR_INNER_PARTS = 800

export function readLimit(as: Asking): number | null {
	if (as.kind === 'explain') return READ_PER_PART * as.tour.stops.length
	if (as.kind === 'answer') return READ_FOR_ANSWER
	if (as.kind === 'parts') return as.within.length === 0 ? READ_FOR_PARTS : READ_FOR_INNER_PARTS
	return null
}

// The parts a run is about, whose files plain code outlines for it.
export function briefParts(as: Asking): { name: string; paths: string[] }[] {
	if (as.kind === 'explain') return as.tour.stops
	if (as.kind === 'answer') return as.paths.length > 0 ? [{ name: as.concept, paths: as.paths }] : []
	if (as.kind === 'parts') return as.parts
	return []
}

// null: every tool and the whole system prompt.
export function lensOf(as: Asking): Lens | null {
	switch (as.kind) {
		case 'explain':
			return as.tour.within.length === 0 ? BRIEF : INNER_BRIEF
		case 'answer':
			return as.typed ? TYPED_ANSWER : ANSWER
		case 'parts':
			return as.within.length === 0 ? PARTS : INNER_PARTS
		case 'views':
			return VIEWS
		case 'question':
		case 'note':
		case 'change':
		case 'view':
			return null
		default:
			return as satisfies never
	}
}
