// The changed lines for a list of files or for a part. A part also gets its own commits and the names of files
// whose changes have no lines, such as files that moved or changed mode.
import { partChangeQuestion } from '../../follow-up/index.ts'
import { type LayoutSources, readLayoutAsk, under } from '../../layout/index.ts'
import { type Hunk, parsePath } from '../../repo/index.ts'

// The diff of a change is asked a few files at a time and shows this many changed lines, so the page stays light.
const DIFF_PATHS = 10
const DIFF_LINES = 400

export async function readChangeDiff(layout: LayoutSources, query: URLSearchParams) {
	const paths = query.getAll('path').map(parsePath)
	const within = query.getAll('within')
	const byPart = within.length > 0
	const page = Number(query.get('page') ?? 1)
	if (!Number.isSafeInteger(page) || page < 1 || (!byPart && page !== 1))
		return { status: 400, body: { message: 'Choose a page of changes for this part.' } }
	if (
		(byPart && paths.length > 0) ||
		(!byPart && paths.length === 0) ||
		paths.length > DIFF_PATHS ||
		paths.some((p) => p.kind !== 'ok')
	) {
		return { status: 400, body: { message: `Send the part's paths as within, or up to ${DIFF_PATHS} files as path.` } }
	}
	const ask = await readLayoutAsk(layout, { change: query.get('change') ?? '', within }, new Date())
	if (ask.kind !== 'ok') return { status: 400, body: { message: ask.message, field: ask.field } }
	const { change, within: scope } = ask.ask
	if (!change) return { status: 400, body: { message: 'Name the change to show the diff of.' } }
	const wanted = new Set<string>(paths.flatMap((each) => (each.kind === 'ok' ? [each.path] : [])))
	const [diff, history] = await Promise.all([
		layout.repo.diff(change.range, undefined, byPart ? scope : [...wanted]),
		byPart && page === 1 && change.kind !== 'uncommitted'
			? layout.repo.commitsIn(change.range, 40, undefined, scope)
			: null,
	])
	if (diff.kind !== 'ok') return { status: 200, body: { hunks: [], cut: false, binary: [], tooLarge: true } }
	// A move belongs both to the part that lost the file and the one that got it.
	const matches = (path: string) => wanted.has(path) || scope.some((place) => under(path, place))
	const asked = diff.files.filter((file) => matches(file.path) || matches(file.oldPath))
	const start = (page - 1) * DIFF_LINES
	const end = start + DIFF_LINES
	const hunks: ChangedHunk[] = []
	const complete = new Set<string>()
	let at = 0
	for (const file of asked) {
		const from = at
		for (const hunk of file.kind === 'text' ? file.hunks : []) {
			// Git returns these hunks with no context. A missing-newline marker belongs to its preceding line.
			const size = hunk.oldLength + hunk.newLength
			if (at < end && at + size > start) {
				const shown = at >= start && at + size <= end ? hunk : sliceHunk(hunk, start - at, end - at)
				hunks.push({ path: file.path, oldPath: file.oldPath, hunk: shown })
			}
			at += size
		}
		// A file finishes on the page with its last line. Binary and mode-only changes are listed on page one.
		if ((at > from && at > start && at <= end) || (at === from && page === 1)) {
			complete.add(file.path)
			complete.add(file.oldPath)
		}
	}
	const pages = Math.max(1, Math.ceil(at / DIFF_LINES))
	if (page > pages) return { status: 400, body: { message: 'This change has no such page.' } }
	const binary = asked.flatMap((file) => (file.kind === 'binary' ? [file.path, file.oldPath].filter(matches) : []))
	const body = { hunks, cut: page < pages, binary: [...new Set(binary)], tooLarge: false }
	if (!byPart) return { status: 200, body }
	const part = query.get('part')
	return {
		status: 200,
		body: {
			...body,
			range: change.range,
			page,
			pages,
			complete: [...complete],
			...(part ? { question: partChangeQuestion(part, change.range, scope) } : {}),
			files: asked.map(({ path, oldPath }) => ({ path, oldPath })),
			commits:
				history?.kind === 'ok' ? history.commits.map(({ hash, subject, date }) => ({ hash, subject, date })) : [],
			moreCommits: history?.kind === 'ok' ? history.more : 0,
			historyTooLarge: history?.kind === 'too-large',
		},
	}
}

type ChangedHunk = { path: string; oldPath: string; hunk: Hunk }

// Keep whole changed lines and their markers, with the old and new positions of this slice of the hunk.
function sliceHunk(hunk: Hunk, from: number, to: number): Hunk {
	let oldStart = hunk.oldStart
	let newStart = hunk.newStart
	let oldLength = 0
	let newLength = 0
	let index = -1
	const lines = []
	for (const line of hunk.lines) {
		const removed = line.startsWith('-')
		const added = line.startsWith('+')
		if (removed || added) index++
		if (index >= to) break
		if (index < from) {
			if (removed) oldStart++
			if (added) newStart++
		} else {
			lines.push(line)
			if (removed) oldLength++
			if (added) newLength++
		}
	}
	// A zero-length side in a unified diff names the line before the change.
	if (!oldLength && hunk.oldLength) oldStart--
	if (!newLength && hunk.newLength) newStart--
	return { oldStart, newStart, oldLength, newLength, lines }
}
