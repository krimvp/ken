// What the model learns about its reader at the start of each question: the state of each topic the reader has met,
// from the understanding map, the reader notes, and how much text the reader chose to read. The system prompt says how
// deep to go for each state.
import { type MapRead, type Prefs, prefsLine, type ReaderNote, stateLine } from '../map/index.ts'

export function readerIndex(read: MapRead, notes: ReaderNote[], prefs: Prefs): string {
	const told = [
		...(notes.length === 0
			? []
			: [
					'',
					"The reader's notes on what they know and how they want replies. A note from ken addresses the reader. A note from the reader uses their own words:",
					...notes.map((note) => `- ${note.by === 'reader' ? 'Reader' : 'ken'}: ${note.text}`),
				]),
		'',
		`How much text the reader chose: ${prefsLine(prefs)}`,
	]
	const met = read.states.filter((state) => state.kind !== 'never-met')
	if (met.length === 0) {
		return ['The reader has no recorded familiarity with the topics shown above.', ...told].join('\n')
	}
	const changed = met.filter(
		(state) => state.kind === 'changed' || (state.kind === 'long-ago' && state.changed.length > 0),
	)
	return [
		"The reader's understanding of the topics shown above. Read another topic with read_record to see its state.",
		...met.map((state) => `- ${stateLine(state)}`),
		...(changed.length > 1 ? [`${changed.length} topics the reader understood have changed since.`] : []),
		...told,
	].join('\n')
}
