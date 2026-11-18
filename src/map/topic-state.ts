// The state of a topic for this reader, from the newest map line and the topic's code at HEAD: the rows of the plan's
// table on how deep an answer goes. Understood means the reader said so or wrote the code; a question is interest,
// not understanding. The hash replaces a "since last time" cursor: the code changed when today's hash is not the one
// the line kept, whoever changed it and whenever.
import type { Topic, TopicCode } from '../record/index.ts'
import type { Depth, Evidence, MapEntry } from './map-entry.ts'

// After this many days ken gives a short reminder before anything else, changed or not.
export const LONG_AGO_DAYS = 30

export type QuotedLines = { path: string; startLine: number; endLine: number }

// hash is the topic's hash at HEAD now, which a line typed by hand needs. changed holds the quoted lines the reader
// knew that are no longer the same, as the record quotes them.
export type TopicState = { topic: string; hash: string } & (
	| { kind: 'never-met' }
	| { kind: 'met'; entry: MapEntry }
	| { kind: 'unchanged'; entry: MapEntry }
	| { kind: 'changed'; entry: MapEntry; changed: QuotedLines[] }
	| { kind: 'long-ago'; entry: MapEntry; changed: QuotedLines[] }
)

const UNDERSTOOD: Evidence[] = ['said', 'wrote']
const DAY_MS = 86_400_000

// knewGone holds the quotes of the topic as the reader knew it that are gone at HEAD, when the record has been given a
// newer version of the topic since.
export function stateOf(
	topic: Topic,
	entry: MapEntry | undefined,
	code: TopicCode,
	now: Date,
	knewGone: Topic['quotes'] = [],
): TopicState {
	const known = { topic: topic.name, hash: code.hash }
	if (entry === undefined) return { kind: 'never-met', ...known }
	if (!UNDERSTOOD.includes(entry.evidence)) return { kind: 'met', ...known, entry }
	// The changed lines are the quotes the reader knew that are gone, then the topic's own quotes that are gone. When
	// ken cannot tell which lines the reader knew, all of the topic's lines count as changed.
	const lines =
		code.hash === entry.hash ? [] : ([knewGone, code.gone, topic.quotes].find((list) => list.length > 0) ?? [])
	const changed = lines.flatMap(({ path, startLine, endLine }) => (path === null ? [] : [{ path, startLine, endLine }]))
	if (now.getTime() - Date.parse(entry.date) > LONG_AGO_DAYS * DAY_MS) {
		return { kind: 'long-ago', ...known, entry, changed }
	}
	return changed.length === 0 ? { kind: 'unchanged', ...known, entry } : { kind: 'changed', ...known, entry, changed }
}

const DEPTH_WORDS: Record<Depth, string> = {
	'heard-of': 'has heard of it',
	'can-follow': 'can follow it',
	'could-change': 'could change it',
}
const EVIDENCE_WORDS: Record<Evidence, string> = {
	asked: 'asked about it',
	read: 'read an answer on it and found it too much',
	said: 'said "I know this"',
	wrote: 'wrote it by hand',
	forgot: 'said they do not know it any more',
	toured: 'met it on a tour of the project',
}

// One line per topic in plain words, for the terminal and for the model.
export function stateLine(state: TopicState): string {
	if (state.kind === 'never-met') return `${state.topic}: never met`
	const { depth, evidence, date } = state.entry
	const known = `${state.topic}: ${DEPTH_WORDS[depth]}, ${EVIDENCE_WORDS[evidence]} on ${date}`
	const lines = (changed: QuotedLines[]) => changed.map(linesText).join(', ')
	switch (state.kind) {
		case 'met':
			return `${known}; not understood yet`
		case 'unchanged':
			return `${known}; understood, and the code is unchanged since`
		case 'changed':
			return `${known}; understood, and the code changed since: ${lines(state.changed)}`
		case 'long-ago':
			return state.changed.length === 0
				? `${known}; understood long ago, and the code is unchanged since`
				: `${known}; understood long ago, and the code changed since: ${lines(state.changed)}`
		default:
			return state satisfies never
	}
}

export function linesText({ path, startLine, endLine }: QuotedLines): string {
	return startLine === endLine ? `${path} line ${startLine}` : `${path} lines ${startLine} to ${endLine}`
}
