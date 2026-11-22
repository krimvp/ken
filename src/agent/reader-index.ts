// What the model learns about its reader at the start of each question: the state of each topic the reader has met,
// from the understanding map, the reader notes, and how much text the reader chose to read. The system prompt says how
// deep to go for each state.
import { type MapRead, type Prefs, prefsLine, type ReaderNote, stateLine } from '../map/index.ts'

export function readerIndex(read: MapRead, notes: ReaderNote[], prefs: Prefs): string {
	const told = [...notesLines(notes), '', `How much text the reader chose: ${prefsLine(prefs)}`]
	const met = read.states.filter((state) => state.kind !== 'never-met')
	if (met.length === 0) {
		return ["The reader's understanding map is empty: they have met none of the record's topics.", ...told].join('\n')
	}
	const changed = met.filter(
		(state) => state.kind === 'changed' || (state.kind === 'long-ago' && state.changed.length > 0),
	)
	return [
		"The reader's understanding map, topic by topic. A topic of the record that is not here is one they never met.",
		...met.map((state) => `- ${stateLine(state)}`),
		...(changed.length > 1 ? [`${changed.length} topics the reader understood have changed since.`] : []),
		...told,
	].join('\n')
}

// A lens ken wrote holds its own rules for what to send, so it starts from the reader's notes alone.
export function readerNotes(notes: ReaderNote[]): string {
	return notesLines(notes).join('\n').trim()
}

function notesLines(notes: ReaderNote[]): string[] {
	if (notes.length === 0) return []
	return [
		'',
		'The notes ken keeps for the reader, written to them: "you" is the reader and "I" is ken. Follow these in every reply:',
		...notes.map((note) => `- ${note.text}`),
	]
}
