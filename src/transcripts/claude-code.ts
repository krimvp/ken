// Claude Code keeps each session as one JSON Lines file in ~/.claude/projects/<slug>/, where the slug is the folder the
// session started in with every character that is not a letter or digit turned into "-". A file is hostile input: it
// can be huge, hold lines that do not parse, and hold secrets and other projects' paths. So ken reads at most the
// first MAX_SESSION_BYTES of a file, counts the lines it cannot read, keeps only the first lines of tool output, never
// names a file outside the project, reads no further once a file shows it belongs to another project, and passes every
// text it returns through secretHider.
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { secretHider } from './hide-secrets.ts'
import type { Session, SessionId, SessionList, SessionRead, TranscriptEntry, Transcripts } from './transcripts.ts'

const MAX_SESSIONS = 100
const MAX_SESSION_BYTES = 32 * 1024 * 1024
const MAX_OUTPUT_LINES = 5
const MAX_LINE = 200
// A session id is a file name, so it must not be able to name a path.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
// The tool input that says what a call worked on, in the order ken looks for it. The first three hold paths.
const TARGETS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'url', 'query', 'description']
const PATHS = new Set(['file_path', 'notebook_path', 'path'])
const OUTSIDE = 'a file outside the project'

type Line = Record<string, unknown>
type Tool = Extract<TranscriptEntry, { kind: 'tool' }>

// KEN_CLAUDE_PROJECTS names the folder that holds the slug folders, for tests and for anyone who keeps it elsewhere.
// Claude Code itself moves it with CLAUDE_CONFIG_DIR.
export function claudeCodeTranscripts(root: string, env: Record<string, string | undefined>): Transcripts {
	const projects =
		env.KEN_CLAUDE_PROJECTS ?? path.join(env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects')
	const where = path.join(projects, root.replaceAll(/[^A-Za-z0-9]/g, '-'))
	const hide = secretHider(env)

	// The session files, the one saved to last first.
	async function files() {
		let names: string[]
		try {
			names = await readdir(where)
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
			throw error
		}
		const found = []
		for (const name of names) {
			const id = name.endsWith('.jsonl') ? sessionId(name.slice(0, -'.jsonl'.length)) : null
			if (id === null) continue
			const info = await stat(path.join(where, name)).catch(() => null)
			if (info?.isFile()) found.push({ id, changed: info.mtimeMs, bytes: info.size })
		}
		return found.sort((a, b) => b.changed - a.changed)
	}

	async function latest() {
		const [newest] = await files()
		return newest ? { id: newest.id, bytes: newest.bytes, changedAt: newest.changed } : null
	}

	async function sessions(signal?: AbortSignal): Promise<SessionList> {
		const found = await files()
		const listed: Session[] = []
		for (const { id } of found.slice(0, MAX_SESSIONS)) {
			const read = await session(id, signal)
			if (read) listed.push(read.session)
		}
		listed.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''))
		return { sessions: listed, older: Math.max(0, found.length - MAX_SESSIONS) }
	}

	async function session(raw: string, signal?: AbortSignal): Promise<SessionRead | null> {
		const id = sessionId(raw)
		if (id === null) return null
		const file = path.join(where, `${id}.jsonl`)
		const info = await stat(file).catch(() => null)
		if (!info?.isFile()) return null
		const input = createReadStream(file, { end: MAX_SESSION_BYTES - 1, ...(signal && { signal }) })
		try {
			const read = await scan(root, input, hide)
			if (read === null) return null
			const times = read.entries.filter((entry) => entry.kind !== 'tool').map((entry) => entry.at)
			const facts: Session = {
				id,
				started: times[0] ?? null,
				ended: times.at(-1) ?? null,
				messages: read.messages,
				skipped: read.skipped,
				partial: info.size > MAX_SESSION_BYTES,
			}
			return { session: facts, entries: read.entries, more: 0 }
		} finally {
			input.destroy()
		}
	}

	return { tool: 'Claude Code', where, sessions, session, latest }
}

function sessionId(raw: string): SessionId | null {
	return ID.test(raw) ? (raw as SessionId) : null
}

// Null when the file's first working directory is not the project's root or a folder inside it, or when it names
// none, since then nothing shows that the session belongs to this project.
async function scan(root: string, input: NodeJS.ReadableStream, hide: (text: string) => string) {
	const entries: TranscriptEntry[] = []
	const calls = new Map<string, Tool>()
	let skipped = 0
	let messages = 0
	let belongs = false
	for await (const text of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) {
		if (text.trim() === '') continue
		const line = parse(text)
		if (line === null) {
			skipped++
			continue
		}
		if (!belongs && typeof line.cwd === 'string') {
			if (!inside(root, line.cwd)) return null
			belongs = true
		}
		if (line.type !== 'user' && line.type !== 'assistant') continue
		const at = line.timestamp
		const content = isObject(line.message) ? line.message.content : undefined
		if (typeof at !== 'string' || (typeof content !== 'string' && !Array.isArray(content))) {
			skipped++
			continue
		}
		const parts: unknown[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content
		const person = line.type === 'assistant' || saidByPerson(line)
		for (const part of parts) {
			if (!isObject(part)) continue
			if (part.type === 'text' && typeof part.text === 'string' && person) {
				const said = hide(line.type === 'user' ? withoutReminders(part.text) : part.text.trim())
				if (said === '') continue
				messages++
				entries.push({ kind: line.type === 'user' ? 'user' : 'agent', message: messages, at, text: said, cut: 0 })
			}
			if (part.type === 'tool_use' && line.type === 'assistant' && typeof part.name === 'string') {
				const tool: Tool = {
					kind: 'tool',
					at,
					name: part.name,
					target: targetOf(part.input, root, hide),
					output: [],
					more: 0,
				}
				entries.push(tool)
				if (typeof part.id === 'string') calls.set(part.id, tool)
			}
			if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
				const tool = calls.get(part.tool_use_id)
				if (tool) Object.assign(tool, firstLines(hide(outputOf(part.content))))
			}
		}
	}
	return belongs ? { entries, messages, skipped } : null
}

// Claude Code also writes into the user's turn what the person did not type: notes from other sessions and tasks
// (isMeta, or an origin other than a person) and system reminders inside a message.
function saidByPerson(line: Line): boolean {
	if (line.isMeta === true) return false
	return !isObject(line.origin) || line.origin.kind === 'human'
}

function withoutReminders(text: string): string {
	return text.replaceAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

function targetOf(input: unknown, root: string, hide: (text: string) => string): string | null {
	if (!isObject(input)) return null
	for (const key of TARGETS) {
		const value = input[key]
		if (typeof value !== 'string' || value.trim() === '') continue
		if (PATHS.has(key) && path.isAbsolute(value))
			return inside(root, value) ? path.relative(root, value) || '.' : OUTSIDE
		return cutLine(hide(value).split('\n')[0] ?? '')
	}
	return null
}

function outputOf(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.map((part) =>
			isObject(part) && typeof part.text === 'string' ? part.text : isObject(part) ? `[${part.type}]` : '',
		)
		.join('\n')
}

function firstLines(text: string): { output: string[]; more: number } {
	const lines = text.trimEnd().split('\n')
	if (lines.length === 1 && lines[0] === '') return { output: [], more: 0 }
	return { output: lines.slice(0, MAX_OUTPUT_LINES).map(cutLine), more: Math.max(0, lines.length - MAX_OUTPUT_LINES) }
}

function cutLine(line: string): string {
	return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}...` : line
}

function inside(root: string, folder: string): boolean {
	const relative = path.relative(root, folder)
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function parse(text: string): Line | null {
	try {
		const value: unknown = JSON.parse(text)
		return isObject(value) ? value : null
	} catch {
		return null
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
