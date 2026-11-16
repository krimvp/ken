// The deterministic checks on an answer. A quote must exist in its file, or in its commit's message, at its commit, or
// in a message of a saved session; a label must be one this slice allows; and an answer about a range of commits must
// quote every hunk the range changed and says which commit messages it left unquoted. No model takes part, so the same
// answer always gets the same result.
export { type ChangedHunk, type Coverage, checkCoverage } from './coverage-check.ts'
export { checkLabel, decisionLabel, type Label, type LabelCheck } from './label-check.ts'
export { countMessages, type MessageCount } from './message-count.ts'
export { checkQuote, type GitQuote, type QuoteCheck, type VerifiedGitQuote } from './quote-check.ts'
export {
	checkSessionQuote,
	type SessionQuote,
	type SessionQuoteCheck,
	type VerifiedSessionQuote,
} from './session-quote-check.ts'
export {
	gitQuotes,
	type Quote,
	type QuoteSources,
	type QuoteVerdict,
	type VerifiedQuote,
	verifyGitQuote,
	verifyQuote,
} from './verify-quote.ts'
