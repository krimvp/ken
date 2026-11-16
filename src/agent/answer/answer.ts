// What ken tells its reader, as checked data. Every statement and every risk carries a label from the plan and at
// least one quote that passed checkQuote, and so does every arrow, message and relation in its diagrams. An answer
// about a change also carries the change facts, which ken reads from git and the model never supplies.
import type { ChangedHunk, Followed, MessageCount } from '../../checks/index.ts'
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
	// The names the change touched that ken found used elsewhere by search, split by whether a quote of the answer holds
	// one of their places. null in a change saved before ken looked, or too large to search.
	usedElsewhere: Followed | null
}

// A statement or a risk. topic names the topic it belongs to, as the project record names it, so the page can fold what
// this reader already knows. A claim that belongs to no topic has none.
export type Claim = Statement & { topic?: string }

// checked is ken's own mark on a risk of an answer about a change, set from git by checkedInCode. A risk saved before
// ken set it, or one in an answer about no change, has none.
export type Risk = Claim & { checked?: boolean }

// A risk has the shape of a statement: a claim about what could go wrong or what the owner should watch, with the
// lines it starts from. topics names every topic the answer names: those it sends and those its claims and decisions
// belong to. They are the topics the reader's three buttons act on. risks is null when the answer says nothing about risks, as for a question about how a part
// works or an answer saved before ken asked for them; an empty list means the agent looked and found none. change is
// null when the question was not about a range of commits.
export type Answer = {
	summary: string
	statements: Claim[]
	risks: Risk[] | null
	topics: string[]
	diagrams: Diagram[]
	change: Change | null
}
