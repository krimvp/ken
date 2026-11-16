import { createHash } from 'node:crypto'
import { checkQuote, type VerifiedQuote } from '../checks/index.ts'
import type { Repository } from '../repo/index.ts'
import type { Note, Topic } from './entry.ts'

export type Freshness = { kind: 'fresh' } | { kind: 'stale'; changed: string[] }

// A topic's code as it is at HEAD: the hash of its quoted lines found there, and the quotes no longer found there.
export type TopicCode = { hash: string; gone: VerifiedQuote[] }

export function codeHash(quotes: VerifiedQuote[]): string {
	const hash = createHash('sha256')
	for (const quote of quotes) hash.update(`${quote.text}\0`)
	return hash.digest('hex').slice(0, 16)
}

// Each quote is looked for again at HEAD, near the line it was at, so lines that moved within their file still count.
// A quote that is gone leaves the hash, so the hash differs from the one taken when every quote was there.
export async function topicCode(repo: Repository, topic: Topic, signal?: AbortSignal): Promise<TopicCode> {
	const checks = await Promise.all(
		topic.quotes.map((quote) =>
			checkQuote(repo, { path: quote.path, commit: 'HEAD', text: quote.text, line: quote.startLine }, signal),
		),
	)
	const atHead = checks.flatMap((check) => (check.kind === 'verified' ? [check.quote] : []))
	return { hash: codeHash(atHead), gone: topic.quotes.filter((_, index) => checks[index]?.kind !== 'verified') }
}

// A note describes the code its topic quotes. It stays fresh while every one of those quotes still verifies at HEAD
// and the lines found there hash to the note's codeHash. A change elsewhere in the file leaves it fresh.
export async function noteFreshness(
	repo: Repository,
	topic: Topic,
	note: Note,
	signal?: AbortSignal,
): Promise<Freshness> {
	const code = await topicCode(repo, topic, signal)
	if (code.gone.length > 0) return { kind: 'stale', changed: files(code.gone) }
	if (code.hash !== note.codeHash) return { kind: 'stale', changed: files(topic.quotes) }
	return { kind: 'fresh' }
}

// A topic quotes only files: checkEntry refuses a quote of a commit message in a topic.
function files(quotes: VerifiedQuote[]): string[] {
	return [...new Set(quotes.flatMap((quote) => quote.path ?? []))]
}
