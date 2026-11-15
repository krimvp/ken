import { createSession, type RunResult } from 'aigent'
import type { JsonObject, JsonValue } from 'aigent/plugin'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'
import { type AnswerRound, answerTool, MAX_REJECTIONS } from './answer/answer-tool.ts'
import type { ChatEvent } from './chat-event.ts'
import type { ModelConfig } from './model-config.ts'
import { SYSTEM_PROMPT } from './system-prompt.ts'
import { diffTool } from './tools/diff-tool.ts'
import { explorationTools } from './tools/exploration-tools.ts'
import { recordIndex, recordTool } from './tools/record-tool.ts'

export type Chat = {
	root: string
	// One question at a time. Breaking out of the loop early stops the question.
	ask(question: string, signal?: AbortSignal): AsyncGenerator<ChatEvent>
	close(): Promise<void>
}

const PLUGIN = 'ken'
// A model that calls one tool per turn needs about twenty turns to read a pull request of a dozen files.
const MAX_TURNS = 40
// Above the diff tool's own limit, so a whole diff reaches the model uncut.
const MAX_TOOL_RESULT_CHARS = 64_000

export async function startChat(options: {
	directory: string
	model: ModelConfig
}): Promise<{ kind: 'ok'; chat: Chat } | { kind: 'no-repository'; message: string }> {
	const found = await findRoot(options.directory)
	if (found.kind !== 'ok') {
		return { kind: 'no-repository', message: `${options.directory} is not inside a git repository.` }
	}
	const repo = gitRepository(found.root)
	const store = fileRecordStore(found.root, repo)
	let round: AnswerRound = { rejections: 0, answer: null, emit: () => {} }
	const { model, baseUrl, apiKeyEnv } = options.model
	const session = await createSession({
		model: { kind: 'openai-compatible', baseUrl, id: model, apiKeyEnv },
		plugins: [
			{
				name: PLUGIN,
				description: "Reads the project's files and git history, and checks answers against them.",
				tools: [
					...explorationTools(repo),
					diffTool(repo),
					recordTool(store, repo),
					answerTool(repo, store, () => round),
				],
			},
		],
		enabled: [PLUGIN],
		toolMode: 'native',
		maxTurns: MAX_TURNS,
		maxToolResultChars: MAX_TOOL_RESULT_CHARS,
		systemPrompt: SYSTEM_PROMPT,
	})

	async function* ask(question: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
		const events = eventQueue()
		const current: AnswerRound = { rejections: 0, answer: null, emit: events.push }
		round = current
		const stop = new AbortController()
		const tokens = { input: 0, output: 0 }
		const unsubscribe = session.subscribe((event) => {
			if (event.type === 'text') events.push({ kind: 'text', delta: event.delta })
			if (event.type === 'tool_start') {
				events.push({
					kind: 'tool',
					name: event.call.name.replace(`${PLUGIN}__`, ''),
					summary: summarize(event.call.args),
				})
			}
			// The answer tool has told the model it is out of attempts. Stopping here keeps a model that ignores that
			// from spending more turns.
			if (event.type === 'tool_end' && current.rejections >= MAX_REJECTIONS) stop.abort()
			if (event.type === 'record' && event.record.kind === 'usage') {
				tokens.input += event.record.input + event.record.cacheRead + event.record.cacheWrite
				tokens.output += event.record.output
			}
		})
		const started = performance.now()
		const index = recordIndex(await store.read())
		const run = session
			.prompt(`${index}\n\nThe question: ${question}`, {
				signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
			})
			.catch((error: unknown): RunResult => ({ stop: 'error', message: String(error), turns: 0 }))
			.then((result) => {
				const seconds = Math.round((performance.now() - started) / 100) / 10
				events.push({ kind: 'usage', inputTokens: tokens.input, outputTokens: tokens.output, seconds })
				events.push(endOf(result, current))
				events.close()
			})
		try {
			yield* events.drain()
		} finally {
			unsubscribe()
			stop.abort()
			await run
		}
	}

	return { kind: 'ok', chat: { root: found.root, ask, close: () => session.close() } }
}

function endOf(result: RunResult, round: AnswerRound): ChatEvent {
	if (round.answer) return { kind: 'done', outcome: 'answered' }
	if (round.rejections >= MAX_REJECTIONS) return { kind: 'done', outcome: 'rejected' }
	if (result.stop === 'error') return { kind: 'error', message: result.message }
	if (result.stop === 'aborted') return { kind: 'error', message: 'The question was stopped before it had an answer.' }
	return { kind: 'done', outcome: result.stop === 'max_turns' ? 'out-of-turns' : 'no-answer' }
}

function summarize(args: JsonObject): string {
	return Object.entries(args)
		.map(([name, value]) => `${name}=${brief(value)}`)
		.join(' ')
}

function brief(value: JsonValue): string {
	if (Array.isArray(value)) return `[${value.length}]`
	const text = (typeof value === 'string' ? value : JSON.stringify(value)).replaceAll(/\s+/g, ' ')
	return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

// Turns aigent's listener calls into the stream ask returns.
function eventQueue() {
	const waiting: ChatEvent[] = []
	let wake: (() => void) | undefined
	let closed = false
	return {
		push(event: ChatEvent) {
			waiting.push(event)
			wake?.()
		},
		close() {
			closed = true
			wake?.()
		},
		async *drain(): AsyncGenerator<ChatEvent> {
			while (true) {
				const event = waiting.shift()
				if (event) {
					yield event
					continue
				}
				if (closed) return
				await new Promise<void>((resolve) => {
					wake = resolve
				})
				wake = undefined
			}
		},
	}
}
