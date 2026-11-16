// The plan's four labels, which let the reader tell a recorded fact from a guess. Every statement carries one, and so
// does every arrow, message and relation in a diagram. A statement or a risk is "inferred" or "found-by-search". ken
// labels a decision itself, from its evidence: "recorded" needs its reason quoted from a commit message, which was
// written with the work. "from-the-session" needs saved transcripts, which arrive in slice 5.
import type { VerifiedQuote } from './quote-check.ts'

export type Label = 'recorded' | 'from-the-session' | 'inferred' | 'found-by-search'

const ALLOWED = ['inferred', 'found-by-search'] as const satisfies Label[]

export type LabelCheck = { kind: 'ok'; label: Label } | { kind: 'refused'; problem: string }

// Models write "Found by search" as often as "found-by-search", so case and spaces do not count.
export function checkLabel(raw: string): LabelCheck {
	const wanted = raw.trim().toLowerCase().replaceAll(' ', '-')
	const label = ALLOWED.find((known) => known === wanted)
	if (label) return { kind: 'ok', label }
	if (wanted === 'recorded' || wanted === 'from-the-session') {
		return {
			kind: 'refused',
			problem: `the label "${raw}" is for a decision whose reason is quoted from a commit message, and ken sets it. Label a statement or a risk "inferred" or "found-by-search".`,
		}
	}
	return { kind: 'refused', problem: `"${raw}" is not a label. Use "inferred" or "found-by-search".` }
}

// The quotes of the reason alone decide, not those that show what was chosen. A quote of the subject line alone does
// not count: a subject says what the commit did, and the reason is in the body.
export function decisionLabel(reasonQuotes: VerifiedQuote[]): 'recorded' | 'inferred' {
	return reasonQuotes.some((quote) => quote.path === null && quote.endLine > 1) ? 'recorded' : 'inferred'
}
