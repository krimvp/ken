// One question the reader asked on the page, as it ended: what the agent did, what ken sent back, and the checked answer
// when there was one. The page reopens an answer from this without a model call, and the understanding map (slice 4)
// will be built from these entries, so an entry is plain data with no behaviour.
import type { Answer, ChatEvent, Outcome } from '../agent/index.ts'
import type { About } from '../live/index.ts'
import type { Decision, EntryId } from '../record/index.ts'

// What happened while the question ran, in order. "tool" is one call as a sentence, "text" is what the agent wrote
// between calls, and "rejected" is an answer ken's checks sent back.
export type Step =
	| { kind: 'tool'; text: string }
	| { kind: 'text'; text: string }
	| { kind: 'rejected'; attempt: number; problems: string[] }

export type Usage = { inputTokens: number; outputTokens: number; seconds: number }

// note is what the agent wrote after ken accepted its answer. recorded names the project record entries the answer
// added; the record holds them, the reader's history only points at them. draft is there when the answer cites ken's
// snapshot of uncommitted work: the record has nothing of it, so the history keeps its decisions whole.
export type Ending =
	| { outcome: 'answered'; answer: Answer; recorded: EntryId[]; note: string; draft?: Decision[] }
	| { outcome: Exclude<Outcome, 'answered'> | 'stopped' }
	| { outcome: 'error'; error: string }

// head is the project's HEAD when the question was asked, so a reopened answer can say the project has moved on. It is
// null in entries saved before ken kept it. about is there for a note ken wrote by itself in live mode: what the note
// explains. The question is then the one ken wrote for the agent.
export type HistoryEntry = {
	id: string
	question: string
	askedAt: string
	head: string | null
	about?: About
	steps: Step[]
	usage: Usage | null
} & Ending

// Folds the events of one question into its entry. stopped says the reader stopped it before it ended.
export function entryFrom(
	asked: { id: string; question: string; askedAt: string; head: string | null; about?: About },
	events: ChatEvent[],
	stopped: boolean,
): HistoryEntry {
	const steps: Step[] = []
	let usage: Usage | null = null
	let accepted: Extract<ChatEvent, { kind: 'accepted' }> | null = null
	let note = ''
	let ending: Ending = { outcome: 'error', error: 'The question ended without a result.' }
	for (const event of events) {
		switch (event.kind) {
			case 'text': {
				if (accepted) {
					note += event.delta
					break
				}
				const last = steps.at(-1)
				if (last?.kind === 'text') last.text += event.delta
				else steps.push({ kind: 'text', text: event.delta })
				break
			}
			case 'tool':
				steps.push({ kind: 'tool', text: event.step })
				break
			case 'rejected':
				steps.push({ kind: 'rejected', attempt: event.attempt, problems: event.problems })
				break
			case 'accepted':
				accepted = event
				break
			case 'usage':
				usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, seconds: event.seconds }
				break
			case 'done':
				if (event.outcome !== 'answered') ending = { outcome: event.outcome }
				break
			case 'error':
				ending = stopped ? { outcome: 'stopped' } : { outcome: 'error', error: event.message }
				break
			default:
				event satisfies never
		}
	}
	if (accepted) {
		const recorded = accepted.recorded.map((entry) => entry.id)
		const draft = accepted.draft ? { draft: accepted.draft } : {}
		ending = { outcome: 'answered', answer: accepted.answer, recorded, note: note.trim(), ...draft }
	}
	return { ...asked, steps, usage, ...ending }
}
