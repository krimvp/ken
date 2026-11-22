// What the model learns about its reader at the start of each question: the state of each topic the reader has met,
// from the understanding map, and the reader notes. The system prompt says how deep to go for each state.
import { type MapRead, type ReaderNote, stateLine } from '../map/index.ts'

export function readerIndex(read: MapRead, notes: ReaderNote[]): string {
	const told =
		notes.length === 0
			? []
			: [
					'',
					'What the reader told ken about how they want things shown. Follow these in every reply:',
					...notes.map((note) => `- ${note.text}`),
				]
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
