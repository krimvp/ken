import type { SessionRead, TranscriptEntry, Transcripts } from './transcripts.ts'

// A session can hold thousands of entries and messages of many pages. A person, or a model later, reads the first
// MAX_ENTRIES entries with each message cut to MAX_TEXT characters, and finds the rest with searchSessions.
const MAX_ENTRIES = 300
const MAX_TEXT = 2000

export async function readSession(
	transcripts: Transcripts,
	id: string,
	signal?: AbortSignal,
): Promise<SessionRead | null> {
	const whole = await transcripts.session(id, signal)
	if (whole === null) return null
	const entries = whole.entries.slice(0, MAX_ENTRIES).map(cut)
	return { session: whole.session, entries, more: whole.entries.length - entries.length }
}

function cut(entry: TranscriptEntry): TranscriptEntry {
	if (entry.kind === 'tool' || entry.text.length <= MAX_TEXT) return entry
	return { ...entry, text: entry.text.slice(0, MAX_TEXT), cut: entry.text.length - MAX_TEXT }
}
