// The understanding map: what this one reader understands, topic by topic. It is personal, so it lives in the reader's
// home beside the history and never in the project. It is a plain file the reader can open and correct, one small
// JSON object per line, because ken will sometimes judge the reader wrong. Three files sit beside it: the reader notes,
// what the reader told ken about how they want things shown, the lines on what the reader looked at, and how much
// text they want. From those lines and the map's topics, the map also says what ken thinks the reader knows of a part.
// Nothing here talks to a model.

export { type MapRead, type OwnTopic, openMap, type UnderstandingMap } from './file-map.ts'
export { type MapSignal, type ReplyKind, SIGNALS } from './learn.ts'
export { type Asked, areaQuestion, catchUpQuestion, type DayWords, deeperQuestion, LIST_SAID } from './lens.ts'
export { DEPTHS, type Depth, EVIDENCE, type Evidence, type MapEntry } from './map-entry.ts'
export {
	believe,
	type Knows,
	LEVELS,
	type Level,
	type Looks,
	looksAt,
	type OpensAt,
	type Since,
	type Thing,
} from './reader/reader-knows.ts'
export { openNotes, type ReaderNote, type ReaderNotes } from './reader/reader-notes.ts'
export {
	openPrefs,
	type Prefs,
	prefsLine,
	prefsOf,
	type ReaderPrefs,
	TEXT_PREFS,
	type TextPref,
} from './reader/reader-prefs.ts'
export {
	DID,
	type Did,
	KNOWN,
	type Known,
	type Looked,
	openSeen,
	type ReaderSeen,
	type SeenLine,
	type SeenRead,
} from './reader/reader-seen.ts'
export { LONG_AGO_DAYS, linesText, type QuotedLines, stateLine, type TopicState } from './topic-state.ts'
