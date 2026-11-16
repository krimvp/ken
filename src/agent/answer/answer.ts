// What ken tells its reader, as checked data. Every statement and every risk carries a label from the plan and at
// least one quote that passed checkQuote, and so does every arrow, message and relation in its diagrams. An answer
// about a change also carries the change facts, which ken reads from git and the model never supplies.
import type { Absence, ChangedHunk, Followed, MessageCount, VerifiedQuote } from '../../checks/index.ts'
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
// this reader already knows. A claim that belongs to no topic has none. absent is ken's search for the text a claim says
// is missing, which found nothing; only a claim that says so has it.
export type Claim = Statement & { topic?: string; absent?: Absence }

// checked is ken's own mark on a risk of an answer about a change, set from git by quotesOutsideChange: true when a
// quote lies wholly outside the change. A risk saved before ken set it, one that quotes no file, or one in an answer
// about no change, has none. fixedIn is the later commit, after the change's head, whose message the risk quotes: the
// project fixed it since. ken sets it from git, and the reader sees open risks first.
// weight is the model's own (see WEIGHT_RULE): "serious" when someone is hurt in normal use, "minor" otherwise. ken does
// not judge it, and a risk saved before ken asked for it has none.
export const WEIGHTS = ['serious', 'minor'] as const
export type Weight = (typeof WEIGHTS)[number]
export type Risk = Claim & { checked?: boolean; weight?: Weight; fixedIn?: CommitHash }

// A risk the second look took out, with its reason and the lines that make it false: code at the change's head commit
// or a line of a later commit's message. ken checked those lines as it checks every quote. A judge found that two
// risks withdrawn on a sentence alone were the two the project later had to fix.
export type Withdrawn = { risk: Risk; reason: string; proof: VerifiedQuote[] }

// A risk has the shape of a statement: a claim about what could go wrong or what the owner should watch, with the
// lines it starts from. topics names every topic the answer names: those it sends and those its claims and decisions
// belong to. They are the topics the reader's three buttons act on. risks is null when the answer says nothing about risks, as for a question about how a part
// works or an answer saved before ken asked for them; an empty list means the agent looked and found none. change is
// null when the question was not about a range of commits. leftOut counts the points of the model's draft that it
// found no line to quote for and left out, and leftOutPoints names them in the model's words, which ken does not
// check; only an answer made from a draft has them, and one saved before ken kept the names has only the count.
// withdrawn holds what the second look took out; only an answer it revised has it. secondLook says why an answer that
// was held for the second look shows as ken first checked it: the look sent no change that passed, it did not run, or
// it was not asked for because the record already explains the change.
export type Answer = {
	summary: string
	statements: Claim[]
	risks: Risk[] | null
	topics: string[]
	diagrams: Diagram[]
	change: Change | null
	leftOut?: number
	leftOutPoints?: string[]
	withdrawn?: Withdrawn[]
	secondLook?: 'unchanged' | 'not-run' | 'explained'
}
