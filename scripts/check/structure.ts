// Keeps src/ readable for a new joiner. Each folder in src/ is a module with one job, listed in MODULES below.
// Modules meet only at their index.ts, only along the edges MODULES allows, and no folder grows past MAX_FILES files.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

type Module = { job: string; imports: string[]; packages: string[] }

// The map of the code. Read this table first. Each folder directly under src/ has one entry: its job in one sentence,
// the other modules it may import (always through their index.ts), and the npm packages it may import.
// node: built-ins are always allowed. Add a module here before you create its folder.
export const MODULES: Record<string, Module> = {
	repo: { job: "Reads a project's files and git history, and never writes to them.", imports: [], packages: [] },
	checks: {
		job: 'Checks an answer: its quotes exist in git, its labels are allowed, and it covers every changed hunk.',
		imports: ['repo'],
		packages: [],
	},
	diagram: {
		job: 'Diagrams as checked data: boxes and arrows that rest on quotes, and their Mermaid text.',
		imports: ['repo', 'checks'],
		packages: [],
	},
	record: {
		job: 'The project record: an append-only store of pieces of work, decisions, topics and notes.',
		imports: ['repo', 'checks', 'diagram'],
		packages: [],
	},
	agent: {
		job: 'Runs a chat with a model that explores the project with read-only tools and answers only with checked quotes.',
		imports: ['repo', 'checks', 'diagram', 'record'],
		packages: ['aigent'],
	},
	history: {
		job: "The reader's own log of questions asked and the answers shown, kept outside the project.",
		imports: ['agent', 'record', 'repo'],
		packages: [],
	},
	page: {
		job: 'The page in the browser: plain HTML, CSS and JavaScript that shows a question, its steps and its checked answer.',
		imports: [],
		packages: [],
	},
	server: {
		job: 'Serves the page on 127.0.0.1 and runs the questions it sends, one at a time.',
		imports: ['agent', 'history', 'page', 'record', 'repo'],
		packages: [],
	},
	cli: {
		job: 'Runs ken in the terminal: a chat, one question for scripts, the project record, or the page.',
		imports: ['agent', 'diagram', 'record', 'repo', 'server'],
		packages: [],
	},
}

const MAX_FILES = 8

// shortcut: a regex scan per line, so it also matches import text in comments and strings and misses a specifier that
// sits on its own line. Switch to ts.preProcessFile if that ever gives a wrong finding.
const SPECIFIER = /\b(?:from|import)(?:\s+|\s*\(\s*)['"]([^'"]+)['"]/g

export function checkStructure(root: string, modules: Record<string, Module>): string[] {
	const src = path.join(root, 'src')
	if (!existsSync(src)) return []
	const table = new Map(Object.entries(modules))
	const show = (file: string) => path.relative(root, file)
	const findings: string[] = []

	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (entry.isDirectory() && !table.has(entry.name)) {
			findings.push(
				`${show(path.join(src, entry.name))}: module "${entry.name}" is not in MODULES. Add it to the table in scripts/check/structure.ts with its job, imports and packages.`,
			)
		}
	}

	const filesPerFolder = new Map<string, number>()
	for (const entry of readdirSync(src, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue
		const file = path.join(entry.parentPath, entry.name)
		filesPerFolder.set(entry.parentPath, (filesPerFolder.get(entry.parentPath) ?? 0) + 1)
		if (entry.parentPath === src) {
			findings.push(`${show(file)}: src/ holds only module folders. Move this file into the module it belongs to.`)
			continue
		}
		const name = moduleOf(src, file)
		const allowed = name === undefined ? undefined : table.get(name)
		if (name === undefined || allowed === undefined || !file.endsWith('.ts')) continue

		for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
			for (const [, specifier = ''] of line.matchAll(SPECIFIER)) {
				const problem = checkImport({ src, file, name, allowed, specifier })
				if (problem) findings.push(`${show(file)}:${index + 1}: ${problem}`)
			}
		}
	}

	for (const [folder, count] of filesPerFolder) {
		if (count > MAX_FILES) {
			findings.push(`${show(folder)}: holds ${count} files, more than ${MAX_FILES}. Split the folder by concept.`)
		}
	}
	return findings
}

function checkImport(at: { src: string; file: string; name: string; allowed: Module; specifier: string }) {
	const { src, file, name, allowed, specifier } = at
	if (specifier.startsWith('node:')) return undefined
	if (!specifier.startsWith('.')) {
		const parts = specifier.split('/')
		const pkg = parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
		if (allowed.packages.includes(pkg)) return undefined
		return `module "${name}" may not use package "${pkg}". If it should, add "${pkg}" to its packages in MODULES (scripts/check/structure.ts).`
	}
	const target = path.resolve(path.dirname(file), specifier)
	const other = moduleOf(src, target)
	if (other === undefined || other === name) return undefined
	const door = path.join(src, other, 'index.ts')
	if (target !== door) {
		return `"${specifier}" reaches inside module "${other}". Import "${path.relative(path.dirname(file), door)}" instead and export what you need from there.`
	}
	if (allowed.imports.includes(other)) return undefined
	return `module "${name}" may not import module "${other}". If it should, add "${other}" to its imports in MODULES (scripts/check/structure.ts). If not, the code belongs in another module.`
}

function moduleOf(src: string, file: string): string | undefined {
	const parts = path.relative(src, file).split(path.sep)
	return parts.length > 1 && parts[0] !== '..' ? parts[0] : undefined
}

if (import.meta.main) {
	const findings = checkStructure(path.join(import.meta.dirname, '../..'), MODULES)
	for (const finding of findings) console.error(finding)
	process.exitCode = findings.length > 0 ? 1 : 0
}
