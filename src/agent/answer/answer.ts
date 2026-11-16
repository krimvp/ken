// What ken tells its reader, as checked data. Every statement and every risk carries a label from the plan and at
// least one quote that passed checkQuote, and so does every arrow, message and relation in its diagrams. An answer
// about a change also carries the change facts, which ken reads from git and the model never supplies.
import type { ChangedHunk, MessageCount } from '../../checks/index.ts'
import type { Diagram } from '../../diagram/index.ts'
import type { Statement } from '../../record/index.ts'
import type { Commit, CommitHash } from '../../repo/index.ts'

export type Change = {
	base: CommitHash
	head: CommitHash
	commits: Commit[]
	covered: ChangedHunk[]
	uncovered: ChangedHunk[]
	binary: string[]
	// The commits whose message a quote in the answer cites, and the others. null in a change saved before ken counted.
	messages: MessageCount | null
}

// A risk has the shape of a statement: a claim about what could go wrong or what the owner should watch, with the
// lines it starts from. risks is null when the answer says nothing about risks, as for a question about how a part
// works or an answer saved before ken asked for them; an empty list means the agent looked and found none. change is
// null when the question was not about a range of commits.
export type Answer = {
	summary: string
	statements: Statement[]
	risks: Statement[] | null
	diagrams: Diagram[]
	change: Change | null
}
