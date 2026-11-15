// The tools the model explores the project with. Each wraps one read of the repo module, so none of them can change
// the project. Every ref and path the model sends goes through repo's resolve or parsePath before git sees it, and
// every result is short text with a size limit.
import type { Tool, ToolResult } from 'aigent/plugin'
import { type CommitHash, parsePath, type RepoPath, type Repository } from '../../repo/index.ts'
import { readArgs, refuse, reply, short } from './tool-edge.ts'

const MAX_READ_LINES = 400
const MAX_PATHS = 400
const MAX_MATCHES = 100
const MAX_COMMITS = 100
const MAX_BLAME_LINES = 200
const MAX_LINE_CHARS = 300

const COMMIT = {
	type: 'string',
	description: 'A commit: a hash, a branch, a tag or a ref such as HEAD~2. Default HEAD.',
}
const RANGE = {
	base: { type: 'string', description: 'The commit the change starts from, such as main or a merge commit^1' },
	head: { type: 'string', description: 'The last commit of the change, such as HEAD or a branch' },
}

export function explorationTools(repo: Repository): Tool[] {
	return [
		{
			name: 'resolve_ref',
			description: 'Turn a ref such as HEAD~2, a branch, a tag or a short hash into a full commit hash.',
			parameters: {
				type: 'object',
				properties: { ref: { type: 'string' } },
				required: ['ref'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				const ref = readArgs(args, 'resolve_ref').text('ref')
				const commit = await commitAt(repo, ref, ctx.signal)
				if (commit.kind !== 'ok') return commit.result
				return reply(`${ref} is ${commit.commit}.`)
			},
		},
		{
			name: 'read_file',
			description: `Read a file at a commit. Each line comes with its number. Quote lines exactly as they appear here, without the numbers. Gives at most ${MAX_READ_LINES} lines per call, so use start and end for the rest.`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The path from the repository root' },
					commit: COMMIT,
					start: { type: 'integer', minimum: 1, description: 'First line to read. Default 1.' },
					end: { type: 'integer', minimum: 1, description: 'Last line to read.' },
				},
				required: ['path'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				const read = readArgs(args, 'read_file')
				const target = await fileAt(repo, read.text('path'), read.optionalText('commit'), ctx.signal)
				if (target.kind !== 'ok') return target.result
				const file = await repo.readFile(target.commit, target.path, ctx.signal)
				if (file.kind === 'no-file') return refuse(`There is no file ${target.path} at ${short(target.commit)}.`)
				if (file.kind === 'too-large') return refuse(`${target.path} is larger than ${file.limitBytes} bytes.`)
				const lines = file.text.split('\n')
				if (lines.at(-1) === '') lines.pop()
				const where = `${target.path} at ${short(target.commit)}`
				if (lines.length === 0) return reply(`${where} is empty.`)
				const start = read.optionalLine('start') ?? 1
				if (start > lines.length) return refuse(`${where} has only ${lines.length} lines.`)
				const end = Math.min(read.optionalLine('end') ?? lines.length, lines.length, start + MAX_READ_LINES - 1)
				if (end < start) return refuse(`end ${end} comes before start ${start}.`)
				const numbered = lines
					.slice(start - 1, end)
					.map((line, index) => `${String(start + index).padStart(6)}\t${line}`)
				const more =
					end < lines.length ? `\nThe file goes on to line ${lines.length}. Read on with start ${end + 1}.` : ''
				return reply(`${where}, lines ${start}-${end} of ${lines.length}:\n${numbered.join('\n')}${more}`)
			},
		},
		{
			name: 'list_files',
			description: `List the files at a commit, optionally only those under one folder. Gives at most ${MAX_PATHS} paths.`,
			parameters: {
				type: 'object',
				properties: { commit: COMMIT, under: { type: 'string', description: 'A folder from the repository root' } },
				additionalProperties: false,
			},
			async execute(args, ctx) {
				const read = readArgs(args, 'list_files')
				const scope = await scopeAt(repo, read.optionalText('commit'), read.optionalText('under'), ctx.signal)
				if (scope.kind !== 'ok') return scope.result
				const listed = await repo.listFiles(scope.commit, ctx.signal)
				if (listed.kind === 'too-large') return refuse('The list of files is too large. Give under to narrow it.')
				const paths = listed.paths.filter(scope.contains)
				const shown = paths.slice(0, MAX_PATHS)
				const more = paths.length > shown.length ? `\nShowing ${shown.length}. Give under to narrow the list.` : ''
				return reply(`${paths.length} files at ${short(scope.commit)}${scope.label}:\n${shown.join('\n')}${more}`)
			},
		},
		{
			name: 'search',
			description: `Search the files at a commit with an extended regular expression, as git grep -E does. Gives path:line: text for at most ${MAX_MATCHES} matching lines.`,
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'An extended regular expression' },
					commit: COMMIT,
					under: { type: 'string', description: 'Search only under this folder' },
				},
				required: ['pattern'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				const read = readArgs(args, 'search')
				const pattern = read.text('pattern')
				const scope = await scopeAt(repo, read.optionalText('commit'), read.optionalText('under'), ctx.signal)
				if (scope.kind !== 'ok') return scope.result
				const found = await repo.search(scope.commit, pattern, ctx.signal)
				if (found.kind === 'bad-pattern') return refuse(`The pattern does not work: ${found.message}`)
				if (found.kind === 'too-large') return refuse('The pattern matches too much. Make it narrower.')
				const matches = found.matches.filter((match) => scope.contains(match.path))
				const shown = matches.slice(0, MAX_MATCHES).map((match) => `${match.path}:${match.line}: ${cut(match.text)}`)
				const more = matches.length > shown.length ? `\nShowing ${shown.length}. Narrow the pattern or give under.` : ''
				return reply(
					`${matches.length} matching lines at ${short(scope.commit)}${scope.label}:\n${shown.join('\n')}${more}`,
				)
			},
		},
		{
			name: 'log',
			description: `List the commits in base..head, the ones head has and base does not, newest first, with author, date and the files each changed. Gives at most ${MAX_COMMITS} commits.`,
			parameters: { type: 'object', properties: RANGE, required: ['base', 'head'], additionalProperties: false },
			async execute(args, ctx) {
				const read = readArgs(args, 'log')
				const range = await rangeAt(repo, read.text('base'), read.text('head'), ctx.signal)
				if (range.kind !== 'ok') return range.result
				const logged = await repo.log(range, ctx.signal)
				if (logged.kind === 'too-large') return refuse('The range is too large. Ask for a shorter one.')
				const shown = logged.commits.slice(0, MAX_COMMITS).map((commit) => {
					const files = commit.paths.length === 1 ? '1 file' : `${commit.paths.length} files`
					return `${short(commit.hash)} ${commit.date.slice(0, 10)} ${commit.author}: ${commit.subject} (${files})`
				})
				const more = logged.commits.length > shown.length ? `\nShowing the newest ${shown.length}.` : ''
				return reply(
					`${logged.commits.length} commits in ${short(range.base)}..${short(range.head)}:\n${shown.join('\n')}${more}`,
				)
			},
		},
		{
			name: 'blame',
			description: `Show, for each line in a range of a file at a commit, the commit, author and date that last changed it. Gives at most ${MAX_BLAME_LINES} lines.`,
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The path from the repository root' },
					start: { type: 'integer', minimum: 1 },
					end: { type: 'integer', minimum: 1 },
					commit: COMMIT,
				},
				required: ['path', 'start', 'end'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				const read = readArgs(args, 'blame')
				const target = await fileAt(repo, read.text('path'), read.optionalText('commit'), ctx.signal)
				if (target.kind !== 'ok') return target.result
				const start = read.optionalLine('start') ?? 1
				const end = Math.min(read.optionalLine('end') ?? start, start + MAX_BLAME_LINES - 1)
				const blamed = await repo.blame(target.commit, target.path, { start, end }, ctx.signal)
				if (blamed.kind === 'no-file') return refuse(`There is no file ${target.path} at ${short(target.commit)}.`)
				if (blamed.kind === 'bad-lines') return refuse(`Those lines do not work: ${blamed.message}`)
				if (blamed.kind === 'too-large') return refuse('The blame is too large. Ask for fewer lines.')
				const rows = blamed.lines.map(
					(line) =>
						`${String(line.line).padStart(6)} ${short(line.commit)} ${line.date.slice(0, 10)} ${line.author}\t${line.text}`,
				)
				return reply(`${target.path} at ${short(target.commit)}, lines ${start}-${end}:\n${rows.join('\n')}`)
			},
		},
	]
}

type Refusal = { kind: 'refused'; result: ToolResult }

export async function commitAt(
	repo: Repository,
	ref: string,
	signal: AbortSignal,
): Promise<{ kind: 'ok'; commit: CommitHash } | Refusal> {
	const resolved = await repo.resolve(ref, signal)
	if (resolved.kind === 'ok') return resolved
	const text = resolved.kind === 'refused' ? `Refused: ${resolved.reason}.` : `There is no commit "${ref}".`
	return { kind: 'refused', result: refuse(text) }
}

export async function rangeAt(
	repo: Repository,
	base: string,
	head: string,
	signal: AbortSignal,
): Promise<{ kind: 'ok'; base: CommitHash; head: CommitHash } | Refusal> {
	const from = await commitAt(repo, base, signal)
	if (from.kind !== 'ok') return from
	const to = await commitAt(repo, head, signal)
	if (to.kind !== 'ok') return to
	return { kind: 'ok', base: from.commit, head: to.commit }
}

export function pathOf(raw: string): { kind: 'ok'; path: RepoPath } | Refusal {
	const parsed = parsePath(raw)
	if (parsed.kind === 'ok') return parsed
	return { kind: 'refused', result: refuse(`Refused: ${parsed.reason}.`) }
}

async function fileAt(repo: Repository, rawPath: string, ref: string | undefined, signal: AbortSignal) {
	const path = pathOf(rawPath)
	if (path.kind !== 'ok') return path
	const commit = await commitAt(repo, ref ?? 'HEAD', signal)
	if (commit.kind !== 'ok') return commit
	return { kind: 'ok', commit: commit.commit, path: path.path } as const
}

async function scopeAt(repo: Repository, ref: string | undefined, under: string | undefined, signal: AbortSignal) {
	const commit = await commitAt(repo, ref ?? 'HEAD', signal)
	if (commit.kind !== 'ok') return commit
	if (under === undefined) return { kind: 'ok', commit: commit.commit, label: '', contains: () => true } as const
	const folder = pathOf(under)
	if (folder.kind !== 'ok') return folder
	const prefix = `${folder.path}/`
	return {
		kind: 'ok',
		commit: commit.commit,
		label: ` under ${folder.path}`,
		contains: (path: string) => path.startsWith(prefix),
	} as const
}

function cut(line: string): string {
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [line cut]` : line
}
