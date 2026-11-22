// A level of the project's layout as ken's model names it: 2 to 6 parts, each a name, a one-line job and the paths it
// holds, and at most 8 arrows between them. ken checks every path with git, and every arrow rests on quoted lines in a
// file of the part it starts at that name a folder or file of the part it ends at, as an import line does, and are not
// all comments. So an arrow is never the model's guess, and no parser is needed. ken stores git's id of each path, so it can tell later,
// at any commit, which parts changed since the model named them.
import { type GitQuote, type VerifiedGitQuote, verifyGitQuote } from '../checks/index.ts'
import { type CommitHash, type ObjectId, parsePath, type RepoPath, type Repository } from '../repo/index.ts'

export type Place = { path: RepoPath; id: ObjectId }
export type Part = { name: string; job: string; places: Place[] }
export type PartArrow = { from: string; to: string; text: string; quotes: VerifiedGitQuote[] }

// within is the paths this level shows the inside of, sorted, and empty for the whole project. A part opens the level
// whose within is the part's paths, so zoom is a lookup with nothing to keep in step. about is the model's sentence or
// two on the level as a whole. asked is the reader's own words when ken drew the level because they asked for another
// way to show it: plain code sets it, never the model. A layout stored before ken kept either has neither, and a
// layout without one has no such key, so its id in the record stays what it was.
export type Layout = {
	kind: 'layout'
	within: RepoPath[]
	drawnAt: CommitHash
	parts: Part[]
	arrows: PartArrow[]
	about?: string
	asked?: string
}

// at is the commit the model read, HEAD when left out.
export type LayoutDraft = {
	within: string[]
	at: string | undefined
	parts: { name: string; job: string; paths: string[] }[]
	arrows: { from: string; to: string; text: string; quotes: GitQuote[] }[]
	about?: string | undefined
	asked?: string | undefined
}

export const LAYOUT_BOUNDS = {
	fewest: 2,
	parts: 6,
	arrows: 8,
	quotes: 3,
	name: 40,
	job: 120,
	text: 40,
	about: 240,
	asked: 300,
} as const

export type LayoutCheck = { kind: 'ok'; layout: Layout } | { kind: 'refused'; problems: string[] }

// ken's own record is not part of the project's code.
const RECORD = '.ken'

// Refuses with every problem it finds. where names the layout in each problem, such as "The layout".
export async function checkLayout(
	repo: Repository,
	draft: LayoutDraft,
	where: string,
	signal?: AbortSignal,
): Promise<LayoutCheck> {
	const problems: string[] = []
	const say = (problem: string) => problems.push(`${where}: ${problem}`)
	const ref = draft.at?.trim() || 'HEAD'
	const at = await repo.resolve(ref, signal)
	if (at.kind !== 'ok') return { kind: 'refused', problems: [`${where}: "${ref}" is not a commit of this project.`] }
	const listed = await repo.listFiles(at.commit, signal)
	if (listed.kind !== 'ok')
		return { kind: 'refused', problems: [`${where}: the project has too many files to lay out.`] }
	const files = listed.paths.filter((file) => !under(file, RECORD))

	const within = pathsOf(draft.within, 'within', say)
	const { fewest, parts: most, arrows: mostArrows, quotes: mostQuotes } = LAYOUT_BOUNDS
	if (draft.parts.length < fewest || draft.parts.length > most) {
		say(`it has ${draft.parts.length} parts. Name ${fewest} to ${most}.`)
	}
	if (draft.arrows.length > mostArrows) say(`it has ${draft.arrows.length} arrows. Keep it to ${mostArrows}.`)
	for (const place of within) {
		if (!files.some((file) => under(file, place)))
			say(`within names ${place}, which holds no file at ${short(at.commit)}.`)
	}
	const about = draft.about?.trim() || undefined
	const asked = draft.asked?.trim() || undefined
	for (const [what, text, most] of [
		['about', about, LAYOUT_BOUNDS.about],
		["the reader's request", asked, LAYOUT_BOUNDS.asked],
	] as const) {
		if (text && text.length > most) say(`${what} has ${text.length} characters. Keep it to ${most}.`)
	}

	const parts = draft.parts.map((part, index) => {
		const name = part.name.trim()
		const field = `part ${index + 1} ("${name}")`
		limit(field, 'name', name, LAYOUT_BOUNDS.name, say)
		limit(field, 'job', part.job.trim(), LAYOUT_BOUNDS.job, say)
		if (part.paths.length === 0) say(`${field} holds no path.`)
		const paths = pathsOf(part.paths, field, say)
		for (const place of paths) {
			if (!files.some((file) => under(file, place))) say(`${field}: ${place} holds no file at ${short(at.commit)}.`)
			else if (within.length > 0 && !within.some((scope) => under(place, scope)))
				say(`${field}: ${place} is outside ${within.join(', ')}, the paths this level shows.`)
		}
		return { name, job: part.job.trim(), paths }
	})
	for (const [index, part] of parts.entries()) {
		for (const other of parts.slice(index + 1)) {
			if (sameName(part.name, other.name)) say(`two parts are named "${part.name}". Give each its own name.`)
			const shared = part.paths.find((place) => other.paths.some((each) => under(place, each) || under(each, place)))
			if (shared !== undefined) say(`"${part.name}" and "${other.name}" share ${shared}. A file sits in one part.`)
		}
	}

	const partNamed = (name: string) => parts.find((part) => sameName(part.name, name))
	const arrows: PartArrow[] = []
	for (const [index, arrow] of draft.arrows.entries()) {
		const field = `arrow ${index + 1} (${arrow.from} ${arrow.text} ${arrow.to})`
		const from = partNamed(arrow.from)
		const to = partNamed(arrow.to)
		limit(field, 'text', arrow.text.trim(), LAYOUT_BOUNDS.text, say)
		if (!from) say(`${field} starts at "${arrow.from}", which is no part.`)
		if (!to) say(`${field} ends at "${arrow.to}", which is no part.`)
		if (from && from === to) say(`${field} goes from a part to itself.`)
		if (arrow.quotes.length === 0) {
			say(`${field} has no quote. Quote the lines in ${arrow.from} that use ${arrow.to}, such as an import line.`)
		}
		if (arrow.quotes.length > mostQuotes) say(`${field} has ${arrow.quotes.length} quotes. Keep it to ${mostQuotes}.`)
		const quotes: VerifiedGitQuote[] = []
		for (const [at, quote] of arrow.quotes.entries()) {
			const verdict = await verifyGitQuote(repo, quote, signal)
			const which = `${field}, quote ${at + 1}`
			if (verdict.kind !== 'verified') {
				say(`${which}: ${verdict.problem}`)
				continue
			}
			const { path } = verdict.quote
			if (from && (path === null || !from.paths.some((place) => under(path, place)))) {
				say(
					`${which} is from ${path ?? 'a commit message'}, which is not in ${from.name}. Quote a file of the part the arrow starts at.`,
				)
			}
			if (onlyComments(verdict.quote.text)) {
				say(`${which} holds only comments. Quote a line of code that uses ${arrow.to}, such as an import line.`)
			} else if (to && !namesPart(verdict.quote.text, to.paths)) {
				say(
					`${which} names no folder or file of ${to.name} (${to.paths.map(segment).join(', ')}). Quote a line that does, such as an import line.`,
				)
			}
			quotes.push(verdict.quote)
		}
		if (from && to) arrows.push({ from: from.name, to: to.name, text: arrow.text.trim(), quotes })
	}

	if (problems.length > 0) return { kind: 'refused', problems }
	const places = parts.flatMap((part) => part.paths)
	const ids = await repo.objectIds(at.commit, places, signal)
	const idOf = new Map(places.map((place, index) => [place, ids[index]]))
	return {
		kind: 'ok',
		layout: {
			kind: 'layout',
			within: [...new Set(within)].sort(),
			drawnAt: at.commit,
			parts: parts.map((part) => ({
				name: part.name,
				job: part.job,
				// Every path holds a file at drawnAt, checked above, so git has an id for each.
				places: part.paths.map((place) => ({ path: place, id: idOf.get(place) ?? ('' as ObjectId) })),
			})),
			arrows,
			...(about ? { about } : {}),
			...(asked ? { asked } : {}),
		},
	}
}

// The draft that checks back to the same layout, so the project record can check a stored one again.
export function layoutDraft(layout: Layout): LayoutDraft {
	return {
		within: layout.within,
		at: layout.drawnAt,
		parts: layout.parts.map((part) => ({ name: part.name, job: part.job, paths: part.places.map((p) => p.path) })),
		arrows: layout.arrows.map((arrow) => ({
			from: arrow.from,
			to: arrow.to,
			text: arrow.text,
			quotes: arrow.quotes.map((quote) => ({
				path: quote.path,
				commit: quote.commit,
				text: quote.text,
				line: quote.startLine,
			})),
		})),
		about: layout.about,
		asked: layout.asked,
	}
}

export function under(file: string, place: string): boolean {
	return place === '' || file === place || file.startsWith(`${place}/`)
}

// A line names a part when it holds the last segment of one of the part's paths, without its extension, in any case, as
// a whole word: "record" in "../record/index.ts", never "pi" in "api". An import line does; "calls the stores" does not.
function namesPart(text: string, paths: string[]): boolean {
	return paths.some((place) => {
		const name = segment(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		return new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`, 'i').test(text)
	})
}

// By plain text, with no parser: a line whose trimmed start opens a comment in a common language. C's #include and
// #import are code.
const COMMENT = /^(\/\/|\/\*|\*|--|;|#(?!\s*(include|import)\b))/

function onlyComments(text: string): boolean {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.every((line) => COMMENT.test(line))
}

function segment(place: string): string {
	const last = place.split('/').at(-1) ?? place
	const dot = last.lastIndexOf('.')
	return dot > 0 ? last.slice(0, dot) : last
}

function pathsOf(raw: string[], field: string, say: (problem: string) => void): RepoPath[] {
	return raw.flatMap((each) => {
		const parsed = parsePath(each)
		if (parsed.kind === 'ok') return [parsed.path]
		say(`${field}: ${parsed.reason}.`)
		return []
	})
}

function limit(field: string, what: string, value: string, most: number, say: (problem: string) => void) {
	if (value === '') say(`${field} has no ${what}.`)
	else if (value.length > most) say(`${field}: the ${what} has ${value.length} characters. Keep it under ${most}.`)
}

function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function short(commit: CommitHash): string {
	return commit.slice(0, 7)
}
