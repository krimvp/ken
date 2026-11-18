// The plan's hunk coverage check: an answer about a range of commits should quote every hunk the range changed.
// This lists the hunks the answer left out, so the agent can explain them or say why it skipped them.
import {
	type Hunk,
	type NoCommit,
	type Refused,
	type Repository,
	resolveRange,
	type TooLarge,
	type Unrelated,
} from '../repo/index.ts'
import type { VerifiedGitQuote } from './quote-check.ts'

export type ChangedHunk = { path: string; oldPath: string; hunk: Hunk }

// A binary file has no lines to quote, so it is listed on its own instead of as a hunk that can never be covered.
export type Coverage =
	| { kind: 'ok'; covered: ChangedHunk[]; uncovered: ChangedHunk[]; binary: string[] }
	| Refused
	| NoCommit
	| Unrelated
	| TooLarge

export async function checkCoverage(
	repo: Repository,
	scope: { base: string; head: string },
	quotes: VerifiedGitQuote[],
	signal?: AbortSignal,
): Promise<Coverage> {
	const resolved = await resolveRange(repo, scope, signal)
	if (resolved.kind !== 'ok') return resolved
	const { base, head } = resolved.range
	const diff = await repo.diff(resolved.range, signal)
	if (diff.kind !== 'ok') return diff

	const binary: string[] = []
	const all: ChangedHunk[] = []
	for (const file of diff.files) {
		if (file.kind === 'binary') binary.push(file.path)
		else all.push(...file.hunks.map((hunk) => ({ path: file.path, oldPath: file.oldPath, hunk })))
	}
	const covered = quotedHunks(all, { base, head }, quotes)
	const uncovered = all.filter((hunk) => !covered.includes(hunk))
	return { kind: 'ok', covered, uncovered, binary }
}

// The hunks of a change that the quotes overlap. A hunk that only deletes has no lines at head, so only a quote of the
// old code at base can cover it. A quote of a commit message has no path, so it covers no hunk.
export function quotedHunks(
	hunks: ChangedHunk[],
	range: { base: string; head: string },
	quotes: VerifiedGitQuote[],
): ChangedHunk[] {
	return hunks.filter(({ path, oldPath, hunk }) => {
		const [commit, file, start, length] =
			hunk.newLength === 0
				? [range.base, oldPath, hunk.oldStart, hunk.oldLength]
				: [range.head, path, hunk.newStart, hunk.newLength]
		return quotes.some(
			(quote) =>
				quote.commit === commit && quote.path === file && quote.startLine < start + length && quote.endLine >= start,
		)
	})
}
