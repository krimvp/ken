// What ken tells its reader, as checked data. Every statement carries a label from the plan and at least one quote
// that passed checkQuote. An answer about a change also carries the change facts, which ken reads from git and the
// model never supplies.
import type { ChangedHunk } from '../../checks/index.ts'
import type { Label, Statement } from '../../record/index.ts'
import type { Commit, CommitHash } from '../../repo/index.ts'

// The plan has four labels. "recorded" and "from-the-session" need decisions logged by coding agents and their
// saved transcripts, which arrive in slice 5, so until then a statement may carry only these two.
export const LABELS = ['inferred', 'found-by-search'] as const satisfies Label[]

export type Change = {
	base: CommitHash
	head: CommitHash
	commits: Commit[]
	covered: ChangedHunk[]
	uncovered: ChangedHunk[]
	binary: string[]
}

// change is null when the question was not about a range of commits.
export type Answer = { summary: string; statements: Statement[]; change: Change | null }
