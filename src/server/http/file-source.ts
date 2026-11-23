// Pages of source in a file brief stay at the commit where the reader opened it.
import { directImports, namedExports, parsePath, type Repository } from '../../repo/index.ts'

const PAGE_LINES = 60
const LINE_CHARS = 2000

export async function readSource(repo: Repository, query: URLSearchParams) {
	const path = parsePath(query.get('path') ?? '')
	const at = query.get('at') ?? ''
	const line = Number(query.get('start') ?? '1')
	if (path.kind !== 'ok' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(at) || !Number.isSafeInteger(line) || line < 1)
		return { status: 400, body: { message: 'Choose a file, a commit and a positive line number.' } }
	const head = await repo.resolve(at)
	if (head.kind !== 'ok') return { status: 404, body: { message: 'This commit is no longer in git.' } }
	const read = await repo.readFile(head.commit, path.path)
	if (read.kind === 'no-file') return { status: 404, body: { message: 'Git has no file at this path in this commit.' } }
	if (read.kind === 'too-large') return { status: 413, body: { message: 'This file is too large for ken to read.' } }
	if (read.text.includes('\0')) return { status: 415, body: { message: 'This is a binary file.' } }
	const lines = read.text.split(/\r?\n/)
	if (lines.at(-1) === '') lines.pop()
	// A quote's old line can fall past the end of a shorter file at the new commit.
	const start = line > lines.length ? Math.max(1, lines.length - PAGE_LINES + 1) : line
	const page = lines.slice(start - 1, start - 1 + PAGE_LINES)
	const request = query.get('uses')
	// A saved source question knows its line range but may predate the lookup of named exports.
	const selectedEnd = request && /^@\d+$/.test(request) ? Number(request.slice(1)) : null
	if (selectedEnd !== null && (!Number.isSafeInteger(selectedEnd) || selectedEnd < line))
		return { status: 400, body: { message: 'Choose a valid source range.' } }
	const names =
		selectedEnd !== null && line > lines.length
			? []
			: namedExports(path.path, lines, start, Math.min(start + page.length - 1, selectedEnd ?? Infinity))
	const use = selectedEnd === null ? request : names.length === 1 ? names[0] : null
	if (typeof use === 'string' && !names.includes(use))
		return { status: 400, body: { message: 'Choose a named export on this page.' } }
	const uses = use ? { name: use, ...(await directImports(repo, head.commit, path.path, use)) } : null
	return {
		status: 200,
		body: {
			start,
			names,
			uses,
			total: lines.length,
			lines: page.map((line) => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line)),
			shortened: page.some((line) => line.length > LINE_CHARS),
			previous: start === 1 ? null : Math.max(1, start - PAGE_LINES),
			next: start + page.length <= lines.length ? start + page.length : null,
		},
	}
}
