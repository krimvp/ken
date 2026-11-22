// What plain code knows of the files a brief is about, sent with the question so the model can pick the lines to read
// instead of reading whole files: each file's line count, an outline of what it declares and where, and the words the
// project's glossary defines. The plan allows an outline once its cost is measured: a brief read about 1,500 lines to
// quote 36, and every line it read was sent again with each later request.
import { type CommitHash, parsePath, type Repository } from '../../repo/index.ts'

const MAX_FILES = 40
const MAX_NAMES = 48
const MAX_CHARS = 12_000
const MAX_WORDS = 60

// A declaration a reader would look for, per language, with the name in the last group. A method is a name, its
// arguments and an opening brace at the end of an indented line.
const DECLARATIONS: [RegExp, RegExp[]][] = [
	[
		/\.(c|m)?[jt]sx?$/,
		[
			/^\s{0,6}(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
			/^\s{0,6}(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
			/^export\s+(?:const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
			/^\s{2,8}(?:async\s+)?\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/,
		],
	],
	[/\.py$/, [/^\s{0,4}(?:async\s+)?def\s+(\w+)/, /^class\s+(\w+)/]],
	[/\.go$/, [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)\s+(?:struct|interface)/]],
	[/\.rs$/, [/^\s{0,4}(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/]],
]
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'with'])

export async function plainFacts(
	repo: Repository,
	head: CommitHash,
	paths: string[],
	signal?: AbortSignal,
): Promise<string> {
	const listed = await repo.listFiles(head, signal)
	if (listed.kind !== 'ok') return ''
	const inside = listed.paths.filter((file) => paths.some((each) => file === each || file.startsWith(`${each}/`)))
	const lines: string[] = []
	let chars = 0
	for (const file of inside.slice(0, MAX_FILES)) {
		const line = await fileLine(repo, head, file, signal)
		if (chars + line.length > MAX_CHARS) break
		lines.push(line)
		chars += line.length
	}
	const left = inside.length - lines.length
	const words = await glossaryWords(repo, head, listed.paths, signal)
	return [
		'What plain code read of these files at HEAD: each file, its lines, and what it declares at which line.',
		...lines,
		...(left > 0 ? [`- and ${left} more files`] : []),
		...(words ? ['', `The words the project's glossary (${words.file}) defines: ${words.words.join(', ')}.`] : []),
	].join('\n')
}

async function fileLine(repo: Repository, head: CommitHash, file: string, signal?: AbortSignal): Promise<string> {
	const read = await readText(repo, head, file, signal)
	if (read.kind === 'too-large') return `- ${file}, too large to read`
	if (read.kind !== 'ok') return `- ${file}`
	const text = read.text.split('\n')
	if (text.at(-1) === '') text.pop()
	const patterns = DECLARATIONS.find(([kind]) => kind.test(file))?.[1] ?? []
	const names: string[] = []
	for (const [at, line] of text.entries()) {
		const name = patterns.map((pattern) => line.match(pattern)?.[1]).find((each) => each && !NOT_NAMES.has(each))
		if (name) names.push(`${name} ${at + 1}`)
	}
	const shown = names.slice(0, MAX_NAMES)
	const more = names.length > shown.length ? `, and ${names.length - shown.length} more` : ''
	return `- ${file}, ${text.length} lines${shown.length > 0 ? `: ${shown.join(', ')}${more}` : ''}`
}

// A glossary names its words in bold at the start of a line, or as headings when it has no bold words.
async function glossaryWords(
	repo: Repository,
	head: CommitHash,
	paths: string[],
	signal?: AbortSignal,
): Promise<{ file: string; words: string[] } | null> {
	const file = paths.find((each) => /(^|\/)glossary(\.md)?$/i.test(each) && each.split('/').length <= 2)
	if (!file) return null
	const read = await readText(repo, head, file, signal)
	if (read.kind !== 'ok') return null
	const lines = read.text.split('\n')
	const bold = lines.flatMap((line) => line.match(/^(?:[-*]\s+)?\*\*([^*]+?)\*\*/)?.[1] ?? [])
	const headings = lines.flatMap((line) => line.match(/^#{2,4}\s+(.+)$/)?.[1] ?? [])
	const words = [...new Set((bold.length > 0 ? bold : headings).map((word) => word.replace(/:$/, '').trim()))]
	return words.length === 0 ? null : { file, words: words.slice(0, MAX_WORDS) }
}

async function readText(repo: Repository, head: CommitHash, file: string, signal?: AbortSignal) {
	const path = parsePath(file)
	return path.kind === 'ok' ? await repo.readFile(head, path.path, signal) : ({ kind: 'no-file' } as const)
}
