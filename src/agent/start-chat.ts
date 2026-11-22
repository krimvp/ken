import { randomUUID } from 'node:crypto'
import { createSession, type RunResult, type Session } from 'aigent'
import type { Tool, ToolOutcome } from 'aigent/plugin'
import { followedNames, usedElsewhere } from '../checks/index.ts'
import type { ReaderNotes, ReaderPrefs, UnderstandingMap } from '../map/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'
import { projectSessions } from '../transcripts/index.ts'
import { SHORTEN_PROMPT, type Shorten, shortened, shortenQuestion } from './brief/shorten-lines.ts'
import type { ChatEvent, Cost } from './chat-event.ts'
import { briefParts, forRecord, lensOf, readLimit } from './lens/lens.ts'
import { plainFacts } from './lens/plain-facts.ts'
import type { ModelConfig } from './model-config.ts'
import { readerIndex } from './reader-index.ts'
import { quotesOf } from './reply/check-card.ts'
import { fileTurn } from './reply/file-turn.ts'
import { endReply } from './reply/record-reply.ts'
import type { Item } from './reply/reply.ts'
import { laterCommits, laterText, MAX_PASS_REJECTIONS, reviseTool, riskPassQuestion } from './reply/risk-pass.ts'
import { type Asking, changeNamed, freshRound, type Round, showTool } from './reply/show-tool.ts'
import { type SavedAnswer, threadMemory } from './reply/thread-memory.ts'
import { SYSTEM_PROMPT } from './system-prompt.ts'
import { describeCall } from './tools/describe-call.ts'
import { diffTool } from './tools/diff-tool.ts'
import { type Elsewhere, elsewhereText } from './tools/elsewhere-text.ts'
import { explorationTools } from './tools/exploration-tools.ts'
import { type Memory, memoryTools, recordIndex } from './tools/memory-tool.ts'
import { rememberTool } from './tools/remember-tool.ts'
import { sessionTools } from './tools/session-tools.ts'

export type Chat = {
	root: string
	// This chat's thread. A new Chat is a new thread: its model remembers what was asked of this one alone.
	thread: string
	// Several questions may run at once, each in a session of its own. Breaking out of the loop early stops the
	// question. as says how it is asked: see Asking.
	ask(question: string, signal?: AbortSignal, as?: Asking): AsyncGenerator<ChatEvent>
	close(): Promise<void>
}

const PLUGIN = 'ken'
// Each step of a question has its own turns, counted from 0, and a notice when few are left: a model that runs out of
// turns while reading says nothing, so it is told to reply with what it has. A question is one step. A reply that
// sends the risks of a change gets a second, the second look at them. Answers about pull requests of up to seventeen
// files took 8 to 13 turns, so more would only let a question that goes astray cost more.
const STEPS: Record<Round['step'], { turns: number; notice: number; say: string }> = {
	talk: {
		turns: 40,
		notice: 6,
		say: 'for this question. Stop reading and reply now with what you have, and say what you did not get to read.',
	},
	risks: {
		turns: 10,
		notice: 3,
		say: 'for the second look. Call revise_risks now with what you have read.',
	},
}
// Above the diff tool's own limit, so a whole diff reaches the model uncut.
const MAX_TOOL_RESULT_CHARS = 64_000

// reader is the reader's understanding map, their notes and how much text they chose to read. A chat run by a script,
// such as "ken ask --json", has no reader, so it has none of them, and no tool to keep a note with.
// env decides which saved sessions the agent may read (see projectSessions) and which values secretHider hides.
// snapshots is ken's store of snapshots of uncommitted work (see the live module), which the agent's tools and the
// quote check read as well as the project's own git. thread false keeps no thread: ken's own runs in the background
// answer no one, so none of them starts with excerpts of the one before.
export async function startChat(options: {
	directory: string
	model: ModelConfig
	env: Record<string, string | undefined>
	reader?: {
		map: UnderstandingMap
		notes: ReaderNotes
		prefs: ReaderPrefs
		readSaved?: () => Promise<SavedAnswer[]>
		memory?: Memory
	}
	snapshots?: string
	thread?: boolean
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
	const withTurnsLeft = (tool: Tool, run: Run): Tool => ({
		...tool,
		async execute(args, ctx) {
			const result = await tool.execute(args, ctx)
			const step = STEPS[run.round.step]
			// This call's own turn has not ended yet, so it is not left.
			const left = step.turns - run.turnsEnded - 1
			if (left > step.notice) return result
			const notice = `${left} ${left === 1 ? 'turn' : 'turns'} left ${step.say}`
			return { ...result, content: [...result.content, { type: 'text', text: notice }] }
		},
	})
	// A question reads the names used elsewhere and the later commits on the same files once per range, at the first log
	// or diff of it. A note does without, and so does the second look, which has both in its question.
	const elsewhereIn =
		(run: Run): Elsewhere =>
		async (range, signal) => {
			const { round, shown } = run
			const key = `${range.base}..${range.head}`
			if (!round.asked || round.step === 'risks' || shown.has(key)) return null
			shown.add(key)
			const [found, later] = await Promise.all([usedElsewhere(repo, range, signal), laterCommits(repo, range, signal)])
			const parts = [found.kind === 'ok' ? elsewhereText(found.used) : '', laterText(later, range.head).join('\n')]
			const text = parts.filter((part) => part !== '').join('\n\n')
			return text === '' ? null : text
		}
	const { reader } = options
	const gate = { sources: { repo, sessions }, store, project, map: reader?.map ?? null }
	const { model, baseUrl, apiKeyEnv } = options.model
	const thread = threadMemory(reader?.readSaved)
	// A question's own session: a lens's tools and prompt, or every tool and the whole prompt.
	const open = (as: Asking, run: Run) => {
		const lens = lensOf(as)
		const elsewhere = elsewhereIn(run)
		const round = () => run.round
		const shorten = shortenIn(run)
		const reads = explorationTools(repo, elsewhere, () => run.round.read)
		const shared = forRecord(as)
		const asked = shared ? null : { map: reader?.map, chat: thread }
		const memory = memoryTools({ store, repo, memory: reader?.memory, asked })
		const remember = reader ? [rememberTool(reader.notes, round)] : []
		const tools = lens
			? [
					...[...reads, ...memory, ...remember].filter((tool) => lens.tools.includes(tool.name)),
					showTool(gate, round, { fields: lens.show, shorten }),
				]
			: [
					...reads,
					diffTool(repo, elsewhere),
					...memory,
					// The saved sessions are what the reader typed to their coding tool.
					...(shared ? [] : sessionTools(sessions)),
					...remember,
					showTool(gate, round, { shorten }),
					reviseTool(gate, round),
				]
		return createSession({
			model: { kind: 'openai-compatible', baseUrl, id: model, apiKeyEnv },
			plugins: [
				{
					name: PLUGIN,
					description: "Reads the project's files, git history and saved sessions, and checks cards against them.",
					tools: tools.map((tool) => withTurnsLeft(tool, run)),
				},
			],
			enabled: [PLUGIN],
			toolMode: 'native',
			maxTurns: STEPS.talk.turns,
			maxToolResultChars: MAX_TOOL_RESULT_CHARS,
			systemPrompt: lens?.systemPrompt ?? SYSTEM_PROMPT,
		})
	}
	// A question counts what its small requests to shorten a line cost.
	const shortenIn =
		(run: Run): Shorten =>
		async (lines, signal) => {
			const helper = await createSession({
				model: { kind: 'openai-compatible', baseUrl, id: model, apiKeyEnv },
				plugins: [],
				toolMode: 'native',
				maxTurns: 1,
				systemPrompt: SHORTEN_PROMPT,
			})
			const off = helper.subscribe((event) => {
				if (event.type === 'record' && event.record.kind === 'usage') {
					const { input, output, cacheRead, cacheWrite } = event.record
					run.charge({ input: input + cacheRead + cacheWrite, output })
				}
			})
			try {
				const result = await helper.prompt(shortenQuestion(lines), { signal })
				// One turn is all it has, so a reply ends the run at its turn limit.
				return 'text' in result ? shortened(result.text, lines.length) : lines.map(() => null)
			} catch {
				return lines.map(() => null)
			} finally {
				off()
				await helper.close()
			}
		}

	// Open once at startup so a bad model setting still fails before the first question.
	const asked = { kind: 'question' } as const
	await (
		await open(
			asked,
			freshRun(asked, () => {}),
		)
	).close()
	let closed = false
	async function* ask(
		question: string,
		signal?: AbortSignal,
		as: Asking = { kind: 'question' },
	): AsyncGenerator<ChatEvent> {
		if (closed) {
			yield { kind: 'error', message: 'This chat has closed.' }
			return
		}
		const events = eventQueue()
		const run = freshRun(as, events.push)
		const opening = open(as, run)
		try {
			yield* askIn(await opening, question, signal, as, run, events)
		} finally {
			await opening.then((session) => session.close())
		}
	}

	async function* askIn(
		session: Session,
		question: string,
		signal: AbortSignal | undefined,
		as: Asking,
		run: Run,
		events: ReturnType<typeof eventQueue>,
	): AsyncGenerator<ChatEvent> {
		const current = run.round
		// The second look has its own stop, so ending it at its turn limit does not end the question.
		const stops: Record<Round['step'], AbortController> = { talk: new AbortController(), risks: new AbortController() }
		const tokens = { input: 0, output: 0 }
		run.charge = (usage) => {
			tokens.input += usage.input
			tokens.output += usage.output
		}
		const readPaths = new Set<string>()
		const file = (cards: Round['pending']) => {
			for (const event of fileTurn({ text: '', calls: [] }, cards)) {
				if (event.kind === 'item') current.items.push(event.item)
				events.push(event)
			}
		}
		// A turn that shows cards again after ken sent one back mostly says so: "sending it again without them". Its words
		// wait. A later turn that writes words makes them a step; else they are the reply's, before that turn's cards.
		let sentBackBefore = 0
		let endedOnShow = false
		let remembered = false
		let retry: { text: string; at: number } | null = null
		const settleRetry = (as: 'step' | 'reply') => {
			if (!retry) return
			const { text, at } = retry
			retry = null
			if (as === 'step') return events.push({ kind: 'step', step: { kind: 'text', text } })
			const words: Item = { kind: 'words', text }
			current.items.splice(at, 0, words)
			events.push({ kind: 'item', item: words })
		}
		const unsubscribe = session.subscribe((event) => {
			if (event.type === 'text') events.push({ kind: 'text', delta: event.delta })
			if (event.type === 'tool_start') {
				const name = event.call.name.replace(`${PLUGIN}__`, '')
				events.push({ kind: 'tool', name, step: describeCall(name, event.call.args) })
			}
			// revise_risks has told the model it is out of attempts. Stopping here keeps a model that ignores that from
			// spending more turns.
			if (event.type === 'tool_end' && current.step === 'risks' && current.passRejections >= MAX_PASS_REJECTIONS) {
				stops.risks.abort()
			}
			if (event.type === 'turn_end') {
				run.turnsEnded += 1
				const { calls } = event.turn
				for (const { call, outcome } of calls) {
					if (
						call.tool === 'read_file' &&
						outcome.kind === 'ran' &&
						!outcome.result.isError &&
						typeof call.args.path === 'string'
					) {
						readPaths.add(call.args.path)
					}
				}
				if (calls.some(({ call }) => call.tool === 'remember')) remembered = true
				const text = event.turn.text.trim()
				const showOnly = calls.length > 0 && calls.every(({ call }) => call.tool === 'show')
				const writes = text !== '' && calls.every(({ call }) => call.tool === 'show')
				if (writes) settleRetry('step')
				const again = showOnly && writes && sentBackBefore > 0 && current.step === 'talk'
				if (again) retry = { text, at: current.items.length }
				for (const filed of fileTurn(again ? { text: '', calls } : event.turn, current.pending.splice(0))) {
					if (filed.kind === 'item') current.items.push(filed.item)
					events.push(filed)
				}
				const passed = current.sentBack === sentBackBefore && calls.every(({ outcome }) => accepted(outcome))
				sentBackBefore = current.sentBack
				// A brief's question says to write nothing after the briefs, so once each has passed, the turn that would
				// only close the run is not asked for. aigent ends a run at a stop that comes as its turn ends. A question in
				// the reader's own words may still keep a note in that turn.
				const noteLeft = current.typed && !remembered
				if (showOnly && passed && current.step === 'talk' && briefsDone(current) && !noteLeft) {
					endedOnShow = true
					stops.talk.abort()
				}
				// aigent stops the first step at its turns; the second look has fewer, so ken stops it.
				if (current.step === 'risks' && run.turnsEnded >= STEPS.risks.turns) stops.risks.abort()
			}
			if (event.type === 'record' && event.record.kind === 'usage') {
				tokens.input += event.record.input + event.record.cacheRead + event.record.cacheWrite
				tokens.output += event.record.output
			}
		})
		const started = performance.now()
		const prompt = async (text: string, own: AbortController): Promise<RunResult> =>
			await session
				.prompt(text, { signal: signal ? AbortSignal.any([signal, own.signal]) : own.signal })
				.catch((error: unknown): RunResult => ({ stop: 'error', message: String(error), turns: 0 }))
		const talk = async () => {
			if (as.kind === 'change') events.push(await changeNamed(repo, as.range, signal))
			const lens = lensOf(as)
			const shared = forRecord(as)
			const followUp = !shared && (lens ? lens.followUp : as.kind !== 'note')
			// A lens ken wrote for the record holds what ken knows of the level in its question.
			const opening = lens && shared ? '' : await chatOpening(question, as, shared, signal)
			const earlier = followUp ? thread.recent() : ''
			const facts = lens ? await briefFacts(as, signal) : ''
			const ran = await prompt(`${opening}${earlier}The question: ${question}${facts}`, stops.talk)
			const result: RunResult =
				endedOnShow && ran.stop === 'aborted' ? { stop: 'done', text: '', turns: ran.turns } : ran
			settleRetry('reply')
			let secondLook: Cost | null = null
			const { scope } = current
			// A model that failed while it talked would fail the second look too, so the risks it sent stand.
			if (scope && current.held.length > 0 && result.stop !== 'error' && !signal?.aborted) {
				const before = { ...tokens, at: performance.now() }
				const quotes = quotesOf([...current.items, ...current.held.map(riskItem)])
				const used = await usedElsewhere(repo, scope.range, signal)
				const followed = used.kind === 'ok' ? await followedNames(repo, used.used, quotes, signal) : null
				const decisions = current.items.flatMap((item) =>
					item.kind === 'card' && item.card.kind === 'decision' ? [item.card.decision] : [],
				)
				const held = {
					head: scope.range.head,
					risks: current.held,
					decisions,
					notFollowed: followed?.notFollowed ?? [],
				}
				const later = await laterCommits(repo, scope.range, signal)
				current.step = 'risks'
				run.turnsEnded = 0
				await prompt(riskPassQuestion(held, later), stops.risks)
				secondLook = costSince(before, tokens)
			}
			// Cards of a turn that never ended, and risks the second look did not settle, show as ken first checked them.
			const unreviewed = current.held.splice(0).map((risk) => riskItem({ ...risk, unreviewed: true }))
			file([...current.pending.splice(0), ...unreviewed])
			if (current.items.length > 0 && !signal?.aborted) {
				// Past this check the reply is whole, so a stop that comes while it is saved does not lose it.
				const ended = await endReply(gate, current, new AbortController().signal)
				if (ended.problems.length > 0) {
					const what = 'The project record'
					events.push({ kind: 'step', step: { kind: 'sent-back', what, problems: ended.problems } })
				}
				if (as.kind !== 'note' && options.thread !== false) {
					thread.keep(as.kind === 'answer' || as.kind === 'view' ? as.text : question, ended.reply, readPaths)
				}
				events.push({ kind: 'replied', reply: ended.reply, recorded: ended.recorded })
			}
			const seconds = Math.round((performance.now() - started) / 100) / 10
			events.push({ kind: 'usage', inputTokens: tokens.input, outputTokens: tokens.output, seconds, secondLook })
			events.push(endOf(result, current))
		}
		// Git and the record can fail, and the stop can land in a git call, so every way out of talk ends the question.
		const talking = talk()
			.catch((error: unknown) => {
				const message = signal?.aborted ? STOPPED : error instanceof Error ? error.message : String(error)
				events.push({ kind: 'error', message })
			})
			.finally(() => events.close())
		try {
			yield* events.drain()
		} finally {
			unsubscribe()
			for (const each of Object.values(stops)) each.abort()
			await talking
		}
	}

	// A question in the reader's words starts with the records that match it and the reader's map of their topics. A
	// run for the record starts with the record alone.
	async function chatOpening(question: string, as: Asking, shared: boolean, signal?: AbortSignal): Promise<string> {
		const record = await store.read()
		const index = await recordIndex(record, question, as, repo, signal)
		if (!reader || shared) return `${index.text}\n\n`
		const [map, notes, prefs] = await Promise.all([
			reader.map.read(new Date(), signal, { record, names: index.topics }),
			reader.notes.read(),
			reader.prefs.read(),
		])
		return `${index.text}\n\n${readerIndex(map, notes, prefs)}\n\n`
	}

	// A brief's question ends with what plain code knows of its files and the most it may read.
	async function briefFacts(as: Asking, signal?: AbortSignal): Promise<string> {
		const parts = briefParts(as)
		const most = readLimit(as)
		const head = await repo.resolve('HEAD', signal)
		if (parts.length === 0 || head.kind !== 'ok') return ''
		const facts = await plainFacts(repo, head.commit, parts, signal)
		const limit =
			most === null
				? ''
				: `\n\nRead at most ${most} lines of files in all for this question: read_file stops there. Read the ranges where the work happens, not whole files.`
		return `\n\n${facts}${limit}`
	}

	async function close() {
		closed = true
	}
	return { kind: 'ok', chat: { root: found.root, thread: randomUUID(), ask, close } }
}

// What one question keeps while it runs: its round, the turns it has had in this step, the changes whose names used
// elsewhere it was already told, and where the small requests to shorten a line add their cost.
type Run = {
	round: Round
	turnsEnded: number
	shown: Set<string>
	charge: (usage: { input: number; output: number }) => void
}

function freshRun(as: Asking, emit: Round['emit']): Run {
	const round = freshRound(as, emit)
	const most = readLimit(as)
	round.read = most === null ? null : { used: 0, most }
	return { round, turnsEnded: 0, shown: new Set(), charge: () => {} }
}

function accepted(outcome: ToolOutcome): boolean {
	return outcome.kind === 'ran' && !outcome.result.isError
}

// Every brief the question asks for has been shown: one for each part of a tour, or the one that answers a question.
function briefsDone(round: Round): boolean {
	const wanted = round.tour ? round.tour.stops.length : round.answers ? 1 : 0
	if (wanted === 0) return false
	const shown = new Set(round.items.flatMap((item) => (item.kind === 'step' ? [item.number] : [])))
	return Array.from({ length: wanted }, (_, at) => at + 1).every((number) => shown.has(number))
}

function riskItem(risk: Round['held'][number]): Extract<Item, { kind: 'card' }> {
	return { kind: 'card', card: { kind: 'risk', risk } }
}

function costSince(
	before: { input: number; output: number; at: number },
	tokens: { input: number; output: number },
): Cost {
	const seconds = Math.round((performance.now() - before.at) / 100) / 10
	return { inputTokens: tokens.input - before.input, outputTokens: tokens.output - before.output, seconds }
}

const STOPPED = 'The question was stopped before it had a reply.'

function endOf(result: RunResult, round: Round): ChatEvent {
	if (result.stop === 'aborted') return { kind: 'error', message: STOPPED }
	if (round.items.length > 0) return { kind: 'done', outcome: 'answered' }
	if (result.stop === 'error') return { kind: 'error', message: modelError(result.message), model: true }
	return { kind: 'done', outcome: result.stop === 'max_turns' ? 'out-of-turns' : 'no-answer' }
}

// aigent says "429: {...}" for a request the endpoint refused, and the error itself for one that never reached it.
function modelError(message: string): string {
	const status = Number(/^(\d{3}):/.exec(message)?.[1])
	if (status === 429 || status === 503) return `The model endpoint is busy: ${status}.`
	if (status >= 400) return `The model endpoint failed the request: ${status}.`
	return `ken could not reach the model: ${message}`
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
