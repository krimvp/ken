import type { JsonObject, JsonValue } from 'aigent/plugin'

// One plain sentence per tool call, such as "Read `src/cli.ts`, lines 100 to 180", for the reader who watches the
// agent work. The terminal and the page both show it. It runs before the tool checks its arguments, so it reads them
// leniently and never throws.
type Said = {
	text(name: string): string | undefined
	line(name: string): number | undefined
	count(name: string): number
}

const SENTENCES: Record<string, (args: Said) => string> = {
	resolve_ref: (args) => `Looked up which commit ${code(args.text('ref'))} is`,
	read_file: (args) => `Read ${code(args.text('path'))}${lines(args)}${at(args)}`,
	list_files: (args) => `Listed the files${under(args)}${at(args)}`,
	search: (args) => `Searched for ${code(args.text('pattern'))}${under(args)}${at(args)}`,
	log: (args) => `Listed the commits from ${code(ref(args.text('base')))} to ${code(ref(args.text('head')))}`,
	blame: (args) => `Looked up who last changed ${code(args.text('path'))}${lines(args)}${at(args)}`,
	diff: (args) => {
		const range = `from ${code(ref(args.text('base')))} to ${code(ref(args.text('head')))}`
		const path = args.text('path')
		return path === undefined ? `Read the changes ${range}` : `Read the changes to ${code(path)} ${range}`
	},
	read_record: (args) => {
		const id = args.text('id')
		const words = args.text('search')
		if (id !== undefined) return `Read entry ${code(id)} in the project record`
		if (words !== undefined) return `Searched the project record for ${code(words)}`
		return 'Read the list of entries in the project record'
	},
	answer: (args) => {
		const statements = args.count('statements')
		const risks = args.count('risks')
		const listed = [`${statements} ${statements === 1 ? 'statement' : 'statements'}`]
		if (risks > 0) listed.push(`${risks} ${risks === 1 ? 'risk' : 'risks'}`)
		return `Sent an answer with ${listed.join(' and ')} for ken to check`
	},
}

export function describeCall(name: string, args: JsonObject): string {
	const said: Said = {
		text(key) {
			const value = args[key]
			return typeof value === 'string' && value !== '' ? value : undefined
		},
		line(key) {
			const value = args[key]
			return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
		},
		count(key) {
			const value: JsonValue | undefined = args[key]
			return Array.isArray(value) ? value.length : 0
		},
	}
	return SENTENCES[name]?.(said) ?? `Used the tool ${code(name)}`
}

const MAX_SHOWN = 80

function code(value: string | undefined): string {
	const text = (value ?? '?').replaceAll(/\s+/g, ' ').replaceAll('`', "'")
	return `\`${text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 3)}...` : text}\``
}

// A full hash says nothing to a reader that its first seven characters do not.
function ref(value: string | undefined): string | undefined {
	return value !== undefined && /^[0-9a-f]{12,64}$/.test(value) ? value.slice(0, 7) : value
}

function at(args: Said): string {
	const commit = args.text('commit')
	return commit === undefined || commit === 'HEAD' ? '' : ` at ${code(ref(commit))}`
}

function under(args: Said): string {
	const folder = args.text('under')
	return folder === undefined ? '' : ` under ${code(folder)}`
}

function lines(args: Said): string {
	const start = args.line('start')
	const end = args.line('end')
	if (start !== undefined && end !== undefined) return start === end ? `, line ${start}` : `, lines ${start} to ${end}`
	if (start !== undefined) return `, from line ${start}`
	if (end !== undefined) return `, lines 1 to ${end}`
	return ''
}
