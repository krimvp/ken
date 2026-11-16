import { createHash } from 'node:crypto'
import { checkQuote, type VerifiedQuote } from '../checks/index.ts'
import type { Repository } from '../repo/index.ts'
import type { Note, Topic } from './entry.ts'

export type Freshness = { kind: 'fresh' } | { kind: 'stale'; changed: string[] }

export function codeHash(quotes: VerifiedQuote[]): string {
	const hash = createHash('sha256')
	for (const quote of quotes) hash.update(`${quote.text}\0`)
	return hash.digest('hex').slice(0, 16)
}

// A note describes the code its topic quotes. It stays fresh while every one of those quotes still verifies at HEAD
// and the lines found there hash to the note's codeHash. A change elsewhere in the file leaves it fresh.
export async function noteFreshness(
	repo: Repository,
	topic: Topic,
	note: Note,
	signal?: AbortSignal,
): Promise<Freshness> {
	const checks = await Promise.all(
		topic.quotes.map((quote) =>
			checkQuote(repo, { path: quote.path, commit: 'HEAD', text: quote.text, line: quote.startLine }, signal),
		),
	)
	const atHead = checks.flatMap((check) => (check.kind === 'verified' ? [check.quote] : []))
	const changed = topic.quotes.filter((_, index) => checks[index]?.kind !== 'verified')
	if (changed.length > 0) return { kind: 'stale', changed: files(changed) }
	if (codeHash(atHead) !== note.codeHash) return { kind: 'stale', changed: files(atHead) }
	return { kind: 'fresh' }
}

// A topic quotes only files: checkEntry refuses a quote of a commit message in a topic.
function files(quotes: VerifiedQuote[]): string[] {
	return [...new Set(quotes.flatMap((quote) => quote.path ?? []))]
}
