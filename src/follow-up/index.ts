// Following up, slice 6 of the plan: ken brings back to the owner what waits on them, worked out by plain code from the
// project record, the understanding map and git, so the list stands with no model. Two lenses look at the work from one
// side each, one person or one span of time, and write the question the agent then answers.
export { decide } from './decide.ts'
export {
	type LensFacts,
	type LensQuestion,
	openQuestion,
	type PartsLevel,
	partsQuestion,
	personLens,
	rangeLens,
	rangeQuestion,
	type TourLevel,
	topicQuestion,
	tourQuestion,
} from './lens-questions.ts'
export {
	type ChangeCommit,
	type ChangedTopic,
	type OpenDecision,
	type OpenItems,
	type OpenTopic,
	openItems,
} from './open-items.ts'
export { type Author, authorsOf, findAuthor, type PersonChanges, personChanges } from './person.ts'
export { type Since, type SinceChoice, sinceChoices, sinceOf, type TimeRange, timeRange } from './time-range.ts'
export { at, day, onDay, when } from './when.ts'
