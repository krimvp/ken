import type { JsonObject, JsonValue } from 'aigent/plugin'

// One plain sentence per tool call, such as "Read `src/cli.ts`, lines 100 to 180", for the reader who watches the
// agent work. The terminal and the page both show it. It runs before the tool checks its arguments, so it reads them
// leniently and never throws.
type Said = {
	text(name: string): string | undefined
	line(name: string): number | undefined
	count(name: string): number
	has(name: string): boolean
}

const SENTENCES: Record<string, (args: Said) => string> = {
	resolve_ref: (args) => `Found ${commitNamed(args.text('ref'))}`,
	read_file: (args) => `Read ${code(args.text('path'))}${lines(args)}${at(args)}`,
	list_files: (args) => `Listed the files${under(args)}${at(args)}`,
	search: (args) => `Searched for ${code(args.text('pattern'))}${under(args)}${at(args)}`,
	log: (args) => {
		const base = args.text('base')
		const head = args.text('head')
		if (base !== undefined) return `Listed the commits from ${code(ref(base))} to ${code(ref(head ?? 'HEAD'))}`
		return head === undefined ? 'Listed the latest commits' : `Listed the latest commits up to ${code(ref(head))}`
	},
	blame: (args) => `Looked up who last changed ${code(args.text('path'))}${lines(args)}${at(args)}`,
	diff: (args) => {
		const range = `from ${code(ref(args.text('base')))} to ${code(ref(args.text('head')))}`
		const path = args.text('path')
		return path === undefined ? `Read the changes ${range}` : `Read the changes to ${code(path)} ${range}`
	},
	recall_chat: (args) =>
		args.line('number')
			? `Looked up answer ${args.line('number')} in this chat`
			: 'Looked up earlier answers in this chat',
	read_record: (args) => {
		const id = args.text('id')
		const words = args.text('search')
		if (id !== undefined) return `Read entry ${code(id)} in the project record`
		if (words !== undefined) return `Searched the project record for ${code(words)}`
		return 'Read the list of entries in the project record'
	},
	list_sessions: () => 'Listed the saved sessions of this project',
	read_session: (args) => {
		const message = args.line('message')
		const at = args.text('at')
		const part = message !== undefined ? `, around message ${message}` : at !== undefined ? ` near ${code(at)}` : ''
		return `Read saved session ${code(args.text('session')?.slice(0, 8))}${part}`
	},
	search_sessions: (args) => `Searched the saved sessions for ${code(args.text('text'))}`,
	remember: () => 'Kept a note on how you want things shown',
	show: (args) => {
		const cards = ['claims', 'decisions', 'risks', 'diagrams', 'topics'].reduce((n, list) => n + args.count(list), 0)
		const sent = [
			...(args.has('brief') ? ['a brief'] : []),
			...(args.has('step') ? ['a step'] : []),
			...(args.has('layout') ? ['the parts'] : []),
			...(args.has('views') ? ['drawings of where it runs'] : []),
			...(cards > 0 ? [cards === 1 ? 'a card' : `${cards} cards`] : []),
		]
		if (sent.length === 0) return args.has('scope') ? 'Named the change the reply is about' : 'Sent nothing to show'
		const listed = sent.length === 1 ? sent[0] : `${sent.slice(0, -1).join(', ')} and ${sent.at(-1)}`
		return `Sent ${listed} for ken to check`
	},
	revise_risks: (args) => {
		const changes = [
			[args.count('risks'), 'added', 'risk', 'risks'],
			[args.count('withdraw'), 'withdrew', 'risk', 'risks'],
		] as const
		const listed = changes.flatMap(([n, verb, one, many]) => (n > 0 ? [`${verb} ${n} ${n === 1 ? one : many}`] : []))
		if (listed.length === 0) return 'Looked again at the risks and found nothing to change'
		return `Looked again at the risks: ${listed.join(', ')}, for ken to check`
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
		has(key) {
			return args[key] !== undefined && args[key] !== null
		},
	}
	return SENTENCES[name]?.(said) ?? `Used the tool ${code(name)}`
}

const MAX_SHOWN = 80

function code(value: string | undefined): string {
	const text = (value ?? '?').replaceAll(/\s+/g, ' ').replaceAll('`', "'")
	return `\`${text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 3)}...` : text}\``
}

// "b5a9226^1" and "b5a9226~1" are the commit before b5a9226.
function commitNamed(value: string | undefined): string {
	const before = value?.match(/^(.+?)(?:\^1?|~1?)$/)?.[1]
	return before === undefined ? `which commit ${code(ref(value))} is` : `the commit before ${code(ref(before))}`
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
