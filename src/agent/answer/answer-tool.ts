// The one way an answer reaches the reader. The model sends it here, checkAnswer decides, and the result tells the
// model what to fix. A question allows MAX_REJECTIONS rejected answers, so a model that cannot quote stops there
// instead of trying forever. A problem of form, which the model fixes without reading code again, comes back first and
// does not use an attempt. An answer about a change that the reader asked for is made from the model's draft (see
// from-draft.ts), so one sent before it goes back, and it is held once it passes, for the risk pass (see
// risk-pass.ts); accept writes and shows an answer, the held one or the one the risk pass revised.
import type { JsonObject, JsonValue, Tool } from 'aigent/plugin'
import { decisionLabel, type Label, type Quote, type QuoteSources } from '../../checks/index.ts'
import { CARDINALITIES, DIAGRAM_BOUNDS, DIAGRAM_KINDS, type DiagramDraft } from '../../diagram/index.ts'
import type { UnderstandingMap } from '../../map/index.ts'
import { type RecordEntry, type RecordStore, sameName, UNDO } from '../../record/index.ts'
import { type Repository, resolveRange } from '../../repo/index.ts'
import type { ChatEvent, Revision } from '../chat-event.ts'
import { hunkHeader } from '../tools/diff-tool.ts'
import { readArgs, refuse, reply } from '../tools/tool-edge.ts'
import { type Answer, type Claim, WEIGHTS } from './answer.ts'
import { type AnswerDraft, type CheckedDecision, checkAnswer } from './check-answer.ts'
import { allowJsonText, readJsonText } from './json-text.ts'
import { type RecordArgs, type Recorded, recordAnswer } from './record-answer.ts'

export const MAX_REJECTIONS = 3
const MAX_LISTED_HUNKS = 40
const MAX_LISTED_MESSAGES = 40
// Two short sentences. A longer summary pushes the checked part of the answer off the reader's first screen.
export const MAX_SUMMARY_CHARS = 280
// The story that leads an answer about a change: three to five short sentences.
export const MAX_STORY_CHARS = 700

// What one question has seen of the answer tool. The session makes a new one for each question. asked is false for a
// note ken wrote by itself in live mode: the reader did not ask it, so it tells their map nothing, and it gets neither
// the list of names used elsewhere, nor the draft, nor the risk pass, which a note's own rules leave out. held is the
// answer that passed every check while ken runs the risk pass, with the arguments it came in and the revisions the
// pass had refused. step is the step of the question the model is in (see STEPS in start-chat.ts).
export type AnswerRound = {
	rejections: number
	answer: Answer | null
	asked: boolean
	held: Held | null
	step: Step
	emit: (event: ChatEvent) => void
}
export type Step = 'draft' | 'answer' | 'risks'
export type Held = { args: JsonObject; answer: Answer; decisions: CheckedDecision[]; rejections: number }

// What the answer tool checks against and writes to. map is the reader's understanding map: an accepted answer marks
// the topics it names as met there. project reads the project's own git, without ken's snapshots, for the draft rule
// in recordAnswer.
export type Gate = {
	sources: QuoteSources
	store: RecordStore
	project: Repository
	map: UnderstandingMap | null
}

export function answerTool(gate: Gate, round: () => AnswerRound): Tool {
	return {
		name: 'answer',
		description:
			'Send your answer to the reader. ken checks every quote against git and rejects the whole answer if one quote is not in its file at its commit. ken draws the diagrams you send. It stores the piece of work, its diagrams, the decisions and the topics you send in the project record. Call it once, when you have read the code the answer rests on.',
		parameters: PARAMETERS,
		async execute(args, ctx) {
			const current = round()
			if (current.answer) {
				return reply('An answer is already accepted for this question. Write your one or two closing sentences now.')
			}
			if (current.held) {
				return refuse('ken has checked your answer and holds it. Answer the questions about risks with revise_answer.')
			}
			if (current.rejections >= MAX_REJECTIONS) return refuse('No attempts are left for this question. Stop now.')
			const form = formProblems(args)
			if (form.length > 0) return sentBack(form)
			const holds = current.asked && args.scope !== undefined
			if (holds && current.step === 'draft' && !(await explained(gate, args, ctx.signal))) {
				return sentBack([
					'ken takes an answer about a change only once you have written your draft. Write the draft now, as plain text for the owner, and end your turn. ken then asks you for the answer.',
				])
			}
			const settled = await settle(gate, args, ctx.signal, !holds)
			if (settled.kind === 'form') return sentBack(settled.problems)
			if (settled.kind === 'accepted') {
				const { recorded } = settled
				// A piece of work the record already holds keeps its risks, so a second look could change nothing it stores.
				if (holds && !(recorded.kind === 'checked' && recorded.kept !== null)) {
					current.held = { args: settled.args, answer: settled.answer, decisions: settled.decisions, rejections: 0 }
					const next =
						'The reader has not seen it yet. ken will now ask you a few questions about risks. Write nothing more in this turn.'
					return reply(confirmation(settled.answer, settled.decisions, recorded, next))
				}
				if (!holds) return reply(await shown(gate, current, settled, null, ctx.signal))
				const accepted = await accept(gate, current, settled.args, null, ctx.signal)
				if (accepted.kind === 'accepted') return reply(accepted.reply)
				return refuse(accepted.problems.join('\n'))
			}
			current.rejections += 1
			current.emit({ kind: 'rejected', attempt: current.rejections, problems: settled.problems })
			return refuse(rejection(settled.problems, current.rejections))
		},
	}
}

type Settled = Awaited<ReturnType<typeof settle>>
type Accepted = Extract<Settled, { kind: 'accepted' }>

// Writes an answer to the record, marks its topics on the reader's map and shows it to the reader. The arguments are
// checked again in full first, so what is written is exactly what passed.
export async function accept(
	gate: Gate,
	current: AnswerRound,
	args: JsonObject,
	revision: Revision | null,
	signal: AbortSignal,
): Promise<{ kind: 'accepted'; reply: string } | { kind: 'rejected' | 'form'; problems: string[] }> {
	const settled = await settle(gate, args, signal, true)
	if (settled.kind !== 'accepted') return settled
	return { kind: 'accepted', reply: await shown(gate, current, settled, revision, signal) }
}

async function shown(
	gate: Gate,
	current: AnswerRound,
	settled: Accepted,
	revision: Revision | null,
	signal: AbortSignal,
): Promise<string> {
	if (current.asked) await gate.map?.learn('asked', settled.answer.topics, new Date(), signal)
	current.answer = settled.answer
	const { recorded } = settled
	const draft = recorded.kind === 'draft' ? recorded.decisions : null
	const entries = recorded.kind === 'recorded' ? recorded.entries : []
	current.emit({ kind: 'accepted', answer: settled.answer, recorded: entries, draft, revision })
	const next =
		'Now write one or two sentences to the reader that say what the answer left out. Say nothing else, and do not repeat the answer.'
	return confirmation(settled.answer, settled.decisions, recorded, next)
}

export function sentBack(problems: string[]) {
	const head = 'Answer sent back. This did not use one of your attempts. The reader saw nothing.'
	return refuse(
		[head, ...problems.map((problem) => `- ${problem}`), 'Fix this and send the whole answer again.'].join('\n'),
	)
}

function formProblems(args: JsonObject): string[] {
	const problems: string[] = []
	const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
	const [most, said] =
		args.scope === undefined
			? [MAX_SUMMARY_CHARS, 'one or two short sentences that restate the answer']
			: [MAX_STORY_CHARS, 'the story in three to five short sentences']
	if (summary.length > most) {
		problems.push(
			`The summary has ${summary.length} characters. Keep it to ${most}: ${said}. Put the detail in statements, decisions and risks.`,
		)
	}
	if (args.scope !== undefined && args.risks === undefined) {
		problems.push(
			'An answer about a change needs risks: each thing that could go wrong or that the owner should watch, with the lines it starts from. If you looked and found none, send risks as an empty list.',
		)
	}
	return problems
}

// The record already holds a piece of work for the answer's range, so the answer is sent again from the record and
// needs no draft.
async function explained(gate: Gate, raw: JsonObject, signal: AbortSignal): Promise<boolean> {
	const read = readJsonText(ANSWER_SCHEMA, raw)
	if (read.kind === 'refused' || read.args.scope === undefined) return false
	const scope = readArgs(objectOf(read.args.scope), 'answer scope')
	const range = await resolveRange(gate.sources.repo, { base: scope.text('base'), head: scope.text('head') }, signal)
	if (range.kind !== 'ok') return false
	const { base, head } = range.range
	return (await gate.store.read()).current.some(
		(entry) => entry.kind === 'work' && entry.range.base === base && entry.range.head === head,
	)
}

// args comes back as ken read it, with any list sent as JSON text parsed, so the risk pass can add to it.
async function settle(
	gate: Gate,
	raw: JsonObject,
	signal: AbortSignal,
	write: boolean,
): Promise<
	| {
			kind: 'accepted'
			answer: Answer
			decisions: CheckedDecision[]
			recorded: Exclude<Recorded, { kind: 'refused' }>
			args: JsonObject
	  }
	| { kind: 'rejected' | 'form'; problems: string[] }
> {
	const { sources, store, project } = gate
	const read = readJsonText(ANSWER_SCHEMA, raw)
	if (read.kind === 'refused') return { kind: 'rejected', problems: read.problems }
	const sourceProblems: string[] = []
	const quote = (each: JsonObject) => quoteOf(each, sourceProblems)
	const draft = draftOf(read.args, quote)
	const args = recordArgsOf(read.args, quote)
	if (sourceProblems.length > 0) return { kind: 'form', problems: sourceProblems }
	const named = [...draft.statements, ...(draft.risks ?? []), ...draft.decisions].flatMap((each) => each.topic ?? [])
	const known = [...(await topicNames(store)), ...args.topics.map((topic) => topic.name)]
	const unknown = [...new Set(named.filter((name) => !known.some((other) => sameName(other, name))))]
	if (unknown.length > 0) {
		const problems = unknown.map(
			(name) =>
				`An entry names the topic "${name}", which is neither in the record nor in this answer's topics. Add it to topics with its quotes and note, use the name the index gives, or leave topic out.`,
		)
		return { kind: 'form', problems }
	}
	const check = await checkAnswer(sources, draft, signal)
	if (check.kind === 'rejected') return check
	const recorded = await recordAnswer(store, project, check.answer, check.decisions, args, signal, write)
	if (recorded.kind === 'refused') return { kind: 'rejected', problems: recorded.problems }
	// Every topic is in the record now, so each name becomes the record's own spelling of it.
	const names = await topicNames(store)
	const canonical = (name: string) => names.find((other) => sameName(other, name)) ?? name
	const claims = <T extends Claim>(list: T[]) =>
		list.map((claim) => (claim.topic === undefined ? claim : { ...claim, topic: canonical(claim.topic) }))
	const topics = [...new Set([...args.topics.map((topic) => topic.name), ...named].map(canonical))]
	const leftOut = read.args.left_out
	const answer: Answer = {
		...check.answer,
		statements: claims(check.answer.statements),
		risks: check.answer.risks && claims(check.answer.risks),
		topics,
		...(Array.isArray(leftOut) ? { leftOut: leftOut.length } : {}),
	}
	return { kind: 'accepted', answer, decisions: check.decisions, recorded, args: read.args }
}

// The risk pass's additions on their own, numbered as the agent sent them, through the same checks as an answer.
export async function checkAdditions(
	sources: QuoteSources,
	raw: { risks: JsonObject[]; decisions: JsonObject[] },
	signal: AbortSignal,
): Promise<{ kind: 'ok' } | { kind: 'rejected' | 'form'; problems: string[] }> {
	const problems: string[] = []
	const quote = (each: JsonObject) => quoteOf(each, problems)
	const risks = raw.risks.map((each) => claimOf(each, 'answer risk', quote))
	const decisions = raw.decisions.map((each) => decisionOf(each, quote))
	if (problems.length > 0) return { kind: 'form', problems }
	const draft = { summary: '', scope: null, statements: [], risks, decisions, diagrams: [] }
	const check = await checkAnswer(sources, draft, signal)
	return check.kind === 'rejected' ? check : { kind: 'ok' }
}

async function topicNames(store: RecordStore): Promise<string[]> {
	return (await store.read()).current.flatMap((entry) => (entry.kind === 'topic' ? [entry.name] : []))
}

function confirmation(
	answer: Answer,
	decisions: CheckedDecision[],
	recorded: Exclude<Recorded, { kind: 'refused' }>,
	next: string,
): string {
	const claims = [...answer.statements, ...(answer.risks ?? [])]
	const quotes = claims.reduce((sum, claim) => sum + claim.quotes.length, 0)
	const risks = answer.risks === null ? '' : `${answer.risks.length} risks, `
	const labels = decisions.map((decision) => decisionLabel(decision.reason.quotes, false))
	const labelled = (label: Label) => labels.filter((each) => each === label).length
	const counts = `${labelled('recorded')} recorded, ${labelled('from-the-session')} from the session, ${labelled('inferred')} inferred`
	const lines = [
		`Answer accepted: ${answer.statements.length} statements, ${risks}${decisions.length} decisions (${counts}), ${answer.diagrams.length} diagrams, ${quotes} quotes in the statements and risks. ken shows it to the reader.`,
	]
	if (recorded.kind === 'draft') {
		lines.push(
			"The answer cites ken's snapshot of uncommitted work, which the project's history does not have, so ken keeps it for this reader only and added nothing to the project record.",
		)
	}
	if (recorded.kind === 'recorded' && recorded.kept) {
		lines.push(`Piece of work ${recorded.kept} already explains this range, so ken kept it and wrote no new one.`)
	}
	if (recorded.kind === 'recorded' && recorded.entries.length > 0) {
		lines.push(`Added to the project record: ${recorded.entries.map(named).join(', ')}.`)
	}
	if (answer.change) {
		const { covered, uncovered, binary } = answer.change
		lines.push(`Your quotes cover ${covered.length} of ${covered.length + uncovered.length} changed hunks.`)
		if (uncovered.length > 0) {
			const listed = uncovered.slice(0, MAX_LISTED_HUNKS).map(({ path, hunk }) => `- ${path} ${hunkHeader(hunk)}`)
			const more = uncovered.length > listed.length ? [`- and ${uncovered.length - listed.length} more`] : []
			lines.push('Not covered:', ...listed, ...more)
		}
		if (binary.length > 0) lines.push(`Binary files, which no quote can cover: ${binary.join(', ')}.`)
		const { messages, commits } = answer.change
		if (messages) {
			const total = messages.quoted.length + messages.unquoted.length
			lines.push(`Your quotes cite ${messages.quoted.length} of ${total} commit messages.`)
			const subjects = new Map(commits.map((commit) => [commit.hash, commit.subject]))
			const listed = messages.unquoted
				.slice(0, MAX_LISTED_MESSAGES)
				.map((hash) => `- ${hash.slice(0, 7)} ${subjects.get(hash) ?? ''}`)
			if (listed.length > 0) lines.push('Commit messages no quote cites:', ...listed)
		}
		const { usedElsewhere } = answer.change
		if (usedElsewhere && usedElsewhere.notFollowed.length > 0) {
			const total = usedElsewhere.followed.length + usedElsewhere.notFollowed.length
			const names = usedElsewhere.notFollowed.map((name) => name.name).join(', ')
			lines.push(`Of ${total} names used elsewhere, no quote holds a place of ${names}.`)
		}
	}
	lines.push(next)
	return lines.join('\n')
}

function named(entry: RecordEntry): string {
	return `${entry.kind} ${entry.id}`
}

function rejection(problems: string[], attempt: number): string {
	const head = `Answer rejected, attempt ${attempt} of ${MAX_REJECTIONS}. The reader saw nothing.`
	const tail =
		attempt >= MAX_REJECTIONS
			? 'That was the last attempt, so ken tells the reader it could not produce a checked answer. Stop now.'
			: 'Fix these and send the whole answer again. Copy each quote from read_file or diff output.'
	return [head, ...problems.map((problem) => `- ${problem}`), tail].join('\n')
}

type ReadQuote = (raw: JsonObject) => Quote

function draftOf(args: JsonObject, quoteOf: ReadQuote): AnswerDraft {
	const read = readArgs(args, 'answer')
	const scope = args.scope === undefined ? null : readArgs(objectOf(args.scope), 'answer scope')
	return {
		summary: read.text('summary'),
		scope: scope && { base: scope.text('base'), head: scope.text('head') },
		statements: listOf(args.statements).map((raw) => claimOf(raw, 'answer statement', quoteOf)),
		risks: args.risks === undefined ? null : listOf(args.risks).map((raw) => claimOf(raw, 'answer risk', quoteOf)),
		decisions: optionalList(args.decisions).map((raw) => decisionOf(raw, quoteOf)),
		diagrams: optionalList(args.diagrams).map((raw) => diagramDraftOf(raw, quoteOf)),
	}
}

function decisionOf(raw: JsonObject, quoteOf: ReadQuote) {
	const decision = readArgs(raw, 'answer decision')
	const undo = UNDO.find((known) => known === decision.text('undo'))
	if (!undo) throw new Error('answer: undo is not in UNDO, so its schema and its reader disagree')
	return {
		question: decision.text('question'),
		chosen: decision.text('chosen'),
		reason: { text: decision.text('reason'), quotes: listOf(raw.reason_quotes).map(quoteOf) },
		rejected: listOf(raw.rejected).map((rawRejected) => {
			const rejected = readArgs(rawRejected, 'answer rejected option')
			return { option: rejected.text('option'), reason: rejected.text('reason') }
		}),
		undo,
		needsOwner: decision.flag('needs_owner'),
		quotes: listOf(raw.quotes).map(quoteOf),
		...topicOf(decision.optionalText('topic')),
	}
}

function topicOf(topic: string | undefined): { topic?: string } {
	return topic === undefined ? {} : { topic }
}

function claimOf(raw: JsonObject, what: string, quoteOf: ReadQuote) {
	const claim = readArgs(raw, what)
	const weight = WEIGHTS.find((known) => known === claim.optionalText('weight'))
	return {
		text: claim.text('text'),
		label: claim.text('label'),
		quotes: listOf(raw.quotes).map(quoteOf),
		...topicOf(claim.optionalText('topic')),
		...(weight === undefined ? {} : { weight }),
	}
}

function diagramDraftOf(raw: JsonObject, quoteOf: ReadQuote): DiagramDraft {
	const diagram = readArgs(raw, 'answer diagram')
	const kind = DIAGRAM_KINDS.find((known) => known === diagram.text('kind'))
	if (!kind) throw new Error('answer: a diagram kind is not in DIAGRAM_KINDS, so its schema and its reader disagree')
	const node = (each: JsonObject) => ({
		name: readArgs(each, 'answer diagram node').text('name'),
		quotes: optionalList(each.quotes).map(quoteOf),
	})
	const edge = (each: JsonObject) => {
		const read = readArgs(each, 'answer diagram edge')
		return {
			from: read.text('from'),
			to: read.text('to'),
			text: read.text('text'),
			label: read.optionalText('label'),
			quotes: optionalList(each.quotes).map(quoteOf),
		}
	}
	return {
		kind,
		title: diagram.text('title'),
		label: diagram.text('label'),
		boxes: optionalList(raw.boxes).map((each) => ({
			...node(each),
			group: readArgs(each, 'answer box').optionalText('group'),
		})),
		arrows: optionalList(raw.arrows).map(edge),
		participants: optionalList(raw.participants).map(node),
		messages: optionalList(raw.messages).map(edge),
		entities: optionalList(raw.entities).map((each) => ({
			...node(each),
			fields: optionalList(each.fields).map((rawField) => {
				const field = readArgs(rawField, 'answer field')
				return { name: field.text('name'), type: field.text('type') }
			}),
		})),
		relations: optionalList(raw.relations).map((each) => {
			const cardinality = CARDINALITIES.find((known) => known === readArgs(each, 'answer relation').text('cardinality'))
			if (!cardinality)
				throw new Error('answer: a cardinality is not in CARDINALITIES, so its schema and reader disagree')
			return { ...edge(each), cardinality }
		}),
	}
}

function recordArgsOf(args: JsonObject, quoteOf: ReadQuote): RecordArgs {
	const work = args.work === undefined ? null : { title: readArgs(objectOf(args.work), 'answer work').text('title') }
	return {
		work,
		topics: optionalList(args.topics).map((raw) => {
			const topic = readArgs(raw, 'answer topic')
			return {
				name: topic.text('name'),
				quotes: listOf(raw.quotes).map(quoteOf),
				note: topic.text('note'),
				replaces: topic.optionalText('replaces'),
			}
		}),
	}
}

// A quote names one source: a session, or a commit with a path for a file and none for the commit's message. A quote
// that names both, or neither, adds a problem, and the answer goes back before ken checks any quote.
function quoteOf(raw: JsonObject, problems: string[]): Quote {
	const quote = readArgs(raw, 'answer quote')
	const text = quote.text('text')
	const session = quote.optionalText('session')
	const commit = quote.optionalText('commit')
	const first = JSON.stringify(text.trim().split('\n')[0]?.slice(0, 60) ?? '')
	if (session !== undefined) {
		if (commit !== undefined || quote.optionalText('path') !== undefined) {
			problems.push(
				`The quote ${first} names a session and a commit. A quote has one source: leave out path and commit to quote a session.`,
			)
		}
		return { session, text }
	}
	if (commit === undefined) {
		problems.push(
			`The quote ${first} names no source. Give commit, and path for a file, or give session to quote a saved session.`,
		)
	}
	const line = quote.optionalLine('line')
	return {
		path: quote.optionalText('path') ?? null,
		commit: commit ?? '',
		text,
		...(line === undefined ? {} : { line }),
	}
}

export function optionalList(value: JsonValue | undefined): JsonObject[] {
	return value === undefined ? [] : listOf(value)
}

function listOf(value: JsonValue | undefined): JsonObject[] {
	if (!isList(value)) throw new Error('answer: a list argument is not a list, so its schema and reader disagree')
	return value.map(objectOf)
}

function objectOf(value: JsonValue | undefined): JsonObject {
	if (typeof value !== 'object' || value === null || isList(value)) {
		throw new Error('answer: an object argument is not an object, so its schema and reader disagree')
	}
	return value
}

// Array.isArray does not narrow a readonly array out of a union, so it gets this guard.
function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
	return Array.isArray(value)
}

// Every request sends the whole tool list again, and this schema is most of it. The quote, claim and edge shapes
// repeat, so each keeps its descriptions where the model first reads it and drops them in the copies after.
export function withoutDescriptions<T>(schema: T): T {
	return JSON.parse(JSON.stringify(schema, (key, value) => (key === 'description' ? undefined : value)))
}

const QUOTE_SCHEMA = {
	type: 'object',
	properties: {
		path: {
			type: 'string',
			description: "The path from the repository root. Leave it out to quote the commit's message instead.",
		},
		commit: { type: 'string', description: 'The commit you read the lines at, or whose message you quote' },
		session: {
			type: 'string',
			description: 'To quote a saved session instead: its id from list_sessions. Then leave out path and commit.',
		},
		text: {
			type: 'string',
			description:
				'The exact whole lines, copied from read_file, diff, log or read_session output, without line numbers or + and - signs',
		},
		line: { type: 'integer', minimum: 1, description: 'The number of the first quoted line of a file' },
	},
	required: ['text'],
	additionalProperties: false,
} as const
const QUOTE = withoutDescriptions(QUOTE_SCHEMA)

const TOPIC_NAME = {
	type: 'string',
	description:
		"The topic it belongs to, if any: a topic name from the record's index, or one this answer sends in topics",
} as const

export const CLAIM_SCHEMA = {
	type: 'object',
	properties: {
		text: { type: 'string', description: 'One idea in one or two short sentences, in plain words' },
		label: {
			type: 'string',
			description:
				'"inferred" for what you worked out from the code or the diff, every reason why included. "found-by-search" for a relation between pieces of code, such as "this calls that", that you found by searching and did not prove. "from-the-session" for what you read in a saved session and quote from it.',
		},
		quotes: { type: 'array', minItems: 1, items: QUOTE_SCHEMA },
		topic: TOPIC_NAME,
	},
	required: ['text', 'label', 'quotes'],
	additionalProperties: false,
} as const

const CLAIM = withoutDescriptions(CLAIM_SCHEMA)
export const RISK_SCHEMA = {
	...CLAIM,
	properties: {
		...CLAIM.properties,
		weight: {
			type: 'string',
			enum: WEIGHTS,
			description: '"serious" when someone is hurt in normal use, "minor" otherwise',
		},
	},
	required: [...CLAIM.required, 'weight'],
} as const

export const DECISION_SCHEMA = {
	type: 'object',
	properties: {
		question: {
			type: 'string',
			description: 'The question the decision answers, such as "How long does a retry wait?"',
		},
		chosen: { type: 'string', description: 'The option the code took' },
		reason: { type: 'string', description: 'Why this option was chosen, in one or two short sentences' },
		reason_quotes: {
			type: 'array',
			description:
				'Only lines that say why the option was chosen: lines of a commit message, a comment, a doc or a saved session that state the reason, not lines that say what was done. An empty list when nothing you read says why. ken labels a decision whose reason quotes the body of a commit message "recorded", one whose reason quotes a session "from-the-session", and any other "inferred".',
			items: QUOTE,
		},
		rejected: {
			type: 'array',
			description:
				'Options the code or the history shows were tried or weighed: a reverted commit, a comment, a commit message. Leave it empty when there is no such sign. Never invent one.',
			items: {
				type: 'object',
				properties: {
					option: { type: 'string' },
					reason: { type: 'string', description: 'Why it was not chosen, as the code or the history shows it' },
				},
				required: ['option', 'reason'],
				additionalProperties: false,
			},
		},
		undo: { type: 'string', enum: UNDO, description: 'How much work it would take to choose differently later' },
		needs_owner: {
			type: 'boolean',
			description:
				'true when the owner should look at it: a choice a commit message leaves to the owner, a guess about intent, a risk, or a choice with a cost',
		},
		quotes: { type: 'array', minItems: 1, description: 'The lines that show what was chosen', items: QUOTE },
	},
	required: ['question', 'chosen', 'reason', 'reason_quotes', 'rejected', 'undo', 'needs_owner', 'quotes'],
	additionalProperties: false,
} as const

const TOPIC_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string', description: 'A short name for a part of the project, such as "retry logic"' },
		quotes: { type: 'array', minItems: 1, items: QUOTE },
		note: { type: 'string', description: 'A few sentences on how this part works, for the next question about it' },
		replaces: { type: 'string', description: 'The id of a topic in the record that this one updates' },
	},
	required: ['name', 'quotes', 'note'],
	additionalProperties: false,
} as const

const NAME = { type: 'string', description: 'A short name, unique in the diagram' } as const
const DEFINED_AT = {
	type: 'array',
	description: 'Optional: the lines where it is defined, such as its header or its declaration',
	items: QUOTE,
} as const
const EDGE_PROPERTIES = {
	from: { type: 'string', description: 'The name of the box, participant or entity it starts at' },
	to: { type: 'string', description: 'The name of the one it ends at' },
	text: {
		type: 'string',
		description:
			'A few words: a verb such as "calls", "reads" or "writes to" for an arrow, what is sent for a message, how the two relate for a relation',
	},
	label: {
		type: 'string',
		description:
			'Leave it out to use the diagram label. "found-by-search" when you found this by searching and did not prove it.',
	},
	quotes: {
		type: 'array',
		description: 'At least one: the lines that show the call, the message or the link',
		items: QUOTE,
	},
} as const
const EDGE_SCHEMA = {
	type: 'object',
	properties: EDGE_PROPERTIES,
	required: ['from', 'to', 'text', 'quotes'],
	additionalProperties: false,
} as const

const DIAGRAM_SCHEMA = {
	type: 'object',
	properties: {
		kind: {
			type: 'string',
			enum: DIAGRAM_KINDS,
			description:
				'"component": how parts fit together, with boxes and arrows. "sequence": what happens in order, with participants and messages. "entity-relationship": what data there is and how it relates, with entities and relations.',
		},
		title: { type: 'string', description: 'What the diagram shows, in a few words' },
		label: { type: 'string', description: 'The label for the diagram as a whole, chosen as for a statement' },
		boxes: {
			type: 'array',
			description: `A component diagram's parts, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: {
					name: NAME,
					group: { type: 'string', description: 'Optional: a name several boxes share, such as a layer' },
					quotes: DEFINED_AT,
				},
				required: ['name'],
				additionalProperties: false,
			},
		},
		arrows: {
			type: 'array',
			description: `A component diagram's arrows, at most ${DIAGRAM_BOUNDS.edges}`,
			items: EDGE_SCHEMA,
		},
		participants: {
			type: 'array',
			description: `A sequence diagram's participants, left to right, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: { name: NAME, quotes: DEFINED_AT },
				required: ['name'],
				additionalProperties: false,
			},
		},
		messages: {
			type: 'array',
			description: `A sequence diagram's messages, in the order they happen, at most ${DIAGRAM_BOUNDS.edges}`,
			items: withoutDescriptions(EDGE_SCHEMA),
		},
		entities: {
			type: 'array',
			description: `An entity-relationship diagram's entities, at most ${DIAGRAM_BOUNDS.nodes}`,
			items: {
				type: 'object',
				properties: {
					name: NAME,
					fields: {
						type: 'array',
						description: `The fields that matter, at most ${DIAGRAM_BOUNDS.fields}`,
						items: {
							type: 'object',
							properties: { name: { type: 'string' }, type: { type: 'string' } },
							required: ['name', 'type'],
							additionalProperties: false,
						},
					},
					quotes: DEFINED_AT,
				},
				required: ['name'],
				additionalProperties: false,
			},
		},
		relations: {
			type: 'array',
			description: `An entity-relationship diagram's relations, at most ${DIAGRAM_BOUNDS.edges}`,
			items: {
				type: 'object',
				properties: {
					...withoutDescriptions(EDGE_PROPERTIES),
					cardinality: {
						type: 'string',
						enum: CARDINALITIES,
						description: 'How many of the first entity relate to how many of the second',
					},
				},
				required: ['from', 'to', 'text', 'cardinality', 'quotes'],
				additionalProperties: false,
			},
		},
	},
	required: ['kind', 'title', 'label'],
	additionalProperties: false,
} as const

const ANSWER_SCHEMA = {
	type: 'object',
	properties: {
		work: {
			type: 'object',
			description:
				'Give it when the answer explains a piece of work, such as a task, a branch or a pull request. It needs scope, which is its range.',
			properties: { title: { type: 'string', description: 'A short name for the piece of work' } },
			required: ['title'],
			additionalProperties: false,
		},
		decisions: { type: 'array', description: 'The decisions the change made', items: DECISION_SCHEMA },
		topics: { type: 'array', description: 'Parts of the project the answer explains', items: TOPIC_SCHEMA },
		scope: {
			type: 'object',
			description: 'Give it when the question is about a change: the base and head commits of that change.',
			properties: { base: { type: 'string' }, head: { type: 'string' } },
			required: ['base', 'head'],
			additionalProperties: false,
		},
		diagrams: {
			type: 'array',
			description: `Basic diagrams that lead the answer, at most ${DIAGRAM_BOUNDS.diagrams}. ken draws them. An answer about a change that touches two or more parts sends one.`,
			items: DIAGRAM_SCHEMA,
		},
		summary: {
			type: 'string',
			description: `One or two short sentences, at most ${MAX_SUMMARY_CHARS} characters, that restate the answer from the top. For an answer about a change, the story of the change in three to five short sentences, at most ${MAX_STORY_CHARS} characters.`,
		},
		statements: {
			type: 'array',
			minItems: 1,
			description: 'Claims about the code, one idea each, the most important first',
			items: CLAIM_SCHEMA,
		},
		risks: {
			type: 'array',
			description:
				'Required when the answer has a scope. Each thing that could go wrong or that the owner should watch after the change, one per item, with the lines it starts from: often a caller or another user of a changed value outside the diff. An empty list says you looked and found none.',
			items: RISK_SCHEMA,
		},
		left_out: {
			type: 'array',
			description:
				'For an answer made from your draft: each point of the draft that you found no line to quote for and left out, in a few words. An empty list when every point has its lines.',
			items: { type: 'string' },
		},
	},
	required: ['summary', 'statements'],
	additionalProperties: false,
} as const

const PARAMETERS = allowJsonText(ANSWER_SCHEMA)
