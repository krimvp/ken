// The plan's four labels, which let the reader tell a recorded fact from a guess. Every statement carries one, and so
// does every arrow, message and relation in a diagram. "recorded" and "from-the-session" need decisions logged by
// coding agents and their saved transcripts, which arrive in slice 5, so until then a claim may carry only two.
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
			problem: `the label "${raw}" is for a decision someone logged when they made it, and ken has no logged decisions yet. Use "inferred".`,
		}
	}
	return { kind: 'refused', problem: `"${raw}" is not a label. Use "inferred" or "found-by-search".` }
}
