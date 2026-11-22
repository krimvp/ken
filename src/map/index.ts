// The understanding map: what this one reader understands, topic by topic. It is personal, so it lives in the reader's
// home beside the history and never in the project. It is a plain file the reader can open and correct, one small
// JSON object per line, because ken will sometimes judge the reader wrong. Two files sit beside it: the reader notes,
// what the reader told ken about how they want things shown, and the lines on what the reader looked at. Nothing here
// talks to a model.

export { type MapRead, openMap, type UnderstandingMap } from './file-map.ts'
export { type MapSignal, SIGNALS } from './learn.ts'
export { type Asked, areaQuestion, catchUpQuestion, type DayWords, deeperQuestion, LIST_SAID } from './lens.ts'
export { DEPTHS, type Depth, EVIDENCE, type Evidence, type MapEntry } from './map-entry.ts'
export { openNotes, type ReaderNote, type ReaderNotes } from './reader-notes.ts'
export { DID, type Did, type Looked, openSeen, type ReaderSeen, type SeenLine, type SeenRead } from './reader-seen.ts'
export { LONG_AGO_DAYS, linesText, type QuotedLines, stateLine, type TopicState } from './topic-state.ts'
