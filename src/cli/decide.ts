// "ken decide" logs one decision into the project record, for a coding agent to call at the moment it makes a choice.
// It takes the decision as options, or as one JSON object on standard input, and writes it through the same gate as
// every other entry. ken labels it recorded and reads the commit from git; the caller sets neither.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type EntryDraft, entryLine, fileRecordStore, type Quote } from '../record/index.ts'
import { findRoot, gitRepository, parsePath, type Repository } from '../repo/index.ts'

export const DECIDE_USAGE = `Usage:
  ken decide --question <text> --chosen <text> --reason <text> --undo easy|some-work|hard
             [--rejected "<option>: <why not>"]... [--needs-owner]
             [--quote <path>:<first>-<last>[@<commit>]]... [--by <name>] [--repo <path>]
  ken decide --json < decision.json

Log a decision in the project record as you make it: when you choose between real
options, when you leave a choice for the owner (add --needs-owner), or when you do
something hard to undo. A choice with one obvious answer needs no entry.

A quote is lines of committed code: <path>:<line> or <path>:<first>-<last> at HEAD,
or with @<commit> after it for an older commit. Lines you have not committed cannot
be quoted, so log the decision without --quote, or commit first.

--json reads one JSON object from standard input with the fields question, chosen,
reason, rejected (a list of {"option", "reason"}), undo, needsOwner, quotes (a list
of strings written like --quote) and by. ken sets the label itself.

Exit code 0 means the decision is in the record. 1 means ken refused it and wrote
nothing. 2 means ken could not run.`

// What the caller gives. The gate checks the texts and undo, and quoteOf checks the quotes.
type DecisionInput = {
	question: string
	chosen: string
	reason: string
	rejected: { option: string; reason: string }[]
	undo: string
	needsOwner: boolean
	quotes: string[]
	by: string | null
}

// problems holds what the caller must fix in input. A refusal means there is no input to check further.
type Input = { kind: 'ok'; input: DecisionInput; problems: string[] } | { kind: 'refused'; problem: string }

const OPTIONS = {
	question: { type: 'string' },
	chosen: { type: 'string' },
	reason: { type: 'string' },
	rejected: { type: 'string', multiple: true },
	undo: { type: 'string' },
	'needs-owner': { type: 'boolean' },
	quote: { type: 'string', multiple: true },
	by: { type: 'string' },
	repo: { type: 'string' },
	json: { type: 'boolean' },
	help: { type: 'boolean', short: 'h' },
} as const
type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>['values']

const FIELDS = ['question', 'chosen', 'reason', 'rejected', 'undo', 'needsOwner', 'quotes', 'by']
// One decision as JSON is a few kilobytes. More is a mistake, such as a file piped in by accident.
const MAX_INPUT_BYTES = 256 * 1024
const QUOTE = /^(.+):(\d+)(?:-(\d+))?(?:@(.+))?$/

export async function decide(argv: string[]): Promise<number> {
	let values: Values
	try {
		values = parseArgs({ args: argv, options: OPTIONS }).values
	} catch (error) {
		return cannotRun(optionProblem(error))
	}
	if (values.help) {
		process.stdout.write(`${DECIDE_USAGE}\n`)
		return 0
	}
	const found = await findRoot(values.repo ?? process.cwd())
	if (found.kind !== 'ok') return cannotRun(`${values.repo ?? process.cwd()} is not inside a git repository.`)
	if (values.json && Object.keys(values).some((name) => name !== 'json' && name !== 'repo')) {
		return cannotRun('Give the decision as options or as JSON on standard input, not both.')
	}
	if (values.json && process.stdin.isTTY) {
		return cannotRun('ken decide --json reads the decision from standard input. Pipe it in.')
	}

	const read = values.json ? fromJson(await readInput()) : fromOptions(values)
	if (read.kind === 'refused') return refuse([read.problem])
	const { input, problems } = read
	const repo = gitRepository(found.root)
	const quotes: Quote[] = []
	for (const raw of input.quotes) {
		const quote = await quoteOf(repo, found.root, raw)
		if (quote.kind === 'ok') quotes.push(quote.quote)
		else problems.push(quote.problem)
	}
	const draft: EntryDraft = {
		kind: 'decision',
		question: input.question,
		chosen: input.chosen,
		reason: { text: input.reason, quotes: [] },
		rejected: input.rejected,
		undo: input.undo,
		needsOwner: input.needsOwner,
		quotes,
		work: null,
		logged: { by: input.by },
	}
	const store = fileRecordStore(found.root, repo)
	const checked = await store.check(draft)
	if (checked.kind === 'refused') problems.push(...checked.problems)
	if (problems.length > 0) return refuse(problems)

	const appended = await store.append([draft])
	if (appended.kind === 'refused') return refuse(appended.problems)
	const [result] = appended.entries
	if (!result) throw new Error('ken decide: the record appended one draft and returned no entry')
	process.stdout.write(`${result.written ? 'Logged' : 'The record already holds'} ${entryLine(result.entry)}\n`)
	return 0
}

function fromOptions(values: Values): Input {
	const problems: string[] = []
	const rejected = (values.rejected ?? []).flatMap((raw) => {
		const split = raw.indexOf(': ')
		if (split > 0) return [{ option: raw.slice(0, split), reason: raw.slice(split + 2) }]
		problems.push(`write each rejected option as "<option>: <why not>". "${raw}" has no ": " in it.`)
		return []
	})
	const input = {
		question: values.question ?? '',
		chosen: values.chosen ?? '',
		reason: values.reason ?? '',
		rejected,
		undo: values.undo ?? '',
		needsOwner: values['needs-owner'] === true,
		quotes: values.quote ?? [],
		by: values.by ?? null,
	}
	return { kind: 'ok', input, problems }
}

function fromJson(text: string | null): Input {
	if (text === null) return { kind: 'refused', problem: 'standard input holds more than 256 KB.' }
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (error) {
		const why = error instanceof Error ? error.message : String(error)
		return { kind: 'refused', problem: `standard input is not JSON: ${why}.` }
	}
	if (!isObject(value)) {
		return { kind: 'refused', problem: 'give the decision as one JSON object: {"question": "...", ...}.' }
	}
	const problems: string[] = []
	for (const key of Object.keys(value)) {
		if (key === 'label') problems.push('ken sets the label itself, so leave "label" out.')
		else if (!FIELDS.includes(key)) problems.push(`ken decide has no field "${key}". It takes ${FIELDS.join(', ')}.`)
	}
	const textOf = (key: string): string => {
		const field = value[key] ?? ''
		if (typeof field === 'string') return field
		problems.push(`"${key}" must be text.`)
		return ''
	}
	const listOf = <T>(key: string, isItem: (item: unknown) => item is T, shape: string): T[] => {
		const field = value[key] ?? []
		if (Array.isArray(field) && field.every(isItem)) return field
		problems.push(`"${key}" must be a list of ${shape}.`)
		return []
	}
	const { needsOwner = false, by = null } = value
	if (typeof needsOwner !== 'boolean') problems.push('"needsOwner" must be true or false.')
	if (by !== null && typeof by !== 'string') problems.push('"by" must be text.')
	const input = {
		question: textOf('question'),
		chosen: textOf('chosen'),
		reason: textOf('reason'),
		rejected: listOf('rejected', isRejected, '{"option": "...", "reason": "..."}'),
		undo: textOf('undo'),
		needsOwner: needsOwner === true,
		quotes: listOf('quotes', (item) => typeof item === 'string', 'strings such as "src/app.ts:10-14"'),
		by: typeof by === 'string' ? by : null,
	}
	return { kind: 'ok', input, problems }
}

// A quote names lines, the way agents cite code, and ken reads their text from git, so the gate checks real lines.
// An agent counts lines in the files it has open, which may differ from HEAD. So a quote at HEAD must match the working
// tree too: otherwise ken would store other lines than the ones the agent meant.
async function quoteOf(
	repo: Repository,
	root: string,
	raw: string,
): Promise<{ kind: 'ok'; quote: Quote } | { kind: 'refused'; problem: string }> {
	const refused = (why: string): { kind: 'refused'; problem: string } => ({
		kind: 'refused',
		problem: `the quote "${raw}": ${why}`,
	})
	const match = QUOTE.exec(raw.trim())
	const [, file = '', first = '', last = first, commit] = match ?? []
	if (!match)
		return refused('write it as <path>:<line> or <path>:<first>-<last>, with @<commit> after for an older one.')
	const [start, end] = [Number(first), Number(last)]
	if (start < 1 || end < start) return refused('it names no lines. Count from 1, the first line before the last.')
	const lines = start === end ? `line ${start}` : `lines ${start}-${end}`
	const parsed = parsePath(file)
	if (parsed.kind !== 'ok') return refused(`${parsed.reason}.`)
	const at = commit ?? 'HEAD'
	const resolved = await repo.resolve(at)
	if (resolved.kind !== 'ok' && commit === undefined) {
		return refused('the repository has no commit yet, so there is no committed code to quote. Leave the quote out.')
	}
	if (resolved.kind !== 'ok') return refused(`there is no commit "${commit}".`)
	const source = await repo.readFile(resolved.commit, parsed.path)
	if (source.kind === 'no-file') return refused(`there is no file ${parsed.path} at ${at}.`)
	if (source.kind === 'too-large') return refused(`${parsed.path} is too large to quote.`)
	const rows = source.text.split('\n')
	const count = source.text.endsWith('\n') ? rows.length - 1 : rows.length
	if (end > count) return refused(`${parsed.path} has ${count} lines at ${at}, so it has no ${lines}.`)
	const text = rows.slice(start - 1, end).join('\n')
	if (commit === undefined) {
		const own = await readFile(path.join(root, parsed.path), 'utf8').catch(() => null)
		if (
			own
				?.split('\n')
				.slice(start - 1, end)
				.join('\n') !== text
		) {
			return refused(
				`${parsed.path} in your working tree differs from HEAD at ${lines}. A quote must be committed code: commit first, or leave the quote out.`,
			)
		}
	}
	return { kind: 'ok', quote: { path: parsed.path, commit: resolved.commit, text, line: start } }
}

function isRejected(item: unknown): item is { option: string; reason: string } {
	if (!isObject(item)) return false
	const { option, reason, ...rest } = item
	return typeof option === 'string' && typeof reason === 'string' && Object.keys(rest).length === 0
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionProblem(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	const unknown = error instanceof Error && 'code' in error && error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
	const name = /'(-[^']*)'/.exec(message)?.[1]
	if (!unknown || name === undefined) return `ken decide could not read its options: ${message}`
	return `ken decide has no option ${name}.${name === '--label' ? ' ken sets the label itself.' : ''}`
}

async function readInput(): Promise<string | null> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of process.stdin) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
		size += buffer.length
		if (size > MAX_INPUT_BYTES) return null
		chunks.push(buffer)
	}
	return Buffer.concat(chunks).toString('utf8')
}

function refuse(problems: string[]): number {
	const listed = problems.map((problem) => `- ${problem}`).join('\n')
	process.stderr.write(`ken did not log the decision:\n${listed}\nNothing was written. Fix these and run it again.\n`)
	return 1
}

function cannotRun(problem: string): number {
	process.stderr.write(`${problem}\nRun "ken decide --help" to see how to log a decision.\n`)
	return 2
}
