import { parseDiff } from './parse-diff.ts'
import type { BlameLine, Commit, CommitHash, Repository, SearchMatch } from './repository.ts'
import { MAX_OUTPUT_BYTES, runGit } from './run-git.ts'

// ken commits its own record to .ken/. Those bookkeeping commits are not changes to explain (plan risk: "The record's
// own files pollute the history"), so every change fact reads git through this pathspec and no other.
const OUTSIDE_RECORD = ['--', '.', ':(exclude).ken']

const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const LOG_FORMAT =
	'--format=%x1e%H%x00%an%x00%ae%x00%at%x00%s%x00%(trailers:key=Co-authored-by,valueonly,separator=%x1f)'

export function gitRepository(root: string): Repository {
	const git = (args: string[], signal?: AbortSignal) => runGit(root, args, signal)
	const tooLarge = { kind: 'too-large', limitBytes: MAX_OUTPUT_BYTES } as const

	async function isFile(commit: CommitHash, path: string, signal?: AbortSignal) {
		const run = await git(['cat-file', '-t', `${commit}:${path}`], signal)
		return run.kind === 'ok' && run.stdout.trim() === 'blob'
	}

	return {
		async resolve(ref, signal) {
			if (ref.startsWith('-')) return { kind: 'refused', reason: `ref "${ref}" starts with "-"` }
			if (ref.trim() === '' || ref.includes('\0'))
				return { kind: 'refused', reason: 'the ref is empty or holds a NUL byte' }
			const run = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], signal)
			const hash = run.kind === 'ok' ? run.stdout.trim() : ''
			if (!HASH.test(hash)) return { kind: 'no-commit', ref }
			return { kind: 'ok', commit: hash as CommitHash }
		},

		async readFile(commit, path, signal) {
			const run = await git(['cat-file', 'blob', `${commit}:${path}`], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') return { kind: 'no-file', path, commit }
			return { kind: 'ok', text: run.stdout }
		},

		async listFiles(commit, signal) {
			const run = await git(['ls-tree', '-r', '-z', '--name-only', '--full-tree', commit], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git ls-tree failed on a resolved commit: ${run.stderr}`)
			return { kind: 'ok', paths: run.stdout.split('\0').filter((path) => path !== '') }
		},

		async search(commit, pattern, signal) {
			if (pattern.includes('\0')) return { kind: 'bad-pattern', message: 'the pattern holds a NUL byte' }
			const args = ['grep', '-n', '-z', '-I', '--no-color', '--no-column', '-E', '-e', pattern, commit, '--']
			const run = await git(args, signal)
			if (run.kind === 'too-large') return tooLarge
			// git grep exits 1 when nothing matches and 128 when the pattern does not compile.
			if (run.kind === 'failed') {
				return run.code === 1 ? { kind: 'ok', matches: [] } : { kind: 'bad-pattern', message: run.stderr }
			}
			return { kind: 'ok', matches: parseGrep(run.stdout, commit) }
		},

		async mergeBase(base, head, signal) {
			const run = await git(['merge-base', base, head], signal)
			const hash = run.kind === 'ok' ? run.stdout.trim() : ''
			if (!HASH.test(hash)) return { kind: 'unrelated', base, head }
			return { kind: 'ok', commit: hash as CommitHash }
		},

		async userEmail(signal) {
			const run = await git(['config', '--get', 'user.email'], signal)
			const email = run.kind === 'ok' ? run.stdout.trim() : ''
			return email === '' ? null : email
		},

		async log({ base, head }, signal) {
			// --no-renames lists a moved file under both its old and its new path, since both paths changed.
			const args = [
				'log',
				'-z',
				'--name-only',
				'--no-renames',
				'--full-history',
				'--no-color',
				LOG_FORMAT,
				`${base}..${head}`,
			]
			const run = await git([...args, ...OUTSIDE_RECORD], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on resolved commits: ${run.stderr}`)
			return { kind: 'ok', commits: parseLog(run.stdout) }
		},

		async diff({ base, head }, signal) {
			const common = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', base, head, ...OUTSIDE_RECORD]
			const [numstat, patch] = await Promise.all([
				git(['diff', '--numstat', '-z', ...common], signal),
				git(['diff', '-U0', ...common], signal),
			])
			if (numstat.kind === 'too-large' || patch.kind === 'too-large') return tooLarge
			if (numstat.kind === 'failed' || patch.kind === 'failed') {
				throw new Error(`git diff failed on resolved commits ${base} and ${head}`)
			}
			return { kind: 'ok', files: parseDiff(numstat.stdout, patch.stdout) }
		},

		async blame(commit, path, { start, end }, signal) {
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
				return { kind: 'bad-lines', message: `lines ${start} to ${end} are not a range of line numbers from 1` }
			}
			const run = await git(['blame', '--line-porcelain', '-L', `${start},${end}`, commit, '--', path], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') {
				if (!(await isFile(commit, path, signal))) return { kind: 'no-file', path, commit }
				return { kind: 'bad-lines', message: run.stderr }
			}
			return { kind: 'ok', lines: parseBlame(run.stdout) }
		},
	}
}

function parseGrep(stdout: string, commit: CommitHash): SearchMatch[] {
	return stdout
		.split('\n')
		.filter((record) => record !== '')
		.map((record) => {
			const [where = '', line = '', ...text] = record.split('\0')
			return { path: where.slice(commit.length + 1), line: Number(line), text: text.join('\0') }
		})
}

function parseLog(stdout: string): Commit[] {
	return stdout
		.split('\x1e')
		.filter((record) => record !== '')
		.map((record) => {
			const [hash = '', author = '', email = '', time = '', subject = '', trailers = '', ...rest] = record.split('\0')
			// git puts a newline between a commit's header and its list of paths.
			const paths = rest
				.join('\0')
				.slice(1)
				.split('\0')
				.filter((path) => path !== '')
			const coAuthors = trailers
				.split('\x1f')
				.map((value) => value.trim())
				.filter((value) => value !== '')
			return { hash, author, email, date: isoDate(time), subject, coAuthors, paths }
		})
}

function parseBlame(stdout: string): BlameLine[] {
	const lines: BlameLine[] = []
	let line = { line: 0, commit: '', author: '', email: '', date: '' }
	for (const row of stdout.split('\n')) {
		const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(row)
		if (header) line = { ...line, commit: header[1] ?? '', line: Number(header[2]) }
		else if (row.startsWith('author ')) line.author = row.slice('author '.length)
		else if (row.startsWith('author-mail ')) line.email = row.slice('author-mail '.length).replace(/^<|>$/g, '')
		else if (row.startsWith('author-time ')) line.date = isoDate(row.slice('author-time '.length))
		else if (row.startsWith('\t')) lines.push({ ...line, text: row.slice(1) })
	}
	return lines
}

function isoDate(unixSeconds: string): string {
	return new Date(Number(unixSeconds) * 1000).toISOString()
}
