import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export type GitRun =
	| { kind: 'ok'; stdout: string }
	| { kind: 'failed'; code: number; stderr: string }
	| { kind: 'too-large' }

const execFileAsync = promisify(execFile)

// An argument array, never a shell string, so no argument is ever parsed by a shell.
export async function runGit(root: string, args: string[], signal?: AbortSignal): Promise<GitRun> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: MAX_OUTPUT_BYTES,
			...(signal ? { signal } : {}),
		})
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
