import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'

// Sessions in the shape Claude Code saves them, one JSON object per line, with made-up content. Each line carries
// only the fields ken reads, plus a few it must ignore. A string in lines is written as it is, to make a broken line.
export type SessionLine = Record<string, unknown> | string

// A temp folder that stands in for ~/.claude/projects. It is removed when the test file ends.
export function claudeProjects(): string {
	const folder = mkdtempSync(path.join(tmpdir(), 'ken-claude-'))
	after(() => rmSync(folder, { recursive: true, force: true }))
	return folder
}

export function writeSession(projects: string, started: string, id: string, lines: SessionLine[]): string {
	const folder = path.join(projects, started.replaceAll(/[^A-Za-z0-9]/g, '-'))
	mkdirSync(folder, { recursive: true })
	const file = path.join(folder, `${id}.jsonl`)
	writeFileSync(file, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'))
	return file
}

export function asked(cwd: string, timestamp: string, content: unknown, more: Record<string, unknown> = {}) {
	return { type: 'user', cwd, timestamp, userType: 'external', message: { role: 'user', content }, ...more }
}

export function answered(cwd: string, timestamp: string, content: unknown[]) {
	return { type: 'assistant', cwd, timestamp, message: { role: 'assistant', model: 'a-model', content } }
}

export function call(id: string, name: string, input: Record<string, unknown>) {
	return { type: 'tool_use', id, name, input }
}

export function result(cwd: string, timestamp: string, id: string, content: unknown) {
	return asked(cwd, timestamp, [{ type: 'tool_result', tool_use_id: id, content }])
}
