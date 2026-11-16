// ken's chat engine and the only module that talks to a model. It starts an aigent session on one repository, the
// model explores with tools that only read, and each question streams events that end in an answer whose quotes all
// passed the quote check, or in a clear reason why there is none.
export type { Answer, Change, Risk } from './answer/answer.ts'
export type { ChatEvent, Cost, Outcome, Revision } from './chat-event.ts'
export {
	MODEL_EXAMPLE,
	type ModelConfig,
	type ModelFlags,
	type ModelUnset,
	readModelConfig,
} from './model-config.ts'
export { MAX_NOTE_ENTRIES, type NoteFacts, noteQuestion } from './note-question.ts'
export { type Chat, startChat } from './start-chat.ts'
