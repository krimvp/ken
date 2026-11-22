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
	transcripts: {
		job: 'Reads the saved sessions of a coding agent for this project, so ken can quote what was said while the work was done.',
		imports: [],
		packages: [],
	},
	checks: {
		job: 'Checks an answer: its quotes exist in git or in a saved session, its labels are allowed, it covers every changed hunk, it follows the names the change touched to where else they are used, and what an entry says is missing is not there.',
		imports: ['repo', 'transcripts'],
		packages: [],
	},
	diagram: {
		job: "Diagrams as checked data: boxes and arrows that rest on quotes, and their Mermaid text, and the check on a level of the project's parts.",
		imports: ['repo', 'checks'],
		packages: [],
	},
	record: {
		job: "The project record: an append-only store of pieces of work, decisions, topics, notes and the named levels of the project's layout.",
		imports: ['repo', 'checks', 'diagram', 'transcripts'],
		packages: [],
	},
	map: {
		job: 'The understanding map: what this reader understands, topic by topic, the notes on how they want things shown, how much text they want, and the lines on what they looked at, kept outside the project.',
		imports: ['record', 'repo'],
		packages: [],
	},
	'follow-up': {
		job: 'What is open for the owner, the lenses on a person and on a time range, and the questions ken writes for its model about a level, a part or one concept, from the record, the map and git.',
		imports: ['map', 'record', 'repo'],
		packages: [],
	},
	live: {
		job: "Watches the project while a coding agent works in it: HEAD, the branch and the uncommitted files, snapshots of uncommitted work in ken's own store, and when ken writes a note.",
		imports: ['repo', 'transcripts'],
		packages: [],
	},
	layout: {
		job: "The project's layout at a commit: a few boxes per level, the parts ken's model named or else the folders, which of them changed or are gone, what a change touched, what ken thinks the reader knows of each, and what they should look at next.",
		imports: ['follow-up', 'live', 'map', 'record', 'repo'],
		packages: [],
	},
	agent: {
		job: 'Runs a chat with a model that explores the project and its saved sessions with read-only tools, and replies in its own words with cards and briefs whose quotes passed the check.',
		imports: ['repo', 'checks', 'diagram', 'live', 'map', 'record', 'transcripts'],
		packages: ['aigent'],
	},
	history: {
		job: "The reader's own log of questions asked, notes written in live mode, and the answers shown, kept outside the project.",
		imports: ['agent', 'live', 'record', 'repo'],
		packages: [],
	},
	page: {
		job: "The page in the browser: plain HTML, CSS and JavaScript that shows the picture of the project's parts as its home, and a thread of replies, their steps and their checked cards.",
		imports: [],
		packages: ['mermaid'],
	},
	server: {
		job: 'Serves the page on 127.0.0.1, builds the brief of each concept from what ken holds, runs the questions the page sends and the notes of live mode one model call at a time, and writes down what the page says the reader looked at.',
		imports: [
			'agent',
			'diagram',
			'follow-up',
			'history',
			'layout',
			'live',
			'map',
			'page',
			'record',
			'repo',
			'transcripts',
		],
		packages: [],
	},
	cli: {
		job: "Runs ken in the terminal: a chat, one question for scripts, the project record, the map, the project's layout, what is open, the page, live notes, a logged decision, or saved sessions.",
		imports: [
			'agent',
			'diagram',
			'follow-up',
			'history',
			'layout',
			'live',
			'map',
			'record',
			'repo',
			'server',
			'transcripts',
		],
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
