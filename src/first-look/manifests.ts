// What a project's manifests at its top say of it: its name, its description, and the commands it says to run. Only
// the top folder's manifests are read, so a monorepo speaks through its root.
import type { CommitHash, Repository, SearchMatch } from '../repo/index.ts'
import { parsePath } from '../repo/index.ts'

// A fact a manifest gave, with the file that gave it.
export type Said = { text: string; file: string }

// bin is a command the project installs, main the file another program loads, script a command its manifest names,
// such as "npm run test". runs is what it runs: a file, or a command line.
export type EntryPoint = { kind: 'bin' | 'main' | 'script'; name: string; runs: string; file: string; source?: string }

export type Manifests = { name: Said | null; description: Said | null; entries: EntryPoint[] }

type Read = { name?: string | undefined; description?: string | undefined; entries: EntryPoint[] }

export const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'] as const

export async function readManifests(repo: Repository, head: CommitHash, files: Set<string>): Promise<Manifests> {
	const read: (Read & { file: string })[] = []
	for (const file of MANIFESTS.filter((each) => files.has(each))) {
		const path = parsePath(file)
		const text = path.kind === 'ok' ? await repo.readFile(head, path.path) : null
		if (text?.kind !== 'ok') continue
		const facts = READERS[file](text.text, file)
		if (file === 'go.mod') facts.entries.push(...goMains(await goMainFiles(repo, head)))
		read.push({ ...facts, file })
	}
	const first = (key: 'name' | 'description') => {
		const found = read.find((each) => each[key])
		return found?.[key] ? { text: found[key], file: found.file } : null
	}
	const entries = read
		.flatMap((each) => each.entries)
		.map((entry) => {
			const path = parsePath(entry.runs)
			return entry.kind === 'main' && path.kind === 'ok' && files.has(path.path)
				? { ...entry, source: path.path }
				: entry
		})
	return { name: first('name'), description: first('description'), entries }
}

const READERS: Record<(typeof MANIFESTS)[number], (text: string, file: string) => Read> = {
	'package.json': packageJson,
	'pyproject.toml': (text, file) => {
		const tables = tomlTables(text)
		const project = tables.get('project') ?? tables.get('tool.poetry') ?? new Map()
		const scripts = tables.get('project.scripts') ?? tables.get('tool.poetry.scripts') ?? new Map()
		const entries = [...scripts].map(([name, runs]) => ({ kind: 'bin' as const, name, runs, file }))
		return { name: project.get('name'), description: project.get('description'), entries }
	},
	'Cargo.toml': (text, file) => {
		const tables = tomlTables(text)
		const pkg = tables.get('package') ?? new Map()
		const bins = [...text.matchAll(/^\[\[bin\]\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map((match) => {
			const values = tomlValues(match[1] ?? '')
			const name = values.get('name') ?? pkg.get('name') ?? 'main'
			return { kind: 'bin' as const, name, runs: values.get('path') ?? `src/bin/${name}.rs`, file }
		})
		return { name: pkg.get('name'), description: pkg.get('description'), entries: bins }
	},
	'go.mod': (text) => ({ name: /^module\s+(\S+)/m.exec(text)?.[1], entries: [] }),
}

function packageJson(text: string, file: string): Read {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return { entries: [] }
	}
	if (typeof value !== 'object' || value === null) return { entries: [] }
	const field = (key: string) => (key in value ? (value as Record<string, unknown>)[key] : undefined)
	const stringAt = (key: string) => {
		const found = field(key)
		return typeof found === 'string' && found.trim() !== '' ? found.trim() : undefined
	}
	const name = stringAt('name')
	const strings = (found: unknown) =>
		typeof found === 'object' && found !== null
			? Object.entries(found).flatMap(([key, each]) => (typeof each === 'string' ? [[key, each] as const] : []))
			: []
	const bin = field('bin')
	const bins = typeof bin === 'string' ? [[name ?? 'bin', bin] as const] : strings(bin)
	const exports = field('exports')
	const root = exports && typeof exports === 'object' && '.' in exports ? exports['.'] : exports
	const target = root && typeof root === 'object' && 'default' in root ? root.default : root
	const main = typeof target === 'string' ? target : stringAt('main')
	return {
		name,
		description: stringAt('description'),
		entries: [
			...bins.map(([key, runs]) => ({ kind: 'bin' as const, name: key, runs, file })),
			...(main ? [{ kind: 'main' as const, name: 'main', runs: main, file }] : []),
			...strings(field('scripts')).map(([key, runs]) => ({ kind: 'script' as const, name: key, runs, file })),
		],
	}
}

// shortcut: reads only `key = "text"` lines of TOML, by table, which is all a manifest's name, description and
// scripts need. Use a TOML parser if a manifest is ever misread.
function tomlTables(text: string): Map<string, Map<string, string>> {
	const tables = new Map<string, Map<string, string>>()
	let table = ''
	for (const line of text.split('\n')) {
		const header = /^\s*\[([^[\]]+)\]\s*(#.*)?$/.exec(line)
		if (header) table = (header[1] ?? '').trim()
		else if (/^\s*\[\[/.test(line)) table = ''
		const [pair] = keyValue(line) ?? []
		if (!header && pair) tables.set(table, (tables.get(table) ?? new Map()).set(...pair))
	}
	return tables
}

function tomlValues(text: string): Map<string, string> {
	return new Map(text.split('\n').flatMap((line) => keyValue(line) ?? []))
}

function keyValue(line: string): [[string, string]] | null {
	const pair = /^\s*([\w.-]+|"[^"]+")\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(#.*)?$/.exec(line)
	if (!pair) return null
	return [[(pair[1] ?? '').replaceAll('"', ''), pair[2] ?? pair[3] ?? '']]
}

async function goMainFiles(repo: Repository, head: CommitHash): Promise<SearchMatch[]> {
	const found = await repo.search(head, '^func main\\(\\)')
	return found.kind === 'ok' ? found.matches.filter((match) => match.path.endsWith('.go')) : []
}

function goMains(matches: SearchMatch[]): EntryPoint[] {
	return matches.map((match) => {
		const folder = match.path.includes('/') ? match.path.slice(0, match.path.lastIndexOf('/')) : '.'
		return { kind: 'bin', name: folder.split('/').at(-1) ?? folder, runs: match.path, file: match.path }
	})
}
