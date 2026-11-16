// A quote of a saved session: text that the user or the agent wrote while the work was done. It lets a statement carry
// the label "from the session". The check finds the text in one message of the session, as whole lines, by the same
// rule as a quote of a file, and says which message it is, who wrote it and when. Tool output never counts: a tool's
// output is not what anyone said.
import type { SessionId, Transcripts } from '../transcripts/index.ts'
import { quotedLines, startsOf } from './quote-check.ts'

export type SessionQuote = { session: string; text: string }

// tool is the coding tool that saved the session. message counts the session's messages from 1, and startLine and
// endLine count the lines of that message from 1.
export type VerifiedSessionQuote = {
	tool: string
	session: SessionId
	message: number
	by: 'user' | 'agent'
	at: string
	startLine: number
	endLine: number
	text: string
}

export type SessionQuoteCheck =
	| { kind: 'verified'; quote: VerifiedSessionQuote }
	| { kind: 'not-found'; session: SessionId }
	| { kind: 'no-session'; session: string }
	| { kind: 'empty' }

export async function checkSessionQuote(
	transcripts: Transcripts,
	quote: SessionQuote,
	signal?: AbortSignal,
): Promise<SessionQuoteCheck> {
	if (!/[\p{L}\p{N}]/u.test(quote.text)) return { kind: 'empty' }
	const read = await transcripts.session(quote.session, signal)
	if (read === null) return { kind: 'no-session', session: quote.session }
	const wanted = quotedLines(quote.text)
	for (const entry of read.entries) {
		if (entry.kind === 'tool') continue
		const lines = entry.text.split('\n')
		const [start] = startsOf(lines, wanted)
		if (start === undefined) continue
		const endLine = start + wanted.length - 1
		return {
			kind: 'verified',
			quote: {
				tool: transcripts.tool,
				session: read.session.id,
				message: entry.message,
				by: entry.kind,
				at: entry.at,
				startLine: start,
				endLine,
				text: lines.slice(start - 1, endLine).join('\n'),
			},
		}
	}
	return { kind: 'not-found', session: read.session.id }
}
