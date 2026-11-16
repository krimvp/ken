// The plan's four labels, which let the reader tell a recorded fact from a guess. Every statement carries one, and so
// does every arrow, message and relation in a diagram. ken never takes "recorded" from a writer, and takes
// "from-the-session" only with a quote of a saved session to show for it. ken labels a decision itself, from its
// evidence, the strongest first: logged with ken decide, then a commit message, then a saved session, then inferred.
import type { CommitHash } from '../repo/index.ts'
import type { ChangedHunk } from './coverage-check.ts'
import type { Quote, VerifiedQuote } from './verify-quote.ts'

export type Label = 'recorded' | 'from-the-session' | 'inferred' | 'found-by-search'

const ALLOWED = ['inferred', 'found-by-search', 'from-the-session'] as const satisfies Label[]

export type LabelCheck = { kind: 'ok'; label: Label } | { kind: 'refused'; problem: string }

// quotes are the ones the statement sends with its label. Models write "Found by search" as often as
// "found-by-search", so case and spaces do not count.
export function checkLabel(raw: string, quotes: Quote[]): LabelCheck {
	const wanted = raw.trim().toLowerCase().replaceAll(' ', '-')
	const label = ALLOWED.find((known) => known === wanted)
	if (label === 'from-the-session' && !quotes.some((quote) => 'session' in quote)) {
		return {
			kind: 'refused',
			problem: `the label "${raw}" says the claim was read from a saved session, but none of its quotes is from one. Add the session's lines as a quote with session and text, or label it "inferred".`,
		}
	}
	if (label) return { kind: 'ok', label }
	if (wanted === 'recorded') {
		return {
			kind: 'refused',
			problem: `the label "${raw}" is for a decision written down when it was made, and ken sets it. Label a statement or a risk "inferred", "found-by-search" or "from-the-session".`,
		}
	}
	return {
		kind: 'refused',
		problem: `"${raw}" is not a label. Use "inferred", "found-by-search" or "from-the-session".`,
	}
}

// The quotes of the reason alone decide, not those that show what was chosen. A quote of a commit's subject line alone
// does not count: a subject says what the commit did, and the reason is in the body.
export function decisionLabel(reasonQuotes: VerifiedQuote[], logged: boolean): Exclude<Label, 'found-by-search'> {
	if (logged) return 'recorded'
	if (reasonQuotes.some((quote) => !('session' in quote) && quote.path === null && quote.endLine > 1)) return 'recorded'
	if (reasonQuotes.some((quote) => 'session' in quote)) return 'from-the-session'
	return 'inferred'
}

// A risk quotes code outside the change when one of its quotes holds, at the change's head, only lines the change did
// not touch. The reader sees "Quotes code outside the change" or "Quotes only the changed lines", and ken sets which
// from git, never the model. It says where the quote is, not whether the risk is true. A risk that quotes no file, only
// commit messages or a session, gets neither: undefined. hunks are all the change's hunks; their new lines are the
// touched ones.
export function quotesOutsideChange(
	quotes: VerifiedQuote[],
	head: CommitHash,
	hunks: ChangedHunk[],
): boolean | undefined {
	const files = quotes.flatMap((quote) =>
		'session' in quote || quote.path === null ? [] : [{ ...quote, path: quote.path }],
	)
	if (files.length === 0) return undefined
	const touched = (path: string, line: number) =>
		hunks.some(
			({ hunk, ...file }) => file.path === path && line >= hunk.newStart && line < hunk.newStart + hunk.newLength,
		)
	return files.some((quote) => {
		if (quote.commit !== head) return false
		for (let line = quote.startLine; line <= quote.endLine; line++) if (touched(quote.path, line)) return false
		return true
	})
}
