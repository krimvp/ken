// The plan's first deterministic check: every claim about code cites a file, a commit and the exact lines, and this
// confirms that text is in that file at that commit. A quote with no path cites the commit's message instead, which
// is checked the same way. The model's line number is only a hint, never trusted.
import {
	type CommitHash,
	type NoCommit,
	type NoFile,
	parsePath,
	type Refused,
	type RepoPath,
	type Repository,
	type TooLarge,
} from '../repo/index.ts'

// A quote of something git holds. path is null for a quote of the commit's message rather than of a file. Its lines
// count from the subject, line 1.
export type GitQuote = { path: string | null; commit: string; text: string; line?: number }

export type VerifiedGitQuote = {
	path: string | null
	commit: CommitHash
	startLine: number
	endLine: number
	text: string
}

// alsoAt holds the first line of every other place the same text appears, so a caller can say which one it meant.
export type QuoteCheck =
	| { kind: 'verified'; quote: VerifiedGitQuote; alsoAt: number[] }
	| { kind: 'not-found'; path: string | null; commit: CommitHash; closest: { line: number; text: string }[] }
	| { kind: 'empty' }
	| Refused
	| NoCommit
	| NoFile
	| TooLarge

const MAX_CLOSEST = 3
const MAX_RECALLED_FILES = 4

export async function checkQuote(repo: Repository, quote: GitQuote, signal?: AbortSignal): Promise<QuoteCheck> {
	if (!/[\p{L}\p{N}]/u.test(quote.text)) return { kind: 'empty' }
	const path = quote.path === null ? null : parsePath(quote.path)
	if (path !== null && path.kind !== 'ok') return path
	const resolved = await repo.resolve(quote.commit, signal)
	if (resolved.kind !== 'ok') return resolved
	const source =
		path === null
			? await repo.message(resolved.commit, signal)
			: await repo.readFile(resolved.commit, path.path, signal)
	if (source.kind !== 'ok') return source

	const where = { path: path === null ? null : path.path, commit: resolved.commit }
	const wanted = quotedLines(quote.text)
	const lines = source.text.split('\n')
	const starts = startsOf(lines, wanted)
	const start = pickStart(starts, quote.line)
	if (start === undefined) return { kind: 'not-found', ...where, closest: closestLines(lines, wanted) }
	const endLine = start + wanted.length - 1
	return {
		kind: 'verified',
		quote: { ...where, startLine: start, endLine, text: lines.slice(start - 1, endLine).join('\n') },
		alsoAt: starts.filter((other) => other !== start),
	}
}

// The rule every quote follows: it is whole lines, in order. A line's end may differ in spaces, its start may not.
export function quotedLines(text: string): string[] {
	const lines = text.split('\n').map((line) => line.trimEnd())
	const first = lines.findIndex((line) => line !== '')
	const last = lines.findLastIndex((line) => line !== '')
	return lines.slice(first, last + 1)
}

// The line number, from 1, of each place where the wanted lines start.
export function startsOf(lines: string[], wanted: string[]): number[] {
	return startsOfTrimmed(
		lines.map((line) => line.trimEnd()),
		wanted,
	)
}

function startsOfTrimmed(trimmed: string[], wanted: string[]): number[] {
	const starts: number[] = []
	for (let index = 0; index + wanted.length <= trimmed.length; index++) {
		if (wanted.every((line, offset) => trimmed[index + offset] === line)) starts.push(index + 1)
	}
	return starts
}

// Locate already verified file quotes at one HEAD for this read. Older quotes in the same file share its blob.
export function fileQuotesAtHead(repo: Repository, signal?: AbortSignal) {
	let head: ReturnType<Repository['resolve']> | undefined
	const files = new Map<RepoPath, Promise<string[] | null>>()
	return async (quote: VerifiedGitQuote & { path: string }) => {
		head ??= repo.resolve('HEAD', signal)
		const resolved = await head
		if (resolved.kind !== 'ok') return null
		if (quote.commit === resolved.commit) return { startLine: quote.startLine, endLine: quote.endLine }
		const path = parsePath(quote.path)
		if (path.kind !== 'ok') return null
		let file = files.get(path.path)
		if (!file) {
			file = repo
				.readFile(resolved.commit, path.path, signal)
				.then((read) => (read.kind === 'ok' ? read.text.split('\n').map((line) => line.trimEnd()) : null))
			// A folder query can visit many large files before it finds a match in the requested lines.
			const oldest = files.keys().next().value
			if (files.size >= MAX_RECALLED_FILES && oldest !== undefined) files.delete(oldest)
			files.set(path.path, file)
		}
		const lines = await file
		if (!lines) return null
		const wanted = quotedLines(quote.text)
		// Most edits leave the quote at its old line. It is already the closest possible match.
		if (wanted.every((line, offset) => lines[quote.startLine - 1 + offset] === line)) {
			return { startLine: quote.startLine, endLine: quote.startLine + wanted.length - 1 }
		}
		const startLine = pickStart(startsOfTrimmed(lines, wanted), quote.startLine)
		return startLine === undefined ? null : { startLine, endLine: startLine + wanted.length - 1 }
	}
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
