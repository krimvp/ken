// The plan's first deterministic check: every claim about code cites a file, a commit and the exact lines, and this
// confirms that text is in that file at that commit. The model's line number is only a hint, never trusted.
import {
	type CommitHash,
	type NoCommit,
	type NoFile,
	parsePath,
	type Refused,
	type Repository,
	type TooLarge,
} from '../repo/index.ts'

export type Quote = { path: string; commit: string; text: string; line?: number }

export type VerifiedQuote = { path: string; commit: CommitHash; startLine: number; endLine: number; text: string }

// alsoAt holds the first line of every other place the same text appears, so a caller can say which one it meant.
export type QuoteCheck =
	| { kind: 'verified'; quote: VerifiedQuote; alsoAt: number[] }
	| { kind: 'not-found'; path: string; commit: CommitHash; closest: { line: number; text: string }[] }
	| { kind: 'empty' }
	| Refused
	| NoCommit
	| NoFile
	| TooLarge

const MAX_CLOSEST = 3

export async function checkQuote(repo: Repository, quote: Quote, signal?: AbortSignal): Promise<QuoteCheck> {
	if (!/[\p{L}\p{N}]/u.test(quote.text)) return { kind: 'empty' }
	const path = parsePath(quote.path)
	if (path.kind !== 'ok') return path
	const resolved = await repo.resolve(quote.commit, signal)
	if (resolved.kind !== 'ok') return resolved
	const file = await repo.readFile(resolved.commit, path.path, signal)
	if (file.kind !== 'ok') return file

	const wanted = quotedLines(quote.text)
	const lines = file.text.split('\n')
	const trimmed = lines.map((line) => line.trimEnd())
	const starts: number[] = []
	for (let index = 0; index + wanted.length <= trimmed.length; index++) {
		if (wanted.every((line, offset) => trimmed[index + offset] === line)) starts.push(index + 1)
	}
	const start = pickStart(starts, quote.line)
	if (start === undefined) {
		return { kind: 'not-found', path: path.path, commit: resolved.commit, closest: closestLines(lines, wanted) }
	}
	const endLine = start + wanted.length - 1
	return {
		kind: 'verified',
		quote: {
			path: path.path,
			commit: resolved.commit,
			startLine: start,
			endLine,
			text: lines.slice(start - 1, endLine).join('\n'),
		},
		alsoAt: starts.filter((other) => other !== start),
	}
}

function quotedLines(text: string): string[] {
	const lines = text.split('\n').map((line) => line.trimEnd())
	const first = lines.findIndex((line) => line !== '')
	const last = lines.findLastIndex((line) => line !== '')
	return lines.slice(first, last + 1)
}

function pickStart(starts: number[], hint: number | undefined): number | undefined {
	if (hint === undefined) return starts[0]
	return starts.reduce<number | undefined>(
		(best, start) => (best === undefined || Math.abs(start - hint) < Math.abs(best - hint) ? start : best),
		undefined,
	)
}

// shortcut: a substring match on the first quoted line catches lost indentation and partial lines, not typos.
// Switch to an edit distance if models keep missing by a character.
function closestLines(lines: string[], wanted: string[]) {
	const needle = wanted[0]?.trim() ?? ''
	const closest: { line: number; text: string }[] = []
	for (const [index, text] of lines.entries()) {
		if (closest.length === MAX_CLOSEST) break
		if (text.includes(needle)) closest.push({ line: index + 1, text })
	}
	return closest
}
