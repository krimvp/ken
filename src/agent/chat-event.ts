// What one question produces, in this order: text and tool calls while the model works, one "rejected" for each
// answer that failed a check, at most one "accepted", then "usage", then "done" or "error" as the last event.
// Plain data, so the terminal and a server can pass it on as it is.
import type { RecordEntry } from '../record/index.ts'
import type { Answer } from './answer/answer.ts'

export type ChatEvent =
	| { kind: 'text'; delta: string }
	| { kind: 'tool'; name: string; summary: string }
	| { kind: 'rejected'; attempt: number; problems: string[] }
	// recorded holds the entries this answer added to the project record; an entry already there is not repeated.
	| { kind: 'accepted'; answer: Answer; recorded: RecordEntry[] }
	| { kind: 'usage'; inputTokens: number; outputTokens: number; seconds: number }
	| { kind: 'done'; outcome: Outcome }
	| { kind: 'error'; message: string }

// "rejected": every answer the model sent failed a check, up to the limit, so there is no checked answer.
// "no-answer": the model stopped without sending an answer. "out-of-turns": it was still exploring at the turn limit.
export type Outcome = 'answered' | 'rejected' | 'no-answer' | 'out-of-turns'
