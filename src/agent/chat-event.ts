// What one question produces, in this order: text and tool calls while the model works, one "rejected" for each
// answer that failed a check, at most one "accepted", then "usage", then "done" or "error" as the last event.
// Plain data, so the terminal and a server can pass it on as it is.
import type { Decision, RecordEntry } from '../record/index.ts'
import type { Answer } from './answer/answer.ts'

// What the risk pass changed in the first answer. risks gives, for each risk of the final answer in its order, where it
// came from: its number in the first answer, kept as it was or rewritten, or added by the pass. decisions is how many
// decisions the pass added, at the end of their list. The risks it took out are kept with the answer (see Withdrawn).
export type Revision = {
	risks: ({ kind: 'kept' | 'rewritten'; was: number } | { kind: 'added' })[]
	decisions: number
}

export type Cost = { inputTokens: number; outputTokens: number; seconds: number }

export type ChatEvent =
	| { kind: 'text'; delta: string }
	// step is the call as one plain sentence for the reader, such as "Read `src/cli.ts`, lines 100 to 180".
	| { kind: 'tool'; name: string; step: string }
	| { kind: 'rejected'; attempt: number; problems: string[] }
	// recorded holds the entries this answer added to the project record; an entry already there is not repeated. draft
	// is set when the answer cites ken's snapshot of uncommitted work: nothing was recorded, and it holds the answer's
	// decisions as ken checked and labelled them, for the reader's history alone.
	// revision is null when there was no risk pass, or when nothing it sent passed and the first answer stands.
	| { kind: 'accepted'; answer: Answer; recorded: RecordEntry[]; draft: Decision[] | null; revision: Revision | null }
	// The whole question's cost. fromDraft is the part that turning the draft into the answer took, and riskPass the part
	// the risk pass took, each null when the question had no such step.
	| ({ kind: 'usage'; fromDraft: Cost | null; riskPass: Cost | null } & Cost)
	| { kind: 'done'; outcome: Outcome }
	| { kind: 'error'; message: string }

// "rejected": every answer the model sent failed a check, up to the limit, so there is no checked answer.
// "no-answer": the model stopped without sending an answer. "out-of-turns": it was still exploring at the turn limit.
export type Outcome = 'answered' | 'rejected' | 'no-answer' | 'out-of-turns'
