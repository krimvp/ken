// The reader's own log of the questions they asked on the page and what each one ended in. It lives in the reader's
// home, outside the project, because it says what this one reader asked; the project record says what the code is.
export { type History, kenHome, openHistory } from './file-history.ts'
export { entryFrom, type HistoryEntry, type Step, whyNoNote } from './history-entry.ts'
