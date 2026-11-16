import { createSession, type RunResult } from 'aigent'
import type { Tool } from 'aigent/plugin'
import { usedElsewhere } from '../checks/index.ts'
import type { UnderstandingMap } from '../map/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'
import { projectSessions } from '../transcripts/index.ts'
import { type AnswerRound, accept, answerTool, MAX_REJECTIONS, type Step } from './answer/answer-tool.ts'
import { FROM_DRAFT } from './answer/from-draft.ts'
import { laterCommits, laterText, MAX_PASS_REJECTIONS, reviseTool, riskPassQuestion } from './answer/risk-pass.ts'
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
// Each step of a question has its own turns, counted from 0, and a notice when few are left: a model that runs out of
// turns while reading sends nothing, so it is told to finish with what it has. A question about a change takes all
// three steps: the draft, the answer made from it, and the second look at its risks. Any other question, a live note and
// a change the record already explains end in the first step with the answer. Answers about pull requests of up to
// seventeen files took 8 to 13 turns, so more would only let a question that goes astray cost more. The answer step
// has room to read again the lines it quotes, three rejected tries and the end of the turn; the second look reads the
// places it is asked about and sends one revision.
const STEPS: Record<Step, { turns: number; notice: number; say: string }> = {
	draft: {
		turns: 40,
		notice: 6,
		say: 'for this question. Finish now with what you have read: write your draft, or send the answer if the question is not about a change. Say what you did not get to read.',
	},
	answer: {
		turns: 14,
		notice: 5,
		say: 'to send the answer. Send it now with the lines you have read, and leave out what you cannot quote.',
	},
	risks: {
		turns: 10,
		notice: 3,
		say: 'for the questions about risks. Call revise_answer now with what you have read.',
	},
}
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
	let round: AnswerRound = { rejections: 0, answer: null, asked: false, held: null, step: 'draft', emit: () => {} }
	let turnsEnded = 0
	const withTurnsLeft = (tool: Tool): Tool => ({
		...tool,
		async execute(args, ctx) {
			const result = await tool.execute(args, ctx)
			const step = STEPS[round.step]
			// This call's own turn has not ended yet, so it is not left.
			const left = step.turns - turnsEnded - 1
			if (left > step.notice || round.answer) return result
			const notice = `${left} ${left === 1 ? 'turn' : 'turns'} left ${step.say}`
			return { ...result, content: [...result.content, { type: 'text', text: notice }] }
		},
	})
	// A question reads the names used elsewhere and the later commits on the same files once per range, at the first log
	// or diff of it. A note does without, and so does the risk pass, which has both in its question.
	const shown = new Set<string>()
	const elsewhere: Elsewhere = async (range, signal) => {
		const key = `${range.base}..${range.head}`
		if (!round.asked || round.step === 'risks' || shown.has(key)) return null
		shown.add(key)
		const [found, later] = await Promise.all([usedElsewhere(repo, range, signal), laterCommits(repo, range, signal)])
		const parts = [found.kind === 'ok' ? elsewhereText(found.used) : '', laterText(later, range.head).join('\n')]
		const text = parts.filter((part) => part !== '').join('\n\n')
		return text === '' ? null : text
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
		maxTurns: STEPS.draft.turns,
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
			step: 'draft',
			emit: events.push,
		}
		round = current
		turnsEnded = 0
		shown.clear()
		const stop = new AbortController()
		// The later steps have their own stops, so ending one at its turn limit does not end the checks that follow it.
		const stops: Record<Step, AbortController> = {
			draft: stop,
			answer: new AbortController(),
			risks: new AbortController(),
		}
		// Set when ken stopped a step at its turn limit, which is running out of turns, not the reader stopping it.
		let limited = false
		const tokens = { input: 0, output: 0 }
		const unsubscribe = session.subscribe((event) => {
			if (event.type === 'text') events.push({ kind: 'text', delta: event.delta })
			if (event.type === 'tool_start') {
				const name = event.call.name.replace(`${PLUGIN}__`, '')
				events.push({ kind: 'tool', name, step: describeCall(name, event.call.args) })
			}
			// The answer tool has told the model it is out of attempts. Stopping here keeps a model that ignores that
			// from spending more turns.
			const spent =
				current.step === 'risks'
					? (current.held?.rejections ?? 0) >= MAX_PASS_REJECTIONS
					: current.rejections >= MAX_REJECTIONS
			if (event.type === 'tool_end' && spent) stops[current.step].abort()
			if (event.type === 'turn_end') turnsEnded += 1
			// aigent stops the draft step at its turns; the later steps have fewer, so ken stops them.
			if (event.type === 'turn_end' && current.step !== 'draft' && turnsEnded >= STEPS[current.step].turns) {
				limited = true
				stops[current.step].abort()
			}
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
		const step = async (next: Step, text: string): Promise<RunResult> => {
			current.step = next
			turnsEnded = 0
			return await prompt(text, stops[next])
		}
		const run = (async () => {
			let result = await prompt(`${index}${reader}\n\nThe question: ${question}`, stop)
			const draft = { ...tokens, at: performance.now() }
			// A turn that ends in text, with no answer, is the draft of an answer about a change.
			const drafted = current.asked && result.stop === 'done' && result.text.trim() !== '' && !current.answer
			if (drafted && !current.held && !signal?.aborted) {
				result = await step('answer', FROM_DRAFT)
			}
			const fromDraft = drafted ? costSince(draft, tokens) : null
			let riskPass: Cost | null = null
			const { held } = current
			if (held && !signal?.aborted) {
				// A model that failed after the answer was held would fail the pass too, so the held answer stands.
				if (result.stop !== 'error') {
					const before = { ...tokens, at: performance.now() }
					const later = held.answer.change
						? await laterCommits(repo, held.answer.change, signal)
						: { shown: [], total: 0 }
					result = await step('risks', riskPassQuestion(held, later))
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
			events.push({
				kind: 'usage',
				inputTokens: tokens.input,
				outputTokens: tokens.output,
				seconds,
				fromDraft,
				riskPass,
			})
			events.push(endOf(result, current, limited))
			events.close()
		})()
		try {
			yield* events.drain()
		} finally {
			unsubscribe()
			for (const each of Object.values(stops)) each.abort()
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

function endOf(result: RunResult, round: AnswerRound, limited: boolean): ChatEvent {
	if (round.answer) return { kind: 'done', outcome: 'answered' }
	if (round.rejections >= MAX_REJECTIONS) return { kind: 'done', outcome: 'rejected' }
	if (result.stop === 'error') return { kind: 'error', message: result.message }
	if (limited) return { kind: 'done', outcome: 'out-of-turns' }
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
