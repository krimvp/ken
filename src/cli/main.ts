#!/usr/bin/env node
// The ken command. "ken chat" talks about a repository in the terminal. "ken ask" answers one question and exits, as
// text or as JSON for scripts. Exit code 0 means a checked answer, 1 means none, 2 means ken could not start.
// "ken record" shows the project record and needs no model. "ken open" serves the page on 127.0.0.1.
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { type Answer, type Chat, type ChatEvent, type Outcome, readModelConfig, startChat } from '../agent/index.ts'
import { withDrawings } from '../diagram/index.ts'
import type { RecordEntry } from '../record/index.ts'
import { openPage } from './open-page.ts'
import { printQuestion } from './print-question.ts'
import { printRecord } from './print-record.ts'

const USAGE = `Usage:
  ken chat [--repo <path>]
  ken ask "<question>" [--repo <path>] [--json]
  ken record [<id>] [--repo <path>] [--json]
  ken open [--repo <path>] [--port <n>]

Name the model with --model, --base-url and --api-key-env,
or with KEN_MODEL, KEN_BASE_URL and KEN_API_KEY_ENV.`

async function main(argv: string[]): Promise<number> {
	const parsed = parseCommand(argv)
	if (parsed.kind === 'usage') {
		process.stderr.write(`${parsed.problem}\n\n${USAGE}\n`)
		return 2
	}
	const { values } = parsed
	if (parsed.kind === 'record') return await printRecord(values.repo ?? process.cwd(), parsed.id, values.json === true)
	const flags = { model: values.model, baseUrl: values['base-url'], apiKeyEnv: values['api-key-env'] }
	if (parsed.kind === 'open')
		return await openPage({ directory: values.repo ?? process.cwd(), port: values.port, flags })
	const config = readModelConfig(flags, process.env)
	if (config.kind !== 'ok') {
		process.stderr.write(`${config.message}\n`)
		return 2
	}
	const started = await startChat({ directory: values.repo ?? process.cwd(), model: config.config })
	if (started.kind !== 'ok') {
		process.stderr.write(`${started.message}\n`)
		return 2
	}
	const { chat } = started
	try {
		if (parsed.kind === 'chat') return await talk(chat)
		if (values.json) return await askForJson(chat, parsed.question)
		return (await printQuestion(chat.ask(parsed.question), process.stdout)) ? 0 : 1
	} finally {
		await chat.close()
	}
}

function parseCommand(argv: string[]) {
	const options = {
		repo: { type: 'string' },
		json: { type: 'boolean' },
		port: { type: 'string' },
		model: { type: 'string' },
		'base-url': { type: 'string' },
		'api-key-env': { type: 'string' },
	} as const
	let parsed: ReturnType<typeof parseArgs<{ args: string[]; options: typeof options; allowPositionals: true }>>
	try {
		parsed = parseArgs({ args: argv, options, allowPositionals: true })
	} catch (error) {
		return { kind: 'usage', problem: error instanceof Error ? error.message : String(error) } as const
	}
	const { values, positionals } = parsed
	const [command, ...rest] = positionals
	if (command === 'chat' && rest.length === 0 && !values.json) return { kind: 'chat', values } as const
	if (command === 'ask' && rest.length === 1 && rest[0]) return { kind: 'ask', values, question: rest[0] } as const
	if (command === 'ask') return { kind: 'usage', problem: 'ken ask takes one question, in quotes.' } as const
	if (command === 'record' && rest.length <= 1) return { kind: 'record', values, id: rest[0] } as const
	if (command === 'open' && rest.length === 0 && !values.json) return { kind: 'open', values } as const
	return {
		kind: 'usage',
		problem: command ? `ken does not know "${positionals.join(' ')}".` : 'Name a command.',
	} as const
}

async function talk(chat: Chat): Promise<number> {
	const terminal = process.stdin.isTTY === true
	const lines = createInterface({ input: process.stdin, output: process.stdout, terminal })
	let running: AbortController | undefined
	lines.on('SIGINT', () => (running ? running.abort() : lines.close()))
	process.stdout.write(`ken reads ${chat.root}. Ask a question. Press Ctrl-D to leave.\n`)
	lines.setPrompt('> ')
	lines.prompt()
	for await (const line of lines) {
		const question = line.trim()
		if (question !== '') {
			if (!terminal) process.stdout.write(`${question}\n`)
			running = new AbortController()
			await printQuestion(chat.ask(question, running.signal), process.stdout)
			running = undefined
		}
		lines.prompt()
	}
	process.stdout.write('\n')
	return 0
}

async function askForJson(chat: Chat, question: string): Promise<number> {
	const result: {
		outcome: Outcome | 'error'
		answer: Answer | null
		recorded: RecordEntry[]
		tools: Extract<ChatEvent, { kind: 'tool' }>[]
		rejected: Extract<ChatEvent, { kind: 'rejected' }>[]
		usage: Extract<ChatEvent, { kind: 'usage' }> | null
		text: string
		error: string | null
	} = { outcome: 'error', answer: null, recorded: [], tools: [], rejected: [], usage: null, text: '', error: null }
	for await (const event of chat.ask(question)) {
		if (event.kind === 'text') result.text += event.delta
		if (event.kind === 'tool') result.tools.push(event)
		if (event.kind === 'rejected') result.rejected.push(event)
		if (event.kind === 'accepted') {
			result.answer = withDrawings(event.answer)
			result.recorded = event.recorded
		}
		if (event.kind === 'usage') result.usage = event
		if (event.kind === 'done') result.outcome = event.outcome
		if (event.kind === 'error') result.error = event.message
	}
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
	return result.outcome === 'answered' ? 0 : 1
}

process.exitCode = await main(process.argv.slice(2))
