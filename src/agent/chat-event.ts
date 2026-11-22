// What one question produces, in this order: text while the model types, a tool line for each call, a step for each
// working turn and each card ken sent back, the change the reply is about once the model names it, an item for each part of the reply as its turn ends, at most one
// "replied" with the whole reply as it is saved, then "usage", then "done" or "error" as the last event. Plain data,
// so the terminal and a server can pass it on as it is.
import type { RecordEntry } from '../record/index.ts'
import type { Commit, CommitHash } from '../repo/index.ts'
import type { Item, Reply } from './reply/reply.ts'

// What happened while the model worked, behind "Show the steps". "tool" is one call as a sentence, "text" is what the
// model wrote in a turn that read the project, and "sent-back" is a card ken's checks refused, with why.
export type Step =
	| { kind: 'tool'; text: string }
	| { kind: 'text'; text: string }
	| { kind: 'sent-back'; what: string; problems: string[] }

export type Cost = { inputTokens: number; outputTokens: number; seconds: number }

export type ChatEvent =
	// Live only: the model's text as it types. When its turn ends, ken files that text as a step or as words of the reply.
	| { kind: 'text'; delta: string }
	// step is the call as one plain sentence for the reader, such as "Read `src/cli.ts`, lines 100 to 180".
	| { kind: 'tool'; name: string; step: string }
	| { kind: 'step'; step: Step }
	| { kind: 'item'; item: Item }
	// Live only: the change the reply is about, as soon as the model names it, so the page can lead the reply with it.
	// The reply's own change, in "replied", says the same and more.
	| { kind: 'change'; base: CommitHash; head: CommitHash; commits: Commit[] }
	// recorded holds the entries the reply added to the project record; an entry already there is not repeated.
	| { kind: 'replied'; reply: Reply; recorded: RecordEntry[] }
	// The whole question's cost. secondLook is the part the second look at risks took, null when it did not run.
	| ({ kind: 'usage'; secondLook: Cost | null } & Cost)
	| { kind: 'done'; outcome: Outcome }
	// model is true when the model refused or failed the request, so asking again later may work.
	| { kind: 'error'; message: string; model?: true }

// "no-answer": the model wrote nothing and showed nothing. "out-of-turns": it was still reading at the turn limit.
export type Outcome = 'answered' | 'no-answer' | 'out-of-turns'
