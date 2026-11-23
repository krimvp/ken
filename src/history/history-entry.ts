// One question the reader asked, or one note ken wrote in live mode, as it ended: what the model did, and its reply when
// there was one. The page reopens a reply from this without a model call, so an entry is plain data with no behaviour.
import type { ChatEvent, Outcome, QuestionFocus, Reply, Step } from '../agent/index.ts'
import type { About } from '../live/index.ts'
import type { EntryId } from '../record/index.ts'

export type Usage = { inputTokens: number; outputTokens: number; seconds: number }

// recorded names the project record entries the reply added; the record holds them, the history only points at them.
type BriefRetry =
	| { kind: 'answer'; concept: string; text: string; typed?: boolean }
	| { kind: 'explain'; within: string[]; part: string | null }

export type Ending =
	| { outcome: 'answered'; reply: Reply; recorded: EntryId[] }
	| { outcome: 'unverified'; reply: Reply; recorded: EntryId[] }
	| { outcome: 'partial'; reply: Reply; recorded: EntryId[]; retry?: BriefRetry }
	| { outcome: Exclude<Outcome, 'answered' | 'unverified' | 'partial' | 'incomplete'> | 'stopped' }
	| { outcome: 'incomplete'; retry?: BriefRetry }
	| { outcome: 'error'; error: string }

// head is the project's HEAD when the question was asked, so a reopened reply can say the project has moved on. thread
// is the chat it was asked in: entries with the same thread were asked of a model that remembered the earlier ones.
// Both are null in entries saved before ken kept them. about is there for a note ken wrote by itself in live mode: what
// the note explains. The question is then the one ken wrote for the model.
export type HistoryEntry = {
	id: string
	question: string
	askedAt: string
	head: string | null
	thread: string | null
	background?: true
	about?: About
	focus?: QuestionFocus
	after?: string | null
	steps: Step[]
	usage: Usage | null
} & Ending

// Jobs may finish after a later question. Catch-up starts when the reader asked, independent of completion order.
export function readerQuestions(entries: HistoryEntry[]): HistoryEntry[] {
	return entries
		.filter((entry) => !entry.background && entry.about === undefined)
		.sort((a, b) => a.askedAt.localeCompare(b.askedAt))
}

export type Asked = {
	id: string
	question: string
	askedAt: string
	head: string | null
	thread: string
	after?: string | null
	focus?: QuestionFocus
	about?: About
}

// Folds the events of one question into its entry. stopped says the reader stopped it before it ended.
export function entryFrom(asked: Asked, events: ChatEvent[], stopped: boolean): HistoryEntry {
	const steps: Step[] = []
	let usage: Usage | null = null
	let ending: Ending = { outcome: 'error', error: 'The question ended without a result.' }
	let replied: Extract<ChatEvent, { kind: 'replied' }> | null = null
	for (const event of events) {
		switch (event.kind) {
			case 'tool':
				steps.push({ kind: 'tool', text: event.step })
				break
			case 'step':
				steps.push(event.step)
				break
			case 'focus':
				asked = { ...asked, focus: event.focus }
				break
			case 'replied':
				replied = event
				break
			case 'usage':
				usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, seconds: event.seconds }
				break
			case 'done':
				if (event.outcome !== 'answered' && event.outcome !== 'unverified' && event.outcome !== 'partial')
					ending = { outcome: event.outcome }
				else if (replied)
					ending = { outcome: event.outcome, reply: replied.reply, recorded: replied.recorded.map((entry) => entry.id) }
				else ending = { outcome: 'no-answer' }
				break
			case 'error':
				ending = stopped ? { outcome: 'stopped' } : { outcome: 'error', error: event.message }
				break
			case 'text':
			case 'item':
			case 'change':
				break
			default:
				event satisfies never
		}
	}
	return { ...asked, steps, usage, ...ending }
}

// Why a live note has no reply, in one sentence for the reader, from what the entry ended in. null when it has one.
export function whyNoNote(entry: HistoryEntry): string | null {
	const none = 'so there is no note for this change.'
	switch (entry.outcome) {
		case 'answered':
			return null
		case 'unverified':
			return "ken's model gave no checked source for this reply."
		case 'partial':
			return "ken's model explained only some parts."
		case 'incomplete':
			return "ken's model did not give a brief with a checked point."
		case 'tool-proposal':
			return "ken's model only proposed actions. It gave no answer."
		case 'no-answer':
			return `ken's model stopped without writing a note, ${none}`
		case 'out-of-turns':
			return `ken's model ran out of turns before it wrote a note, ${none}`
		case 'stopped':
			return `The note was stopped before it ended, ${none}`
		case 'error':
			return `ken's model did not answer, ${none} What came back: ${entry.error}`
		default:
			return entry satisfies never
	}
}
