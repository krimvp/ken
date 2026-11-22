// ken's chat engine and the only module that talks to a model. It starts an aigent session on one repository, the
// model explores with tools that only read, and each question streams events: the model's own words, and the cards it
// shows, each of which passed the quote check before the reader sees it.
export type { ChatEvent, Cost, Outcome, Step } from './chat-event.ts'
export {
	MODEL_EXAMPLE,
	type ModelConfig,
	type ModelFlags,
	type ModelUnset,
	readModelConfig,
} from './model-config.ts'
export { type NoteFacts, noteQuestion } from './note-question.ts'
export { changedHunks } from './reply/check-card.ts'
export {
	CARD_KINDS,
	type Card,
	type CardKind,
	type Change,
	type Claim,
	firstWords,
	type Item,
	type Reply,
	type Risk,
	type Tour,
	type TourStop,
	WANTS,
	type Want,
	type Withdrawn,
} from './reply/reply.ts'
export { type Asking, TOUR_WORDS } from './reply/show-tool.ts'
export { type Chat, startChat } from './start-chat.ts'
