import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDiff, parseNumstat } from './parse-diff.ts'
import type { BlameLine, Commit, CommitHash, ObjectId, Repository, SearchMatch, Uncommitted } from './repository.ts'
import { MAX_OUTPUT_BYTES, runGit } from './run-git.ts'

// ken commits its own record to .ken/. Those bookkeeping commits are not changes to explain (plan risk: "The record's
// own files pollute the history"), so every change fact reads git through this pathspec and no other.
const OUTSIDE_RECORD = ['--', '.', ':(exclude).ken']

const literalPaths = (paths: string[]) => ['--', ...paths.map((path) => `:(literal)${path}`), ':(exclude).ken']

const RECORD = '.ken'
const outsideRecord = (file: string) => file !== RECORD && !file.startsWith(`${RECORD}/`)

const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
// A new file larger than this is not read to count its lines.
const MAX_COUNTED_BYTES = 1024 * 1024
const LOG_FORMAT =
	'--format=%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%(trailers:key=Co-authored-by,valueonly,separator=%x1f)'
// How much git output this repository keeps, in characters, and the most it keeps of one command.
const KEPT_CHARS = 32 * 1024 * 1024
const KEPT_ONE = 1024 * 1024

// alternate is a folder of git objects this repository may also read, such as ken's store of snapshots of uncommitted
// work, so a commit there reads like one of the project's own.
export function gitRepository(root: string, options: { alternate?: string } = {}): Repository {
	const git = (args: string[], signal?: AbortSignal, input = '') =>
		runGit(root, args, signal, options.alternate ?? null, input)

	// A commit never changes, so git prints the same each time for a command that names commits only by their hashes.
	// Such a command runs once and its output is kept, the newest last, so every page that asks again reads it from here.
	// A command that names a ref, the working tree or the config runs every time: HEAD is always read afresh.
	const kept = new Map<string, string>()
	let keptChars = 0
	async function gitKept(
		commits: string[],
		args: string[],
		signal?: AbortSignal,
		input = '',
		maxBytes = MAX_OUTPUT_BYTES,
	) {
		// A name such as HEAD can point somewhere new, so only output for full hashes is kept.
		if (!commits.every((each) => HASH.test(each))) {
			return runGit(root, args, signal, options.alternate ?? null, input, maxBytes)
		}
		const key = JSON.stringify([args, input, maxBytes])
		const stdout = kept.get(key)
		if (stdout !== undefined) {
			kept.delete(key)
			kept.set(key, stdout)
			return { kind: 'ok', stdout } as const
		}
		const run = await runGit(root, args, signal, options.alternate ?? null, input, maxBytes)
		if (run.kind !== 'ok' || run.stdout.length > KEPT_ONE || kept.has(key)) return run
		kept.set(key, run.stdout)
		keptChars += run.stdout.length
		for (const [old, text] of kept) {
			if (keptChars <= KEPT_CHARS) break
			kept.delete(old)
			keptChars -= text.length
		}
		return run
	}
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

		async readFile(commit, path, signal, maxBytes = MAX_OUTPUT_BYTES) {
			const run = await gitKept([commit], ['cat-file', 'blob', `${commit}:${path}`], signal, '', maxBytes)
			if (run.kind === 'too-large') return { kind: 'too-large', limitBytes: maxBytes }
			if (run.kind === 'failed') return { kind: 'no-file', path, commit }
			return { kind: 'ok', text: run.stdout }
		},

		async listFiles(commit, signal) {
			const run = await gitKept([commit], ['ls-tree', '-r', '-z', '--name-only', '--full-tree', commit], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git ls-tree failed on a resolved commit: ${run.stderr}`)
			return { kind: 'ok', paths: run.stdout.split('\0').filter((path) => path !== '') }
		},

		async lineCounts(commit, signal) {
			// An empty pattern matches every line, so git grep counts them, in one call over the whole tree.
			const run = await git(['grep', '-c', '-z', '-I', '--no-color', '-e', '', commit, '--'], signal)
			if (run.kind === 'too-large') return tooLarge
			// git grep exits 1 when no file has a line.
			if (run.kind === 'failed' && run.code !== 1)
				throw new Error(`git grep failed on a resolved commit: ${run.stderr}`)
			const lines = new Map<string, number>()
			for (const record of run.kind === 'ok' ? run.stdout.split('\n') : []) {
				const [where = '', count = ''] = record.split('\0')
				if (where !== '') lines.set(where.slice(commit.length + 1), Number(count))
			}
			return { kind: 'ok', lines }
		},

		async search(commit, pattern, signal, paths) {
			if (pattern.includes('\0')) return { kind: 'bad-pattern', message: 'the pattern holds a NUL byte' }
			const args = [
				'grep',
				'-n',
				'-z',
				'-I',
				'--no-color',
				'--no-column',
				'-E',
				'-e',
				pattern,
				commit,
				...(paths ? literalPaths(paths) : ['--']),
			]
			const run = await git(args, signal)
			if (run.kind === 'too-large') return tooLarge
			// git grep exits 1 when nothing matches and 128 when the pattern does not compile.
			if (run.kind === 'failed') {
				return run.code === 1 ? { kind: 'ok', matches: [] } : { kind: 'bad-pattern', message: run.stderr }
			}
			return { kind: 'ok', matches: parseGrep(run.stdout, commit) }
		},

		async mergeBase(base, head, signal) {
			const run = await gitKept([base, head], ['merge-base', base, head], signal)
			const hash = run.kind === 'ok' ? run.stdout.trim() : ''
			if (!HASH.test(hash)) return { kind: 'unrelated', base, head }
			return { kind: 'ok', commit: hash as CommitHash }
		},

		async firstCommit(signal) {
			const run = await git(['rev-list', '--max-parents=0', 'HEAD'], signal)
			const oldest = run.kind === 'ok' ? (run.stdout.trim().split('\n').at(-1) ?? '') : ''
			return HASH.test(oldest) ? (oldest as CommitHash) : null
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
			const run = await gitKept([base, head], [...args, ...OUTSIDE_RECORD], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on resolved commits: ${run.stderr}`)
			return { kind: 'ok', commits: parseLog(run.stdout) }
		},

		async commitsIn({ base, head }, limit, signal, within = []) {
			const paths = within.length ? literalPaths(within) : OUTSIDE_RECORD
			const range = ['--full-history', `${base}..${head}`, ...paths]
			const shared = ['--no-merges', ...range]
			const run = await git(['log', '-z', '--no-color', `--max-count=${limit + 1}`, LOG_FORMAT, ...shared], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on resolved commits: ${run.stderr}`)
			// rev-list counts without printing a commit.
			const count = async (args: string[]) => {
				const counted = await git(['rev-list', '--count', ...args], signal)
				if (counted.kind !== 'ok') throw new Error(`git rev-list failed on resolved commits: ${counted.kind}`)
				return Number(counted.stdout.trim())
			}
			const merges = await count(['--merges', ...range])
			const commits = parseLog(run.stdout).map(({ paths: _, ...commit }) => commit)
			if (commits.length <= limit) return { kind: 'ok', commits, more: 0, merges, oldest: commits.at(-1)?.date ?? null }
			// Only a range longer than the limit is counted, and its oldest commit read alone.
			const total = await count(shared)
			const last = await git(
				['log', '-z', '--no-color', `--skip=${total - 1}`, '--max-count=1', LOG_FORMAT, ...shared],
				signal,
			)
			const oldest = last.kind === 'ok' ? (parseLog(last.stdout)[0]?.date ?? null) : null
			return { kind: 'ok', commits: commits.slice(0, limit), more: total - limit, merges, oldest }
		},

		async lastCommitBy(head, email, signal) {
			// git matches the author as "Name <email>", so the brackets keep a longer email from matching.
			const args = [
				'log',
				'-1',
				'-z',
				'--fixed-strings',
				'--regexp-ignore-case',
				`--author=<${email}>`,
				LOG_FORMAT,
				head,
			]
			const run = await git(args, signal)
			if (run.kind === 'failed') throw new Error(`git log failed on a resolved commit: ${run.stderr}`)
			return run.kind === 'ok' ? (parseLog(run.stdout)[0] ?? null) : null
		},

		async landedAfter(head, after, signal) {
			const landed = new Map<string, Commit[] | null>(after.map((hash) => [hash, null]))
			const asked = [...landed.keys()].filter((hash) => HASH.test(hash))
			if (asked.length === 0) return { kind: 'ok', landed }
			const typed = await git(['cat-file', '--batch-check=%(objecttype)'], signal, asked.map((h) => `${h}\n`).join(''))
			if (typed.kind !== 'ok') throw new Error(`git cat-file failed on hashes: ${typed.kind}`)
			const types = typed.stdout.split('\n')
			const commits = asked.filter((_, index) => types[index] === 'commit')
			if (commits.length === 0) return { kind: 'ok', landed }
			// One log from the newest commit that head and every commit asked share. It holds all that landed after any of
			// them, and the parents in it say which of those each commit asked already had.
			const shared = await gitKept([head, ...commits], ['merge-base', '--octopus', head, ...commits], signal)
			const from = shared.kind === 'ok' ? shared.stdout.trim() : ''
			const range = HASH.test(from) ? `${from}..${head}` : head
			const run = await gitKept(
				[head, ...commits],
				['log', '-z', '--name-only', '--no-renames', '--no-color', LOG_FORMAT, range],
				signal,
			)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on resolved commits: ${run.stderr}`)
			const log = parseLog(run.stdout).map((commit) => ({ ...commit, paths: commit.paths.filter(outsideRecord) }))
			const parents = new Map<string, string[]>(log.map((commit) => [commit.hash, commit.parents]))
			for (const commit of commits) {
				if (commit !== from && !parents.has(commit)) continue
				const had = new Set<string>()
				const walk = [commit]
				for (let next = walk.pop(); next !== undefined; next = walk.pop()) {
					if (had.has(next)) continue
					had.add(next)
					walk.push(...(parents.get(next) ?? []))
				}
				landed.set(
					commit,
					log.filter((each) => !had.has(each.hash) && each.parents.length < 2 && each.paths.length > 0),
				)
			}
			return { kind: 'ok', landed }
		},

		async message(commit, signal) {
			const run = await git(['log', '-1', '--no-color', '--format=%B', commit], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on a resolved commit: ${run.stderr}`)
			return { kind: 'ok', text: run.stdout.replace(/\n+$/, '') }
		},

		async mainLine(head, limit, signal) {
			const args = [
				'log',
				'-z',
				'--name-only',
				'--no-renames',
				'--first-parent',
				'--diff-merges=first-parent',
				'--no-color',
				`--max-count=${limit}`,
				LOG_FORMAT,
				head,
			]
			const run = await gitKept([head], [...args, ...OUTSIDE_RECORD], signal)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git log failed on a resolved commit: ${run.stderr}`)
			return { kind: 'ok', commits: parseLog(run.stdout) }
		},

		async before(head, moment, signal) {
			const run = await git(['rev-list', '--first-parent', '--max-count=1', `--before=${moment}`, head], signal)
			const hash = run.kind === 'ok' ? run.stdout.trim() : ''
			return HASH.test(hash) ? (hash as CommitHash) : null
		},

		async diffFiles({ base, head }, signal) {
			const run = await gitKept(
				[base, head],
				['diff', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', base, head, ...OUTSIDE_RECORD],
				signal,
			)
			if (run.kind === 'too-large') return tooLarge
			if (run.kind === 'failed') throw new Error(`git diff failed on resolved commits ${base} and ${head}`)
			return { kind: 'ok', files: parseNumstat(run.stdout) }
		},

		async diff({ base, head }, signal, within = []) {
			const args = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', base, head]
			let paths = OUTSIDE_RECORD
			if (within.length) {
				// Git only pairs a move when both names are in the patch. Find the other end before limiting the patch.
				const moves = await gitKept(
					[base, head],
					['diff', '--name-status', '-z', '--diff-filter=R', ...args, ...OUTSIDE_RECORD],
					signal,
				)
				if (moves.kind === 'too-large') return tooLarge
				if (moves.kind === 'failed') throw new Error(`git diff failed on resolved commits ${base} and ${head}`)
				const names = moves.stdout.split('\0')
				const inScope = (file: string) => within.some((place) => file === place || file.startsWith(`${place}/`))
				const scope = new Set(within)
				for (let at = 0; at + 2 < names.length; at += 3) {
					const from = names[at + 1] ?? ''
					const to = names[at + 2] ?? ''
					if (inScope(from) && !inScope(to)) scope.add(to)
					else if (inScope(to) && !inScope(from)) scope.add(from)
				}
				paths = literalPaths([...scope])
			}
			const common = [...args, ...paths]
			const [numstat, patch] = await Promise.all([
				gitKept([base, head], ['diff', '--numstat', '-z', ...common], signal),
				gitKept([base, head], ['diff', '-U0', ...common], signal),
			])
			if (numstat.kind === 'too-large' || patch.kind === 'too-large') return tooLarge
			if (numstat.kind === 'failed' || patch.kind === 'failed') {
				throw new Error(`git diff failed on resolved commits ${base} and ${head}`)
			}
			return { kind: 'ok', files: parseDiff(numstat.stdout, patch.stdout) }
		},

		async branch(signal) {
			const run = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
			return run.kind === 'ok' && run.stdout.trim() !== '' ? run.stdout.trim() : null
		},

		async branches(signal) {
			const run = await git(
				['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'],
				signal,
			)
			return run.kind === 'ok' ? run.stdout.split('\n').filter((name) => name !== '') : []
		},

		async isBranch(name, signal) {
			const run = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], signal)
			return run.kind === 'ok' && run.stdout.split('\n').includes(name)
		},

		// cat-file reads "<commit>:<path>" exactly, where ls-tree would read a path as a pattern and list a folder's
		// children. It answers one line per line it reads, so the answers pair up with the paths by position. A path
		// with a line break in it cannot be sent that way, so it reads as not there.
		async objectIds(commit, paths, signal) {
			const sent = paths.filter((each) => !each.includes('\n'))
			if (sent.length === 0) return paths.map(() => null)
			const asked = sent.map((each) => `${commit}:${each}\n`).join('')
			const run = await gitKept([commit], ['cat-file', '--batch-check=%(objectname)'], signal, asked)
			if (run.kind !== 'ok') throw new Error(`git cat-file failed on a resolved commit: ${run.kind}`)
			const lines = run.stdout.split('\n')
			const answers = new Map(sent.map((each, index) => [each, lines[index] ?? '']))
			return paths.map((each) => {
				const answer = answers.get(each) ?? ''
				return HASH.test(answer) ? (answer as ObjectId) : null
			})
		},

		// Plumbing only: diff-index and ls-files never write the index, where git status and git diff may refresh it.
		async uncommitted(signal) {
			const [numstat, others] = await Promise.all([
				git(['diff-index', '--numstat', '-z', '--no-renames', 'HEAD', ...OUTSIDE_RECORD], signal),
				git(['ls-files', '--others', '--exclude-standard', '-z', ...OUTSIDE_RECORD], signal),
			])
			if (numstat.kind === 'too-large' || others.kind === 'too-large') return tooLarge
			if (numstat.kind === 'failed' || others.kind === 'failed') return { kind: 'ok', files: [] }
			const files: Uncommitted[] = []
			for (const record of numstat.stdout.split('\0')) {
				const [added = '', removed = '', file = ''] = record.split('\t')
				if (file === '') continue
				const copy = await workingCopy(root, file)
				// A file git lists only because its timestamps moved has no changed line.
				if (added === '0' && removed === '0' && copy !== null) continue
				files.push({
					path: file,
					change: copy === null ? 'deleted' : 'changed',
					added: added === '-' ? null : Number(added),
					removed: removed === '-' ? null : Number(removed),
					bytes: copy?.bytes ?? null,
					modifiedAt: copy?.modifiedAt ?? null,
				})
			}
			for (const file of others.stdout.split('\0').filter((name) => name !== '')) {
				const copy = await workingCopy(root, file)
				if (copy === null) continue
				files.push({ path: file, change: 'new', added: copy.lines, removed: 0, ...copy })
			}
			return { kind: 'ok', files }
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

// The size, last change and line count of a file in the working tree, or null when it is gone. lines is null for a
// binary file and for one too large to read.
async function workingCopy(root: string, file: string) {
	const info = await lstat(path.join(root, file)).catch(() => null)
	if (info === null) return null
	const facts = { bytes: info.size, modifiedAt: info.mtimeMs }
	if (!info.isFile() || info.size > MAX_COUNTED_BYTES) return { ...facts, lines: null }
	const text = await readFile(path.join(root, file))
	if (text.includes(0)) return { ...facts, lines: null }
	const breaks = text.reduce((n, byte) => (byte === 10 ? n + 1 : n), 0)
	return { ...facts, lines: text.length > 0 && text.at(-1) !== 10 ? breaks + 1 : breaks }
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
			const [hash = '', parents = '', author = '', email = '', time = '', subject = '', trailers = '', ...rest] =
				record.split('\0')
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
			const parentList = parents.split(' ').filter((parent): parent is CommitHash => HASH.test(parent))
			// git printed the hash itself, so it names a commit.
			const commit = hash as CommitHash
			return { hash: commit, parents: parentList, author, email, date: isoDate(time), subject, coAuthors, paths }
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
