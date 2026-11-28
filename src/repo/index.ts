// Read-only access to a project's files and git history. Every fact ken states about the code starts here.
// Inputs come from a model, so they are checked at this door: a ref becomes a CommitHash through resolve, a path a
// RepoPath through parsePath, and no git command this module runs can write to the project.
export { findRoot } from './find-root.ts'
export { gitRepository, KEN_FOLDER } from './git-repository.ts'
export { parsePath } from './parse-path.ts'
export { type DirectImports, directImports, namedExports } from './references/direct-imports.ts'
export type {
	BlameLine,
	Commit,
	CommitHash,
	FileDiff,
	Hunk,
	NoCommit,
	NoFile,
	ObjectId,
	Range,
	Refused,
	RepoPath,
	Repository,
	SearchMatch,
	TooLarge,
	Uncommitted,
	Unrelated,
} from './repository.ts'
export { resolveRange } from './resolve-range.ts'
