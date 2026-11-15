// The deterministic checks on an answer. A quote must exist in its file at its commit, a label must be one this slice
// allows, and an answer about a range of commits must quote every hunk the range changed. No model takes part, so the
// same answer always gets the same result.
export { type ChangedHunk, type Coverage, checkCoverage } from './coverage-check.ts'
export { explainQuote } from './explain-quote.ts'
export { checkLabel, type Label, type LabelCheck } from './label-check.ts'
export { checkQuote, type Quote, type QuoteCheck, type VerifiedQuote } from './quote-check.ts'
