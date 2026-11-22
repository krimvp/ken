// What each way of asking gets: its tools, the fields of show it may send, its system prompt, and whether it follows
// up on the record and the thread. Every question runs in a session of its own and finds the thread again through
// excerpts and recall_chat (see reply/thread-memory.ts). A question in the reader's words, a live note and a change
// get every tool. A lens ken wrote itself carries all it needs in its question, so it gets only what it uses: every
// request sends the tools and the prompt again, and a brief sent 16 tools and the whole show schema for the 5 tools
// and the one field it used.
import type { Asking, ShowField } from '../reply/show-tool.ts'
import { ANSWER_PROMPT, BRIEF_PROMPT, LAYOUT_PROMPT, TYPED_ANSWER_PROMPT } from '../system-prompt.ts'

// tools are the tools it reads with, by name. Every lens has show as well, with only the fields in show. A follow-up
// starts, as a question in the reader's words does, with the record entries that match it, the reader's map of their
// topics, and excerpts of the last answers in this chat.
export type Lens = { tools: readonly string[]; show: readonly ShowField[]; systemPrompt: string; followUp: boolean }

const READS = ['read_file', 'list_files', 'search']

// A part's brief and the parts of a level are saved and shown again in any later chat, so they come from the code
// alone. A question about a concept is a follow-up, which may build on what this reader was told.
const BRIEF: Lens = { tools: READS, show: ['brief'], systemPrompt: BRIEF_PROMPT, followUp: false }
const ANSWER: Lens = {
	tools: [...READS, 'read_record', 'recall_chat'],
	show: ['brief'],
	systemPrompt: ANSWER_PROMPT,
	followUp: true,
}
// The reader's own words may say how they want to be answered, so ken may keep a note of it.
const TYPED_ANSWER: Lens = {
	...ANSWER,
	tools: [...ANSWER.tools, 'remember'],
	systemPrompt: TYPED_ANSWER_PROMPT,
}
const PARTS: Lens = { tools: READS, show: ['layout', 'views'], systemPrompt: LAYOUT_PROMPT, followUp: false }
const VIEWS: Lens = { tools: READS, show: ['views'], systemPrompt: LAYOUT_PROMPT, followUp: false }

// The most lines of files a brief may read in all, said in its question and kept by read_file. A brief of one part read
// 1,493 lines to quote 36; with the outline of its files, a part's brief needs the few ranges where the work happens.
const READ_PER_PART = 800
const READ_FOR_ANSWER = 600

export function readLimit(as: Asking): number | null {
	if (as.kind === 'explain') return READ_PER_PART * as.tour.stops.length
	if (as.kind === 'answer') return READ_FOR_ANSWER
	return null
}

// The parts a brief is about, whose files plain code outlines for it.
export function briefParts(as: Asking): { name: string; paths: string[] }[] {
	if (as.kind === 'explain') return as.tour.stops
	if (as.kind === 'answer') return as.paths.length > 0 ? [{ name: as.concept, paths: as.paths }] : []
	return []
}

// null: every tool and the whole system prompt.
export function lensOf(as: Asking): Lens | null {
	switch (as.kind) {
		case 'explain':
			return BRIEF
		case 'answer':
			return as.typed ? TYPED_ANSWER : ANSWER
		case 'parts':
			return PARTS
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
