import { statSync } from 'node:fs'
import { runGit } from './run-git.ts'

// gitRepository needs the top of the work tree: git grep and the "." pathspec of log and diff see only the folder git
// runs in.
export async function findRoot(directory: string): Promise<{ kind: 'ok'; root: string } | { kind: 'no-repository' }> {
	if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return { kind: 'no-repository' }
	const run = await runGit(directory, ['rev-parse', '--show-toplevel'])
	if (run.kind !== 'ok') return { kind: 'no-repository' }
	return { kind: 'ok', root: run.stdout.trim() }
}
