// The seam between ken and git, and the shapes of the facts it reads.
// Refs, paths and patterns come from a model, so a ref becomes a CommitHash only through resolve, and a path becomes
// a RepoPath only through parsePath. Every other operation takes those, so no raw model input reaches git.

export type CommitHash = string & { readonly __brand: 'CommitHash' }
export type RepoPath = string & { readonly __brand: 'RepoPath' }

export type Range = { base: CommitHash; head: CommitHash }

// git's own id of the tree or file at a path. Two commits that give a path the same id hold the same content under it.
export type ObjectId = string & { readonly __brand: 'ObjectId' }

// coAuthors holds the value of each Co-authored-by trailer, such as "Claude <noreply@anthropic.com>". A merge has two or
// more parents; the first is the line it was merged into.
export type Commit = {
	hash: CommitHash
	parents: CommitHash[]
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

// A file whose working copy differs from HEAD, or that git neither tracks nor ignores ("new"). added and removed count
// lines against HEAD, and are null for a binary file and for a new file too large to count. bytes and modifiedAt are
// the working copy's size and last change in milliseconds, null for a deleted file.
export type Uncommitted = {
	path: string
	change: 'changed' | 'deleted' | 'new'
	added: number | null
	removed: number | null
	bytes: number | null
	modifiedAt: number | null
}

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
		maxBytes?: number,
	): Promise<{ kind: 'ok'; text: string } | NoFile | TooLarge>
	listFiles(commit: CommitHash, signal?: AbortSignal): Promise<{ kind: 'ok'; paths: string[] } | TooLarge>
	// How many lines each text file holds at the commit, by path. A binary file and an empty one are not listed.
	lineCounts(commit: CommitHash, signal?: AbortSignal): Promise<{ kind: 'ok'; lines: Map<string, number> } | TooLarge>
	search(
		commit: CommitHash,
		pattern: string,
		signal?: AbortSignal,
		paths?: RepoPath[],
	): Promise<{ kind: 'ok'; matches: SearchMatch[] } | { kind: 'bad-pattern'; message: string } | TooLarge>
	// The commit where head split from base. Unrelated when the two share no history.
	mergeBase(
		base: CommitHash,
		head: CommitHash,
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; commit: CommitHash } | Unrelated>
	// The oldest commit with no parent that HEAD reaches. Every clone of the project has it, so it names the project.
	// Null when the repository has no commits yet.
	firstCommit(signal?: AbortSignal): Promise<CommitHash | null>
	// The email of the person who runs ken in this repository, from git config. Null when none is set.
	userEmail(signal?: AbortSignal): Promise<string | null>
	log(range: Range, signal?: AbortSignal): Promise<{ kind: 'ok'; commits: Commit[] } | TooLarge>
	// The range's newest commits without merges, at most limit of them, without their paths, so a long range stays under
	// git's output limit. more counts the ones left out, and merges the merge commits of the range, which are counted
	// apart since the commits a merge brings are listed themselves. oldest is the date of the range's oldest commit.
	commitsIn(
		range: Range,
		limit: number,
		signal?: AbortSignal,
		within?: string[],
	): Promise<
		{ kind: 'ok'; commits: Omit<Commit, 'paths'>[]; more: number; merges: number; oldest: string | null } | TooLarge
	>
	// The newest commit head reaches whose author has this email, whatever its case. Merged branches count. Null when
	// there is none.
	lastCommitBy(head: CommitHash, email: string, signal?: AbortSignal): Promise<Commit | null>
	// For each commit asked, the commits head has that it lacks, newest first, merges left out, each with its paths.
	// Null for a commit head does not reach: history was rewritten since, or the commit is not in this clone. The
	// hashes may be typed by hand, so text that is no hash reads as null too. One log covers every commit asked.
	landedAfter(
		head: CommitHash,
		after: string[],
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; landed: Map<string, Commit[] | null> } | TooLarge>
	// The whole message of one commit as its author wrote it: the subject, then the body.
	message(commit: CommitHash, signal?: AbortSignal): Promise<{ kind: 'ok'; text: string } | TooLarge>
	// The newest commits on head's main line, newest first: head, its first parent, that one's first parent, and so on.
	// A merge's paths are the ones it changed against its first parent, so they are the paths of the change it brought.
	mainLine(head: CommitHash, limit: number, signal?: AbortSignal): Promise<{ kind: 'ok'; commits: Commit[] } | TooLarge>
	// The newest commit on head's main line that git committed at or before the moment, an ISO date. Null when every
	// commit is newer. The commit date, not the author date, so a commit rebased onto the line counts from when it landed.
	before(head: CommitHash, moment: string, signal?: AbortSignal): Promise<CommitHash | null>
	// File names at both ends of a change, without loading its patch.
	diffFiles(
		range: Range,
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; files: Pick<FileDiff, 'path' | 'oldPath'>[] } | TooLarge>
	diff(range: Range, signal?: AbortSignal, within?: string[]): Promise<{ kind: 'ok'; files: FileDiff[] } | TooLarge>
	// The branch HEAD is on, or null when HEAD is detached.
	branch(signal?: AbortSignal): Promise<string | null>
	// The project's local branches, the one with the newest commit first.
	branches(signal?: AbortSignal): Promise<string[]>
	// Whether the name is a branch: a local one, or one fetched from a remote, such as origin/feature.
	isBranch(name: string, signal?: AbortSignal): Promise<boolean>
	// git's id of the tree or file at each path at the commit, null where the path is not there. One git call.
	objectIds(commit: CommitHash, paths: RepoPath[], signal?: AbortSignal): Promise<(ObjectId | null)[]>
	// The files with uncommitted changes, ken's own .ken/ left out. It reads the working tree and the index and writes
	// neither.
	uncommitted(signal?: AbortSignal): Promise<{ kind: 'ok'; files: Uncommitted[] } | TooLarge>
	blame(
		commit: CommitHash,
		path: RepoPath,
		lines: { start: number; end: number },
		signal?: AbortSignal,
	): Promise<{ kind: 'ok'; lines: BlameLine[] } | NoFile | { kind: 'bad-lines'; message: string } | TooLarge>
}
