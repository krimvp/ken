// What each way of asking gets: its tools, the fields of show it may send, and its system prompt. A question in the
// reader's words, a live note and a change get everything, in the chat's own session, which remembers the thread. A
// lens ken wrote itself carries all it needs in its question, so it runs in a session of its own with only what it
// uses: every request sends the tools and the prompt again, and a brief sent 16 tools and the whole show schema for
// the 5 tools and the one field it used.
import type { Asking, ShowField } from '../reply/show-tool.ts'
import { BRIEF_PROMPT, LAYOUT_PROMPT } from '../system-prompt.ts'

// tools are the reading tools, by name. Every lens has show as well, with only the fields in show.
export type Lens = { tools: readonly string[]; show: readonly ShowField[]; systemPrompt: string }

const READS = ['read_file', 'list_files', 'search']

const BRIEF: Lens = { tools: READS, show: ['brief'], systemPrompt: BRIEF_PROMPT }
const PARTS: Lens = { tools: READS, show: ['layout', 'views'], systemPrompt: LAYOUT_PROMPT }
const VIEWS: Lens = { tools: READS, show: ['views'], systemPrompt: LAYOUT_PROMPT }

// The most lines of files a brief may read in all, said in its question and kept by read_file. A brief of one part read
// 1,493 lines to quote 36; with the outline of its files, a part's brief needs the few ranges where the work happens.
const READ_PER_PART = 800
const READ_FOR_ANSWER = 600

export function readLimit(as: Asking): number | null {
	if (as.kind === 'explain') return READ_PER_PART * as.tour.stops.length
	if (as.kind === 'answer') return READ_FOR_ANSWER
	return null
}

// The paths a brief is about, whose files plain code outlines for it.
export function briefPaths(as: Asking): string[] {
	if (as.kind === 'explain') return as.tour.stops.flatMap((stop) => stop.paths)
	if (as.kind === 'answer') return as.paths
	return []
}

// null: the chat's own session.
export function lensOf(as: Asking): Lens | null {
	switch (as.kind) {
		case 'explain':
		case 'answer':
			return BRIEF
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
