// A quote cites one of three sources: lines of a file at a commit, lines of a commit's message, or lines of one message
// in a saved session. This is the one shape a writer sends and the one verified shape ken keeps, with the check that
// turns the first into the second or says, in words its writer can act on, why it cannot.
import type { Repository } from '../repo/index.ts'
import type { Transcripts } from '../transcripts/index.ts'
import { checkQuote, type GitQuote, type QuoteCheck, type VerifiedGitQuote } from './quote-check.ts'
import {
	checkSessionQuote,
	type SessionQuote,
	type SessionQuoteCheck,
	type VerifiedSessionQuote,
} from './session-quote-check.ts'

// A session quote is told apart by its session field, so quotes written before sessions existed read as they are.
export type Quote = GitQuote | SessionQuote
export type VerifiedQuote = VerifiedGitQuote | VerifiedSessionQuote

// sessions is null where ken reads no saved sessions: KEN_SESSIONS is off, or the writer never quotes one.
export type QuoteSources = { repo: Repository; sessions: Transcripts | null }

export type QuoteVerdict<Verified = VerifiedQuote> =
	| { kind: 'verified'; quote: Verified }
	| { kind: 'refused'; problem: string }

export async function verifyQuote(sources: QuoteSources, quote: Quote, signal?: AbortSignal): Promise<QuoteVerdict> {
	if (!('session' in quote)) return await verifyGitQuote(sources.repo, quote, signal)
	if (sources.sessions === null) {
		return {
			kind: 'refused',
			problem: `ken reads no saved sessions here, so it cannot check a quote of session "${quote.session}". Quote the code or a commit message instead.`,
		}
	}
	const check = await checkSessionQuote(sources.sessions, quote, signal)
	return check.kind === 'verified' ? check : { kind: 'refused', problem: explainSessionQuote(check) }
}

// For what may quote only git: a topic and a diagram.
export async function verifyGitQuote(
	repo: Repository,
	quote: GitQuote,
	signal?: AbortSignal,
): Promise<QuoteVerdict<VerifiedGitQuote>> {
	const check = await checkQuote(repo, quote, signal)
	return check.kind === 'verified'
		? { kind: 'verified', quote: check.quote }
		: { kind: 'refused', problem: explainQuote(check, quote) }
}

export function gitQuotes<Q extends Quote | VerifiedQuote>(
	quotes: Q[],
): Exclude<Q, SessionQuote | VerifiedSessionQuote>[] {
	return quotes.filter((quote): quote is Exclude<Q, SessionQuote | VerifiedSessionQuote> => !('session' in quote))
}

function explainSessionQuote(check: Exclude<SessionQuoteCheck, { kind: 'verified' }>): string {
	switch (check.kind) {
		case 'not-found':
			return `The quoted lines are not in any message of session ${check.session}. Copy whole lines of one message as read_session shows them, without the line that names the message. Tool output cannot be quoted.`
		case 'no-session':
			return `There is no saved session "${check.session}" for this project. list_sessions lists them.`
		case 'empty':
			return 'The quote holds no text.'
		default:
			return check satisfies never
	}
}

// Why a quote of git failed, naming the file and commit it gave, so its writer can fix it. The page shows the first
// sentence.
function explainQuote(check: Exclude<QuoteCheck, { kind: 'verified' }>, quote: GitQuote): string {
	const message = quote.path === null
	const at = message ? `the message of commit ${quote.commit}` : `${quote.path} at ${quote.commit}`
	switch (check.kind) {
		case 'not-found': {
			const numbered = /^\s*[+-]?\s*\d+\t/m.test(quote.text) ? ' Leave out the line numbers and the + or - signs.' : ''
			if (check.closest.length === 0 && message) {
				return `The quoted lines are not in ${at}, and no line of the message matches the first of them. Copy whole lines of the message as log shows them. To quote a file, give its path.${numbered}`
			}
			if (check.closest.length === 0) {
				return `The quoted lines are not in ${at}, and nothing in the file matches the first of them. Read the file again and copy the lines.${numbered}`
			}
			// As JSON strings, so the model sees the exact spaces and tabs that start each line, which models often miscount.
			const closest = check.closest.map((line) => `line ${line.line}: ${JSON.stringify(line.text)}`).join('\n  ')
			const what = message ? 'line of the message' : 'file line'
			return `The quoted lines are not in ${at}. Lines that hold the first quoted line, as JSON strings:\n  ${closest}\nEach quoted line must match the ${what} exactly and whole, with the same spaces or tabs at its start.${numbered}`
		}
		case 'empty':
			return 'The quote holds no code.'
		case 'refused':
			return `${check.reason}.`
		case 'no-commit':
			return `There is no commit "${check.ref}".`
		case 'no-file':
			return `There is no file ${at}.`
		case 'too-large':
			return `${message ? at : quote.path} is too large to check.`
		default:
			return check satisfies never
	}
}
