import { createSession, type RunResult } from 'aigent'
import type { Tool } from 'aigent/plugin'
import { usedElsewhere } from '../checks/index.ts'
import type { UnderstandingMap } from '../map/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'
import { projectSessions } from '../transcripts/index.ts'
import { type AnswerRound, accept, answerTool, MAX_REJECTIONS } from './answer/answer-tool.ts'
import { laterCommits, MAX_PASS_REJECTIONS, reviseTool, riskPassQuestion } from './answer/risk-pass.ts'
import type { ChatEvent, Cost } from './chat-event.ts'
import type { ModelConfig } from './model-config.ts'
import { readerIndex } from './reader-index.ts'
import { SYSTEM_PROMPT } from './system-prompt.ts'
import { describeCall } from './tools/describe-call.ts'
import { diffTool } from './tools/diff-tool.ts'
import { type Elsewhere, elsewhereText } from './tools/elsewhere-text.ts'
import { explorationTools } from './tools/exploration-tools.ts'
import { recordIndex, recordTool } from './tools/record-tool.ts'
import { sessionTools } from './tools/session-tools.ts'

export type Chat = {
	root: string
	// One question at a time. Breaking out of the loop early stops the question. as 'note' is a note ken writes by
	// itself in live mode, which tells the reader's map nothing.
	ask(question: string, signal?: AbortSignal, as?: 'question' | 'note'): AsyncGenerator<ChatEvent>
	close(): Promise<void>
}

const PLUGIN = 'ken'
// Answers about pull requests of up to seventeen files took 8 to 13 turns, and the notice below makes the model answer
// before the limit, so more turns would only let a question that goes astray cost more.
const MAX_TURNS = 40
// Room for the answer, three rejected tries and the closing note. A model that ran out of turns while reading sent
// nothing, so it is told to answer with what it has.
const TURNS_LEFT_NOTICE = 6
// The risk pass reads the places it is asked about and sends one revision, so it needs a few turns, not a question's.
const RISK_PASS_TURNS = 10
const RISK_PASS_NOTICE = 3
// Above the diff tool's own limit, so a whole diff reaches the model uncut.
const MAX_TOOL_RESULT_CHARS = 64_000

// map is the reader's understanding map. A chat run by a script, such as "ken ask --json", has no reader and no map.
// env decides which saved sessions the agent may read (see projectSessions) and which values secretHider hides.
// snapshots is ken's store of snapshots of uncommitted work (see the live module), which the agent's tools and the
// quote check read as well as the project's own git.
export async function startChat(options: {
	directory: string
	model: ModelConfig
	env: Record<string, string | undefined>
	map?: UnderstandingMap
	snapshots?: string
}): Promise<{ kind: 'ok'; chat: Chat } | { kind: 'no-repository'; message: string }> {
	const found = await findRoot(options.directory)
	if (found.kind !== 'ok') {
		return { kind: 'no-repository', message: `${options.directory} is not inside a git repository.` }
	}
	const project = gitRepository(found.root)
	const repo = options.snapshots ? gitRepository(found.root, { alternate: options.snapshots }) : project
	const sessions = projectSessions(found.root, options.env)
	// The record reads the project alone, so its gate refuses a quote of a snapshot whatever reaches it.
	const store = fileRecordStore(found.root, project, sessions)
	let round: AnswerRound = { rejections: 0, answer: null, asked: false, held: null, emit: () => {} }
	let turnsEnded = 0
	// Each question counts its turns from 0, and so does its risk pass.
	let inPass = false
	const withTurnsLeft = (tool: Tool): Tool => ({
		...tool,
		async execute(args, ctx) {
			const result = await tool.execute(args, ctx)
			// This call's own turn has not ended yet, so it is not left.
			const left = (inPass ? RISK_PASS_TURNS : MAX_TURNS) - turnsEnded - 1
			if (left > (inPass ? RISK_PASS_NOTICE : TURNS_LEFT_NOTICE) || round.answer) return result
			const turns = `${left} ${left === 1 ? 'turn' : 'turns'} left`
			const notice = inPass
				? `${turns} for the questions about risks. Call revise_answer now with what you have read.`
				: `${turns} for this question. Send the answer now with what you have read. In your closing note, say what you did not get to read.`
			return { ...result, content: [...result.content, { type: 'text', text: notice }] }
		},
	})
	// A question reads the names used elsewhere once per range, at the first log or diff of it. A note does without, and
	// so does the risk pass, which reads the later commits and has the names in its question.
	const shown = new Set<string>()
	const elsewhere: Elsewhere = async (range, signal) => {
		const key = `${range.base}..${range.head}`
		if (!round.asked || inPass || shown.has(key)) return null
		shown.add(key)
		const found = await usedElsewhere(repo, range, signal)
		return found.kind === 'ok' ? elsewhereText(found.used) : null
	}
	const gate = { sources: { repo, sessions }, store, project, map: options.map ?? null }
	const { model, baseUrl, apiKeyEnv } = options.model
	const session = await createSession({
		model: { kind: 'openai-compatible', baseUrl, id: model, apiKeyEnv },
		plugins: [
			{
				name: PLUGIN,
				description: "Reads the project's files, git history and saved sessions, and checks answers against them.",
				tools: [
					...explorationTools(repo, elsewhere),
					diffTool(repo, elsewhere),
					recordTool(store, repo),
					...sessionTools(sessions),
					answerTool(gate, () => round),
					reviseTool(gate, () => round),
				].map(withTurnsLeft),
			},
		],
		enabled: [PLUGIN],
		toolMode: 'native',
		maxTurns: MAX_TURNS,
		maxToolResultChars: MAX_TOOL_RESULT_CHARS,
		systemPrompt: SYSTEM_PROMPT,
	})

	async function* ask(question: string, signal?: AbortSignal, as = 'question'): AsyncGenerator<ChatEvent> {
		const events = eventQueue()
		const current: AnswerRound = {
			rejections: 0,
			answer: null,
			asked: as === 'question',
			held: null,
			emit: events.push,
		}
		round = current
		turnsEnded = 0
		inPass = false
		shown.clear()
		const stop = new AbortController()
		// The risk pass has its own stop, so ending it at its turn limit does not end the checks that follow it.
		const passStop = new AbortController()
		const tokens = { input: 0, output: 0 }
		const unsubscribe = session.subscribe((event) => {
			if (event.type === 'text') events.push({ kind: 'text', delta: event.delta })
			if (event.type === 'tool_start') {
				const name = event.call.name.replace(`${PLUGIN}__`, '')
				events.push({ kind: 'tool', name, step: describeCall(name, event.call.args) })
			}
			// The answer tool has told the model it is out of attempts. Stopping here keeps a model that ignores that
			// from spending more turns.
			const spent = inPass
				? (current.held?.rejections ?? 0) >= MAX_PASS_REJECTIONS
				: current.rejections >= MAX_REJECTIONS
			if (event.type === 'tool_end' && spent) (inPass ? passStop : stop).abort()
			if (event.type === 'turn_end') turnsEnded += 1
			// aigent stops a question at MAX_TURNS; the risk pass has fewer, so ken stops it.
			if (event.type === 'turn_end' && inPass && turnsEnded >= RISK_PASS_TURNS) passStop.abort()
			if (event.type === 'record' && event.record.kind === 'usage') {
				tokens.input += event.record.input + event.record.cacheRead + event.record.cacheWrite
				tokens.output += event.record.output
			}
		})
		const started = performance.now()
		const index = recordIndex(await store.read())
		const reader = options.map ? `\n\n${readerIndex(await options.map.read(new Date(), signal))}` : ''
		const prompt = async (text: string, own: AbortController): Promise<RunResult> =>
			await session
				.prompt(text, { signal: signal ? AbortSignal.any([signal, own.signal]) : own.signal })
				.catch((error: unknown): RunResult => ({ stop: 'error', message: String(error), turns: 0 }))
		const run = (async () => {
			let result = await prompt(`${index}${reader}\n\nThe question: ${question}`, stop)
			let riskPass: Cost | null = null
			const { held } = current
			if (held && !signal?.aborted) {
				// A model that failed after the answer was held would fail the pass too, so the held answer stands.
				if (result.stop !== 'error') {
					const before = { ...tokens, at: performance.now() }
					const later = held.answer.change ? await laterCommits(repo, held.answer.change, signal) : []
					inPass = true
					turnsEnded = 0
					result = await prompt(riskPassQuestion(held, later), passStop)
					riskPass = costSince(before, tokens)
				}
				if (!current.answer && !signal?.aborted) {
					const accepted = await accept(gate, current, held.args, null, signal ?? new AbortController().signal)
					if (accepted.kind !== 'accepted') {
						current.emit({ kind: 'rejected', attempt: current.rejections + 1, problems: accepted.problems })
					}
				}
			}
			const seconds = Math.round((performance.now() - started) / 100) / 10
			events.push({ kind: 'usage', inputTokens: tokens.input, outputTokens: tokens.output, seconds, riskPass })
			events.push(endOf(result, current))
			events.close()
		})()
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

function costSince(
	before: { input: number; output: number; at: number },
	tokens: { input: number; output: number },
): Cost {
	const seconds = Math.round((performance.now() - before.at) / 100) / 10
	return { inputTokens: tokens.input - before.input, outputTokens: tokens.output - before.output, seconds }
}

function endOf(result: RunResult, round: AnswerRound): ChatEvent {
	if (round.answer) return { kind: 'done', outcome: 'answered' }
	if (round.rejections >= MAX_REJECTIONS) return { kind: 'done', outcome: 'rejected' }
	if (result.stop === 'error') return { kind: 'error', message: result.message }
	if (result.stop === 'aborted') return { kind: 'error', message: 'The question was stopped before it had an answer.' }
	return { kind: 'done', outcome: result.stop === 'max_turns' ? 'out-of-turns' : 'no-answer' }
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
