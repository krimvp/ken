import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export type GitRun =
	| { kind: 'ok'; stdout: string }
	| { kind: 'failed'; code: number; stderr: string }
	| { kind: 'too-large' }

const execFileAsync = promisify(execFile)

// An argument array, never a shell string, so no argument is ever parsed by a shell. GIT_OPTIONAL_LOCKS=0 stops a read,
// such as a diff against the working tree, from writing a refreshed index back into the project. alternate is a folder
// of objects git may also read, such as ken's snapshot store; git never writes there or anywhere else from here.
// input goes to git's standard input, for a command that reads its arguments there.
export async function runGit(
	root: string,
	args: string[],
	signal?: AbortSignal,
	alternate: string | null = null,
	input = '',
): Promise<GitRun> {
	try {
		const run = execFileAsync('git', args, {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: MAX_OUTPUT_BYTES,
			env: {
				...process.env,
				GIT_OPTIONAL_LOCKS: '0',
				...(alternate === null ? {} : { GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate }),
			},
			...(signal ? { signal } : {}),
		})
		// A command that reads no input may exit before its input closes, and its exit code says whether it worked.
		run.child.stdin?.on('error', () => {})
		run.child.stdin?.end(input)
		const { stdout } = await run
		return { kind: 'ok', stdout }
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error)) throw error
		if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { kind: 'too-large' }
		if (typeof error.code === 'number') {
			return { kind: 'failed', code: error.code, stderr: 'stderr' in error ? String(error.stderr).trim() : '' }
		}
		if (error.code === 'ENOENT') throw new Error('git is not on PATH. Install git so ken can read the project.')
		throw error
	}
}
