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
		byPart && change.kind !== 'uncommitted' ? layout.repo.commitsIn(change.range, 40, undefined, scope) : null,
	])
	if (diff.kind !== 'ok') return { status: 200, body: { hunks: [], cut: false, binary: [], tooLarge: true } }
	// A move belongs both to the part that lost the file and the one that got it.
	const matches = (path: string) => wanted.has(path) || scope.some((place) => under(path, place))
	const asked = diff.files.filter((file) => matches(file.path) || matches(file.oldPath))
	const hunks = asked.flatMap((file) =>
		file.kind === 'text' ? file.hunks.map((hunk) => ({ path: file.path, oldPath: file.oldPath, hunk })) : [],
	)
	const binary = asked.flatMap((file) => (file.kind === 'binary' ? [file.path, file.oldPath].filter(matches) : []))
	const body = { ...cutAt(hunks, DIFF_LINES), binary: [...new Set(binary)], tooLarge: false }
	if (!byPart) return { status: 200, body }
	const part = query.get('part')
	return {
		status: 200,
		body: {
			...body,
			range: change.range,
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

// The hunks up to most changed lines, in the shape a walkthrough step's hunks have. The hunk that passes the limit
// keeps the lines that fit and counts them again, and cut says the diff goes on.
function cutAt(hunks: ChangedHunk[], most: number): { hunks: ChangedHunk[]; cut: boolean } {
	const changed = (line: string) => line.startsWith('+') || line.startsWith('-')
	const kept: ChangedHunk[] = []
	let room = most
	for (const each of hunks) {
		const lines: string[] = []
		for (const line of each.hunk.lines) {
			if (changed(line) && room === 0) break
			if (changed(line)) room -= 1
			lines.push(line)
		}
		if (lines.length === each.hunk.lines.length) {
			kept.push(each)
			continue
		}
		const allBut = (sign: string) => lines.filter((line) => !line.startsWith(sign) && !line.startsWith('\\')).length
		if (lines.some(changed)) {
			kept.push({ ...each, hunk: { ...each.hunk, lines, oldLength: allBut('+'), newLength: allBut('-') } })
		}
		return { hunks: kept, cut: true }
	}
	return { hunks: kept, cut: false }
}
