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
import type { VerifiedQuote } from './quote-check.ts'

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
	quotes: VerifiedQuote[],
	signal?: AbortSignal,
): Promise<Coverage> {
	const resolved = await resolveRange(repo, scope, signal)
	if (resolved.kind !== 'ok') return resolved
	const { base, head } = resolved.range
	const diff = await repo.diff(resolved.range, signal)
	if (diff.kind !== 'ok') return diff

	const covered: ChangedHunk[] = []
	const uncovered: ChangedHunk[] = []
	const binary: string[] = []
	for (const file of diff.files) {
		if (file.kind === 'binary') {
			binary.push(file.path)
			continue
		}
		for (const hunk of file.hunks) {
			// A hunk that only deletes has no lines at head, so only a quote of the old code at base can cover it.
			const [commit, path, start, length] =
				hunk.newLength === 0
					? [base, file.oldPath, hunk.oldStart, hunk.oldLength]
					: [head, file.path, hunk.newStart, hunk.newLength]
			const isCovered = quotes.some(
				(quote) =>
					quote.commit === commit && quote.path === path && quote.startLine < start + length && quote.endLine >= start,
			)
			;(isCovered ? covered : uncovered).push({ path: file.path, oldPath: file.oldPath, hunk })
		}
	}
	return { kind: 'ok', covered, uncovered, binary }
}
