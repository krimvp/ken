// The seam between ken and git, and the shapes of the facts it reads.
// Refs, paths and patterns come from a model, so a ref becomes a CommitHash only through resolve, and a path becomes
// a RepoPath only through parsePath. Every other operation takes those, so no raw model input reaches git.

export type CommitHash = string & { readonly __brand: 'CommitHash' }
export type RepoPath = string & { readonly __brand: 'RepoPath' }

export type Range = { base: CommitHash; head: CommitHash }

// coAuthors holds the value of each Co-authored-by trailer, such as "Claude <noreply@anthropic.com>".
export type Commit = {
	hash: string
	author: string
	email: string
	date: string
	subject: string
	coAuthors: string[]
	paths: string[]
}

// Lines keep the diff's own prefix: "+" added, "-" removed, "\" for git's "No newline at end of file".
export type Hunk = { oldStart: number; oldLength: number; newStart: number; newLength: number; lines: string[] }

// oldPath equals path unless the file was renamed. A binary file has no hunks to show.
export type FileDiff =
	| { kind: 'text'; path: string; oldPath: string; hunks: Hunk[] }
	| { kind: 'binary'; path: string; oldPath: string }

export type SearchMatch = { path: string; line: number; text: string }

export type BlameLine = { line: number; commit: string; author: string; email: string; date: string; text: string }

export type Refused = { kind: 'refused'; reason: string }
export type NoCommit = { kind: 'no-commit'; ref: string }
export type NoFile = { kind: 'no-file'; path: string; commit: CommitHash }
export type TooLarge = { kind: 'too-large'; limitBytes: number }
export type Unrelated = { kind: 'unrelated'; base: CommitHash; head: CommitHash }

export interface Repository {
	resolve(ref: string, signal?: AbortSignal): Promise<{ kind: 'ok'; commit: CommitHash } | Refused | NoCommit>
	readFile(
		commit: CommitHash,
		path: RepoPath,
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; text: string } | NoFile | TooLarge>
	listFiles(commit: CommitHash, signal?: AbortSignal): Promise<{ kind: 'ok'; paths: string[] } | TooLarge>
	search(
		commit: CommitHash,
		pattern: string,
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; matches: SearchMatch[] } | { kind: 'bad-pattern'; message: string } | TooLarge>
	// The commit where head split from base. Unrelated when the two share no history.
	mergeBase(
		base: CommitHash,
		head: CommitHash,
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; commit: CommitHash } | Unrelated>
	// The email of the person who runs ken in this repository, from git config. Null when none is set.
	userEmail(signal?: AbortSignal): Promise<string | null>
	log(range: Range, signal?: AbortSignal): Promise<{ kind: 'ok'; commits: Commit[] } | TooLarge>
	diff(range: Range, signal?: AbortSignal): Promise<{ kind: 'ok'; files: FileDiff[] } | TooLarge>
	blame(
		commit: CommitHash,
		path: RepoPath,
		lines: { start: number; end: number },
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; lines: BlameLine[] } | NoFile | { kind: 'bad-lines'; message: string } | TooLarge>
}
