// Reads the sessions a coding agent saved while it worked on this project, so ken can quote what was said: what the
// owner asked and what the agent answered. It only reads, never records a session, and talks to no model. Every text
// it returns has passed secretHider. Claude Code's reader is the one today; a reader for another tool fits the same
// Transcripts seam.
export { claudeCodeTranscripts } from './claude-code.ts'
export { HIDDEN } from './hide-secrets.ts'
export { projectSessions } from './project-sessions.ts'
export { readSession } from './read-session.ts'
export { type SessionHit, searchSessions } from './search-sessions.ts'
export type { Session, SessionId, SessionList, SessionRead, TranscriptEntry, Transcripts } from './transcripts.ts'
