#!/usr/bin/env node
// The ken command. "ken chat" talks about a repository in the terminal. "ken ask" answers one question and exits, as
// text or as JSON for scripts. Exit code 0 means a reply, 1 means none, 2 means ken could not start.
// "ken record" shows the project record, "ken map" the reader's understanding map, and "ken layout" one level of the
// project's layout. "ken decide" logs a decision a coding agent makes as it works, and "ken sessions" reads the
// sessions Claude Code saved for the project. None of these needs a model. "ken open" serves the page on 127.0.0.1.
// The lenses print their list with no model, then ask the agent when one is set. "ken live" writes notes in the
// terminal while a coding agent works, as "ken open --live" does on the page.
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import {
	type Chat,
	type ChatEvent,
	type Item,
	type Outcome,
	type Reply,
	readModelConfig,
	type Step,
	startChat,
} from '../agent/index.ts'
import { drawn } from '../diagram/index.ts'
import type { RecordEntry } from '../record/index.ts'
import { decide } from './decide.ts'
import { watchLive } from './live.ts'
import { lensQuestion } from './map/lens-question.ts'
import { mapOf, printMap } from './map/print-map.ts'
import { openPage } from './open-page.ts'
import { printLayout } from './print-layout.ts'
import { printRecord } from './print-record.ts'
import { printSessions } from './print-sessions.ts'
import { LEGEND, printQuestion } from './reply/print-reply.ts'

const USAGE = `Usage:
  ken chat [--repo <path>]
  ken ask "<question>" [--repo <path>] [--json]
  ken record [<id>] [--repo <path>] [--json]
  ken map [--repo <path>] [--json]
  ken layout [--at <ref>] [--within <path>]... [--change <a..b, branch or uncommitted>] [--repo <path>] [--json]
  ken catch-up [--repo <path>]
  ken area <path> [--repo <path>]
  ken follow-up [--repo <path>]
  ken who <author> [--since <day or Nd>] [--repo <path>]
  ken since <day or Nd> [--repo <path>]
  ken open [--repo <path>] [--port <n>] [--live]
  ken live [--repo <path>]
  ken decide --question <text> --chosen <text> --reason <text> --undo <how easy> [...]
  ken decide --json < decision.json
  ken sessions [<id>] [--repo <path>] [--json]

Name the model with --model, --base-url and --api-key-env,
or with KEN_MODEL, KEN_BASE_URL and KEN_API_KEY_ENV.
Run "ken decide --help" to see how a coding agent logs a decision.`

async function main(argv: string[]): Promise<number> {
	if (argv[0] === 'decide') return await decide(argv.slice(1))
	const parsed = parseCommand(argv)
	if (parsed.kind === 'usage') {
		process.stderr.write(`${parsed.problem}\n\n${USAGE}\n`)
		return 2
	}
	const { values } = parsed
	if (parsed.kind === 'record') return await printRecord(values.repo ?? process.cwd(), parsed.id, values.json === true)
	if (parsed.kind === 'sessions')
		return await printSessions(values.repo ?? process.cwd(), parsed.id, values.json === true)
	if (parsed.kind === 'map') return await printMap(values.repo ?? process.cwd(), values.json === true)
	if (parsed.kind === 'layout') {
		const raw = { at: values.at, within: values.within, change: values.change }
		return await printLayout(values.repo ?? process.cwd(), raw, values.json === true)
	}
	const flags = { model: values.model, baseUrl: values['base-url'], apiKeyEnv: values['api-key-env'] }
	if (parsed.kind === 'open') {
		return await openPage({
			directory: values.repo ?? process.cwd(),
			port: values.port,
			flags,
			live: values.live === true,
		})
	}
	if (parsed.kind === 'live') return await watchLive({ directory: values.repo ?? process.cwd(), flags })
	const directory = values.repo ?? process.cwd()
	const lens = parsed.kind === 'chat' || parsed.kind === 'ask' ? null : await lensQuestion(parsed, directory)
	if (lens?.kind === 'refused') {
		process.stderr.write(`${lens.message}\n`)
		return 2
	}
	if (lens) process.stdout.write(`${lens.text}\n\n`)
	if (lens?.empty) return 0
	const config = readModelConfig(flags, process.env)
	if (config.kind !== 'ok') {
		process.stderr.write(`${config.message}\n`)
		return 2
	}
	// A script that asks for JSON is not a reader, so its questions leave the reader's map alone.
	const reader = values.json ? null : await mapOf(directory)
	const map = reader?.kind === 'ok' ? { map: reader.map } : {}
	const started = await startChat({ directory, model: config.config, env: process.env, ...map })
	if (started.kind !== 'ok') {
		process.stderr.write(`${started.message}\n`)
		return 2
	}
	const { chat } = started
	try {
		if (parsed.kind === 'chat') return await talk(chat)
		const question = parsed.kind === 'ask' ? parsed.question : (lens?.text ?? '')
		if (values.json) return await askForJson(chat, question)
		return (await printQuestion(chat.ask(question), process.stdout)) ? 0 : 1
	} finally {
		await chat.close()
	}
}

function parseCommand(argv: string[]) {
	const options = {
		repo: { type: 'string' },
		json: { type: 'boolean' },
		port: { type: 'string' },
		since: { type: 'string' },
		live: { type: 'boolean' },
		at: { type: 'string' },
		within: { type: 'string', multiple: true },
		change: { type: 'string' },
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
	if (command === 'sessions' && rest.length <= 1) return { kind: 'sessions', values, id: rest[0] } as const
	if (command === 'map' && rest.length === 0) return { kind: 'map', values } as const
	if (command === 'layout' && rest.length === 0) return { kind: 'layout', values } as const
	if (command === 'catch-up' && rest.length === 0 && !values.json) return { kind: 'catch-up', values } as const
	if (command === 'area' && rest.length === 1 && rest[0] && !values.json) {
		return { kind: 'area', values, path: rest[0] } as const
	}
	if (command === 'follow-up' && rest.length === 0 && !values.json) return { kind: 'follow-up', values } as const
	if (command === 'who' && rest.length === 1 && rest[0] && !values.json) {
		return { kind: 'who', values, author: rest[0], since: values.since ?? 'question' } as const
	}
	if (command === 'since' && rest.length === 1 && rest[0] && !values.json) {
		return { kind: 'since', values, since: rest[0] } as const
	}
	if (command === 'open' && rest.length === 0 && !values.json) return { kind: 'open', values } as const
	if (command === 'live' && rest.length === 0 && !values.json && !values.live) return { kind: 'live', values } as const
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
	process.stdout.write(`ken reads ${chat.root}. Ask a question. Press Ctrl-D to leave.\n${LEGEND}\n`)
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
		reply: Reply | null
		recorded: RecordEntry[]
		steps: Step[]
		usage: Extract<ChatEvent, { kind: 'usage' }> | null
		error: string | null
	} = { outcome: 'error', reply: null, recorded: [], steps: [], usage: null, error: null }
	for await (const event of chat.ask(question)) {
		if (event.kind === 'tool') result.steps.push({ kind: 'tool', text: event.step })
		if (event.kind === 'step') result.steps.push(event.step)
		if (event.kind === 'replied') {
			result.reply = { ...event.reply, items: event.reply.items.map(drawnItem) }
			result.recorded = event.recorded
		}
		if (event.kind === 'usage') result.usage = event
		if (event.kind === 'done') result.outcome = event.outcome
		if (event.kind === 'error') result.error = event.message
	}
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
	return result.outcome === 'answered' ? 0 : 1
}

// A diagram card in the JSON carries its Mermaid text, as the page gets it.
function drawnItem(item: Item): Item {
	if (item.kind !== 'card' || item.card.kind !== 'diagram') return item
	return { kind: 'card', card: { kind: 'diagram', diagram: drawn(item.card.diagram) } }
}

process.exitCode = await main(process.argv.slice(2))
