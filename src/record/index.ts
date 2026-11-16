// The project record: what ken has learned about the code, the same for every reader. It holds pieces of work,
// decisions, topics and notes in .ken/record/, which the owner commits. No model writes it directly: every entry
// passes checkEntry, and the store only grows. Nothing here talks to a model.
export type { Label, Quote } from '../checks/index.ts'
export { type EntryDraft, sameName } from './check-entry.ts'
export { decisionWork } from './decision-work.ts'
export { describeEntry, entryLine } from './describe-entry.ts'
export type {
	Decision,
	Entry,
	EntryId,
	Kind,
	Logged,
	Note,
	RecordEntry,
	Statement,
	Topic,
	Undo,
	Who,
	Work,
} from './entry.ts'
export { UNDO } from './entry.ts'
export { fileRecordStore, type RecordRead, type RecordStore } from './file-record-store.ts'
export { codeHash, type Freshness, noteFreshness, type TopicCode, topicCode } from './note-freshness.ts'
export { whoDidIt } from './who-did-it.ts'
