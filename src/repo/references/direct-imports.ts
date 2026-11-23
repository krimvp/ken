// Direct named imports whose relative path matches a file exactly in one Git revision, plus lines that mention the local binding.
import { posix } from 'node:path'
import { parsePath } from '../parse-path.ts'
import type { CommitHash, RepoPath, Repository, SearchMatch } from '../repository.ts'

const JS_FILE = /\.[cm]?[jt]sx?$/i
const EXPORT =
	/^export\s+(?:async\s+)?(?:function\s*\*?\s*|(?:class|const|let|var)\s+)([A-Za-z_][A-Za-z0-9_]{0,79})(?![\w$])/
const IMPORT = /^\s*import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/

export function namedExports(path: string, lines: string[], start: number, end: number): string[] {
	if (!JS_FILE.test(path)) return []
	const names = lines.slice(start - 1, end).flatMap((line) => EXPORT.exec(line)?.[1] ?? [])
	if (names.length > 0) return [...new Set(names)]
	// A closing brace or another outer line ends the enclosing declaration.
	const outer = lines.slice(Math.max(0, start - 61), end).findLast((line) => /^\S/.test(line))
	return (outer && /\{\s*$/.test(outer) && EXPORT.exec(outer)?.slice(1)) || []
}

type Reference = { kind: 'import' | 'mention'; path: string; line: number; text: string | null }
export type DirectImports = { lines: Reference[]; limited: boolean }

// An omitted extension or emitted JS filename is a lead only if a single matching source exists at this commit.
async function modulePaths(
	repo: Repository,
	commit: CommitHash,
	path: string,
	requested: Set<string>,
	signal?: AbortSignal,
) {
	const paths = new Set([path])
	const ext = posix.extname(path)
	const stem = path.slice(0, -ext.length)
	const alternatives = new Map<string, string[]>()
	const suffixes = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.cjs', '.cts', '.json', '.node', '.d.ts']
	const folders = posix.basename(stem) === 'index' ? [stem, posix.dirname(stem)] : [stem]
	for (const base of folders) {
		if (!requested.has(base)) continue
		alternatives.set(base, [
			...(base === posix.dirname(path) ? [] : [base]),
			...suffixes.map((suffix) => base + suffix),
			...suffixes.map((suffix) => posix.join(base, `index${suffix}`)),
			posix.join(base, 'package.json'),
		])
	}
	const emitted = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' }[ext]
	if (emitted && requested.has(stem + emitted)) {
		const other = emitted === '.js' ? ['.ts', '.tsx', '.d.ts', '.js', '.jsx'] : [ext, emitted, `.d${ext}`]
		alternatives.set(
			stem + emitted,
			other.map((suffix) => stem + suffix),
		)
	}
	if (alternatives.size === 0) return paths
	const candidates = [...new Set([...alternatives.values()].flat())].flatMap((name) => {
		const parsed = parsePath(name)
		return parsed.kind === 'ok' ? [parsed.path] : []
	})
	const ids = await repo.objectIds(commit, candidates, signal)
	const present = new Set<string>(candidates.filter((_, index) => ids[index]))
	for (const [specifier, choices] of alternatives) {
		const existing = choices.filter((choice) => present.has(choice))
		if (existing.length === 1 && existing[0] === path) paths.add(specifier)
	}
	return paths
}

export async function directImports(
	repo: Repository,
	commit: CommitHash,
	path: string,
	name: string,
	signal?: AbortSignal,
): Promise<DirectImports> {
	const found = await repo.search(commit, `^[[:space:]]*import[[:space:]]*[^;]*\\{[^}]*\\b${name}\\b`, signal)
	const result: DirectImports = { lines: [], limited: found.kind !== 'ok' }
	if (found.kind !== 'ok') return result
	const imports = found.matches.flatMap((line) => {
		const match = IMPORT.exec(line.text)
		if (!match?.[1] || !match[2] || !JS_FILE.test(line.path)) return []
		const bindings = match[1].split(',').map((binding) => binding.trim().split(/\s+as\s+/))
		const binding = bindings.find(([imported]) => imported === name)
		const local = binding?.[1] ?? binding?.[0]
		if (!local || !/^[A-Za-z_]\w*$/.test(local)) return []
		return [{ local, line, module: posix.join(posix.dirname(line.path), match[2]) }]
	})
	const modules = await modulePaths(repo, commit, path, new Set(imports.map((item) => item.module)), signal)
	const files = new Map<RepoPath, { local: string; line: SearchMatch }>()
	for (const { local, line, module } of imports) {
		if (!modules.has(module)) continue
		const parsed = parsePath(line.path)
		if (parsed.kind !== 'ok') continue
		if (files.has(parsed.path)) {
			result.limited = true
			continue
		}
		if (files.size >= 3) {
			result.limited = true
			break
		}
		files.set(parsed.path, { local, line })
	}
	if (files.size === 0) return result
	const locals = [...new Set([...files.values()].map((file) => file.local))]
	const uses = await repo.search(commit, `\\b(${locals.join('|')})\\b`, signal, [...files.keys()])
	if (uses.kind !== 'ok') result.limited = true
	const add = (kind: Reference['kind'], hit: SearchMatch) =>
		result.lines.push({ kind, ...hit, text: hit.text.length <= 500 ? hit.text : null })
	for (const [file, { local, line }] of files) {
		add('import', line)
		if (uses.kind !== 'ok') continue
		const word = new RegExp(`(?:^|[^\\w$.])${local}(?![\\w$])`)
		let count = 0
		for (const hit of uses.matches) {
			if (
				hit.path !== file ||
				hit.line === line.line ||
				/^\s*(?:import\b|\/\/|\/\*|\*)/.test(hit.text) ||
				!word.test(hit.text)
			)
				continue
			if (count === 2) {
				result.limited = true
				break
			}
			add('mention', hit)
			count++
		}
	}
	return result
}
