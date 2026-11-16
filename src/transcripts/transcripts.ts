// The seam between ken and one coding tool's saved sessions, and the shapes ken reads from them. Claude Code's reader
// is the only one today. Another tool, such as Codex, gets a reader of the same shape, and readSession,
// searchSessions and the session quote check work on it unchanged.

export type SessionId = string & { readonly __brand: 'SessionId' }

// One saved session. started and ended are the times of its first and last message, null when it has none. messages
// counts what the user and the agent wrote. skipped counts the lines ken could not read. partial is true when the
// file is larger than ken reads, so the rest of the session is missing.
export type Session = {
	id: SessionId
	started: string | null
	ended: string | null
	messages: number
	skipped: number
	partial: boolean
}

// What a person would recognise in a session, in order: what the user asked, what the agent said, and each tool the
// agent called, with the file or command it named and the first lines of what came back. message numbers the user's
// and the agent's messages from 1, so a quote can name one. cut counts the characters left out at the end of text, and
// more the lines left out of output.
export type TranscriptEntry =
	| { kind: 'user' | 'agent'; message: number; at: string; text: string; cut: number }
	| { kind: 'tool'; at: string; name: string; target: string | null; output: string[]; more: number }

// more counts the entries left out at the end.
export type SessionRead = { session: Session; entries: TranscriptEntry[]; more: number }

// older counts the sessions ken did not read, because there were more than it reads at once.
export type SessionList = { sessions: Session[]; older: number }

export interface Transcripts {
	// The tool that saved the sessions, as a person names it, and where it keeps this project's sessions.
	tool: string
	where: string
	// The project's sessions, newest first.
	sessions(signal?: AbortSignal): Promise<SessionList>
	// One session whole: every entry, with each message in full. Null when the project has no session with this id.
	session(id: string, signal?: AbortSignal): Promise<SessionRead | null>
}
