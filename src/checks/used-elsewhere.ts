// Where else the names a change touches are used, computed from git before the model answers. Plain patterns over the
// changed lines find the names the change defines, alters or removes, in any language and with no parser, and a
// whole-word search at the head commit finds the other lines that hold each name. It is a search, so it can miss a use
// and can find a different thing with the same name: ken says so wherever it shows the list.
import { type CommitHash, type FileDiff, parsePath, type Range, type Repository, type TooLarge } from '../repo/index.ts'
import type { VerifiedGitQuote } from './quote-check.ts'

export type Site = { path: string; line: number; text: string }

// how: the change adds the name, alters it (its own line, or a line inside the function or type it names), or removes
// it. sites are the lines at the head commit, outside the changed lines, that hold the name and do not define it.
export type UsedName = { name: string; how: 'added' | 'altered' | 'removed'; sites: Site[] }

// left says what ken did not follow, so nobody takes the list for all of it: names too short to search, names on more
// than MAX_SITES lines, names past MAX_SEARCHED, and names with places past MAX_NAMES.
export type UsedElsewhere = {
	head: CommitHash
	names: UsedName[]
	searched: number
	left: { short: number; common: string[]; unsearched: number; unlisted: number }
}

// A name no quote of an answer follows: how many places hold it, and the first of them, for the reader to look at.
export type NotFollowed = { name: string; how: UsedName['how']; places: number; first: Site[] }

// The listed names a quote follows to one of their places, and those none does.
export type Followed = { followed: string[]; notFollowed: NotFollowed[] }

const MIN_LENGTH = 4
const MAX_SEARCHED = 40
// A name on more lines than this is a common word or a thing used everywhere, too many places to read in a few turns.
const MAX_SITES = 40
const MAX_NAMES = 20
const MAX_FIRST = 6

const NAME = '[A-Za-z_$][\\w$]*'
const MODIFIERS =
	'(?:(?:export|default|async|pub(?:\\([^)]*\\))?|public|private|protected|internal|static|abstract|final|declare|unsafe|extern|inline|override|open|sealed|data|const)\\s+)*'
// A function, method or type, at any indentation: "function run", "def run", "fn run", "func (s *T) Run", "class Store".
const DEFINITION = new RegExp(
	`^\\s*${MODIFIERS}(?:function\\*?|func|fn|fun|def|class|struct|enum|interface|type|trait|module|macro|record|object)\\s+(?:\\([^)]*\\)\\s*)?(${NAME})`,
)
// A value at the top of a file, where it can be used from elsewhere: "export const LIMIT", "var cache", "limit = 3".
const TOP_VALUE = new RegExp(
	`^(?:(?:export|pub|public|declare)\\s+)*(?:(?:const|let|var|val|static)\\s+(?:mut\\s+)?(${NAME})|(${NAME})\\s*(?::[^=]*)?=(?![=>]))`,
)
// An upper-case constant at any indentation: "MAX_TURNS = 40", "static final int MAX_SIZE = 10", "#define MAX_SIZE".
const CONSTANT = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*(?::[^=]*)?=(?![=>])|^\s*#\s*define\s+([A-Za-z_]\w*)/
// A key in a settings file: "key": in JSON, key: in YAML, key = in TOML and INI.
const SETTING = /^\s*(?:-\s*)?"?([A-Za-z_][\w.-]*)"?\s*[:=]/
const SETTINGS_FILE = /\.(?:json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|env)$/i
// Prose defines nothing, so a doc gives no names. Its lines are still places that use one.
const DOC_FILE = /\.(?:md|mdx|markdown|rst|txt|adoc)$/i
const TEST_PATH = /(?:^|\/)(?:tests?|spec|__tests__)\/|[._-](?:test|spec)\.[^/]+$/

export async function usedElsewhere(
	repo: Repository,
	range: Range,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; used: UsedElsewhere } | TooLarge> {
	const diff = await repo.diff(range, signal)
	if (diff.kind !== 'ok') return diff
	const files = diff.files.flatMap((file) => (file.kind === 'text' ? [file] : []))
	const found = new Map<string, { added: boolean; removed: boolean; altered: boolean }>()
	const note = (name: string, side: 'added' | 'removed' | 'altered') => {
		const seen = found.get(name) ?? { added: false, removed: false, altered: false }
		found.set(name, { ...seen, [side]: true })
	}
	// Settings files come last, so the names of the code are searched first when there are many.
	const ordered = [...files].sort((a, b) => Number(SETTINGS_FILE.test(a.path)) - Number(SETTINGS_FILE.test(b.path)))
	for (const file of ordered) {
		if (DOC_FILE.test(file.path)) continue
		const settings = SETTINGS_FILE.test(file.path)
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				const side = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : null
				if (side) for (const name of namesIn(line.slice(1), settings)) note(name, side)
			}
		}
		for (const name of await enclosingNames(repo, range.head, file, settings, signal)) note(name, 'altered')
	}

	const candidates = [...found].map(([name, seen]) => ({
		name,
		how: seen.altered || (seen.added && seen.removed) ? 'altered' : seen.added ? 'added' : 'removed',
	})) satisfies Omit<UsedName, 'sites'>[]
	const order = { removed: 0, altered: 1, added: 2 }
	candidates.sort((a, b) => order[a.how] - order[b.how])
	const long = candidates.filter((candidate) => candidate.name.length >= MIN_LENGTH)
	const searched = long.slice(0, MAX_SEARCHED)
	const changed = changedLines(files)
	const results = await Promise.all(
		searched.map(async (candidate) => ({
			...candidate,
			sites: await sitesOf(repo, range.head, candidate.name, changed, signal),
		})),
	)
	const common = results.filter((result) => result.sites === null || result.sites.length > MAX_SITES)
	const used = results.flatMap((result) =>
		result.sites !== null && result.sites.length > 0 && result.sites.length <= MAX_SITES
			? [{ ...result, sites: result.sites }]
			: [],
	)
	return {
		kind: 'ok',
		used: {
			head: range.head,
			names: used.slice(0, MAX_NAMES),
			searched: searched.length,
			left: {
				short: candidates.length - long.length,
				common: common.map((result) => result.name),
				unsearched: long.length - searched.length,
				unlisted: Math.max(0, used.length - MAX_NAMES),
			},
		},
	}
}

// A place counts as followed when a quote of its file holds its line, at whatever commit the quote was read: a quote
// cites lines as text, and the same line reads the same at the base, the head or later.
export function followedNames(used: UsedElsewhere, quotes: VerifiedGitQuote[]): Followed {
	const quoted = quotes.map((quote) => ({
		path: quote.path,
		lines: new Set(quote.text.split('\n').map((l) => l.trim())),
	}))
	const follows = (site: Site) => quoted.some((quote) => quote.path === site.path && quote.lines.has(site.text.trim()))
	const followed = used.names.filter((name) => name.sites.some(follows))
	return {
		followed: followed.map((name) => name.name),
		notFollowed: used.names
			.filter((name) => !followed.includes(name))
			.map(({ name, how, sites }) => ({ name, how, places: sites.length, first: sites.slice(0, MAX_FIRST) })),
	}
}

function namesIn(line: string, settings: boolean): string[] {
	const matches = [
		DEFINITION.exec(line)?.[1],
		...(line.startsWith(' ') || line.startsWith('\t') ? [] : (TOP_VALUE.exec(line)?.slice(1) ?? [])),
		...(CONSTANT.exec(line)?.slice(1) ?? []),
		settings ? SETTING.exec(line)?.[1] : undefined,
	]
	return matches.filter((name) => name !== undefined)
}

function definesName(line: string, name: string): boolean {
	return namesIn(line, false).includes(name)
}

// The function or type each indented changed line sits in: the nearest line above it at the head commit that defines
// a name and is indented less. A removed line is placed where the lines that replaced it start. A line at the far left
// sits in nothing. shortcut: a line at the far left inside a long string, such as a template literal, ends the walk
// early; read the language's own structure if that loses too many names.
async function enclosingNames(
	repo: Repository,
	head: CommitHash,
	file: Extract<FileDiff, { kind: 'text' }>,
	settings: boolean,
	signal?: AbortSignal,
): Promise<string[]> {
	const path = parsePath(file.path)
	if (file.hunks.length === 0 || path.kind !== 'ok') return []
	const read = await repo.readFile(head, path.path, signal)
	if (read.kind !== 'ok') return []
	const lines = read.text.split('\n')
	const names = new Set<string>()
	const walked = new Set<string>()
	for (const hunk of file.hunks) {
		let added = hunk.newStart
		for (const line of hunk.lines) {
			const above = line.startsWith('+') ? added - 1 : hunk.newLength > 0 ? hunk.newStart - 1 : hunk.newStart
			if (line.startsWith('+')) added += 1
			const indent = indentOf(line.slice(1))
			if (!/^[-+]/.test(line) || line.slice(1).trim() === '' || indent === 0 || walked.has(`${above}:${indent}`))
				continue
			walked.add(`${above}:${indent}`)
			const name = definitionAbove(lines, above, indent, settings)
			if (name !== undefined) names.add(name)
		}
	}
	return [...names]
}

function definitionAbove(lines: string[], from: number, indent: number, settings: boolean): string | undefined {
	for (let at = from; at >= 1; at--) {
		const line = lines[at - 1] ?? ''
		if (line.trim() === '' || indentOf(line) >= indent) continue
		const name = namesIn(line, settings)[0]
		if (name !== undefined) return name
		if (indentOf(line) === 0) return undefined
	}
	return undefined
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length
}

// The head's line numbers, by file, that the change added or changed. A site there is part of the change itself.
function changedLines(files: Extract<FileDiff, { kind: 'text' }>[]): Map<string, Set<number>> {
	const lines = new Map<string, Set<number>>()
	for (const file of files) {
		const set = lines.get(file.path) ?? new Set<number>()
		for (const hunk of file.hunks) {
			for (let line = hunk.newStart; line < hunk.newStart + hunk.newLength; line++) set.add(line)
		}
		lines.set(file.path, set)
	}
	return lines
}

// null when git grep finds more than it can return, which makes the name common too.
async function sitesOf(
	repo: Repository,
	head: CommitHash,
	name: string,
	changed: Map<string, Set<number>>,
	signal?: AbortSignal,
): Promise<Site[] | null> {
	const word = name.replace(/[.$]/g, (char) => `\\${char}`)
	const found = await repo.search(head, `(^|[^A-Za-z0-9_$])${word}([^A-Za-z0-9_$]|$)`, signal)
	if (found.kind !== 'ok') return null
	const sites = found.matches.filter(
		(match) => !changed.get(match.path)?.has(match.line) && !definesName(match.text, name),
	)
	const rank = (path: string) => (DOC_FILE.test(path) ? 2 : TEST_PATH.test(path) ? 1 : 0)
	return sites.sort((a, b) => rank(a.path) - rank(b.path)).map(({ path, line, text }) => ({ path, line, text }))
}
