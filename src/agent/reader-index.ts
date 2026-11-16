// What the model learns about its reader at the start of each question: the state of each topic the reader has met,
// from the understanding map. The system prompt says how deep to go for each state.
import { type MapRead, stateLine } from '../map/index.ts'

export function readerIndex(read: MapRead): string {
	const met = read.states.filter((state) => state.kind !== 'never-met')
	if (met.length === 0) return "The reader's understanding map is empty: they have met none of the record's topics."
	const changed = met.filter(
		(state) => state.kind === 'changed' || (state.kind === 'long-ago' && state.changed.length > 0),
	)
	return [
		"The reader's understanding map, topic by topic. A topic of the record that is not here is one they never met.",
		...met.map((state) => `- ${stateLine(state)}`),
		...(changed.length > 1 ? [`${changed.length} topics the reader understood have changed since.`] : []),
	].join('\n')
}
