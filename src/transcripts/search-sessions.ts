import type { SessionId, Transcripts } from './transcripts.ts'

// One line of a message that holds the text, so the reader can quote the whole line.
export type SessionHit = { session: SessionId; message: number; kind: 'user' | 'agent'; at: string; line: string }

const MAX_HITS = 50
const MAX_LINE = 300

// Looks in what the user and the agent wrote, in any case, never in tool output: a quote can only cite what was said.
// more counts the hits left out.
export async function searchSessions(
	transcripts: Transcripts,
	text: string,
	signal?: AbortSignal,
): Promise<{ hits: SessionHit[]; more: number }> {
	const needle = text.trim().toLowerCase()
	const hits: SessionHit[] = []
	let more = 0
	if (needle === '') return { hits, more }
	for (const { id } of (await transcripts.sessions(signal)).sessions) {
		for (const entry of (await transcripts.session(id, signal))?.entries ?? []) {
			if (entry.kind === 'tool') continue
			for (const line of entry.text.split('\n')) {
				const at = line.toLowerCase().indexOf(needle)
				if (at < 0) continue
				if (hits.length === MAX_HITS) more++
				else hits.push({ session: id, message: entry.message, kind: entry.kind, at: entry.at, line: around(line, at) })
			}
		}
	}
	return { hits, more }
}

// A long line is shown from a little before the match, so the match is in what is shown.
function around(line: string, at: number): string {
	if (line.length <= MAX_LINE) return line
	const start = Math.max(0, at - 60)
	return `${start > 0 ? '...' : ''}${line.slice(start, start + MAX_LINE)}...`
}
