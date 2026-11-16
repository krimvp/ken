// The tools the model reads saved sessions with: list them, read one in part, and search them. Results are short text
// that numbers each message and gives its time, so the model can match a session to the commits made while it ran
// and copy whole lines into a quote. Every text has passed the transcripts module's secretHider. With no sessions to
// read, because the owner set KEN_SESSIONS=off, each tool says so and the model goes on without them.
import type { Tool } from 'aigent/plugin'
import { type Session, searchSessions, type TranscriptEntry, type Transcripts } from '../../transcripts/index.ts'
import { readArgs, refuse, reply } from './tool-edge.ts'

// A read shows up to MAX_MESSAGES messages, starting CONTEXT messages before the one asked for, within MAX_CHARS. A
// message is cut to MAX_MESSAGE_CHARS, except the one asked for, which gets MAX_ASKED_CHARS.
const MAX_MESSAGES = 30
const CONTEXT = 3
const MAX_CHARS = 24_000
const MAX_MESSAGE_CHARS = 1500
const MAX_ASKED_CHARS = 12_000
const MAX_LISTED = 50

const OFF = reply(
	'ken reads no saved sessions for this project: the owner turned it off with KEN_SESSIONS=off. Answer from the code and the git history.',
)

export function sessionTools(sessions: Transcripts | null): Tool[] {
	return [
		{
			name: 'list_sessions',
			description: `List the sessions a coding agent saved while it worked on this project, newest first, at most ${MAX_LISTED}: each one's id, when it started and ended, and how many messages it holds. Compare the times with the commit dates in log to find the session that was running when a change was made.`,
			parameters: { type: 'object', properties: {}, additionalProperties: false },
			async execute(_args, ctx) {
				if (sessions === null) return OFF
				const list = await sessions.sessions(ctx.signal)
				if (list.sessions.length === 0) return reply(`There are no saved ${sessions.tool} sessions of this project.`)
				const shown = list.sessions.slice(0, MAX_LISTED)
				const left = list.sessions.length - shown.length + list.older
				const more = left > 0 ? [`and ${left} older sessions, not listed.`] : []
				const head = `${list.sessions.length} saved ${sessions.tool} sessions of this project, newest first, times in UTC:`
				return reply([head, ...shown.map(sessionLine), ...more].join('\n'))
			},
		},
		{
			name: 'read_session',
			description: `Read a saved session in order: what the user asked, what the agent said, and one line for each tool the agent ran. Each message starts with a line that gives its number, who wrote it and when; the lines after it are the message as written. Give message, from search_sessions, or at, a time such as a commit date, to read the part around it. Shows up to ${MAX_MESSAGES} messages per call.`,
			parameters: {
				type: 'object',
				properties: {
					session: { type: 'string', description: 'The id from list_sessions' },
					message: { type: 'integer', minimum: 1, description: 'Read around the message with this number' },
					at: { type: 'string', description: 'Read around the message nearest this time, such as 2026-11-15T21:40' },
				},
				required: ['session'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				if (sessions === null) return OFF
				const read = readArgs(args, 'read_session')
				const id = read.text('session')
				const whole = await sessions.session(id, ctx.signal)
				if (whole === null)
					return refuse(`There is no saved session "${id}" of this project. list_sessions lists them.`)
				const at = read.optionalText('at')
				const time =
					at === undefined ? null : Date.parse(at.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`)
				if (time !== null && Number.isNaN(time))
					return refuse(`"${at}" is not a time. Give one such as 2026-11-15T21:40.`)
				return reply(sessionPart(whole.session, whole.entries, read.optionalLine('message') ?? null, time))
			},
		},
		{
			name: 'search_sessions',
			description:
				'Find words in what the user and the agent wrote in the saved sessions, in any case. Tool output is not searched. Gives each line that holds them, with its session, message number, who wrote it and when.',
			parameters: {
				type: 'object',
				properties: { text: { type: 'string', description: 'The words to find, such as a function name' } },
				required: ['text'],
				additionalProperties: false,
			},
			async execute(args, ctx) {
				if (sessions === null) return OFF
				const text = readArgs(args, 'search_sessions').text('text')
				const { hits, more } = await searchSessions(sessions, text, ctx.signal)
				if (hits.length === 0) return reply(`No message in the saved sessions holds "${text}".`)
				const lines = hits.map((hit) => `${hit.session} #${hit.message} ${hit.kind}, ${time(hit.at)}: ${hit.line}`)
				const left = more > 0 ? [`and ${more} more lines, not shown. Search for more words to narrow it.`] : []
				return reply([`${hits.length} lines hold "${text}", times in UTC:`, ...lines, ...left].join('\n'))
			},
		},
	]
}

function sessionLine(session: Session): string {
	const when =
		session.started === null ? 'no messages' : `${time(session.started)} to ${time(session.ended ?? session.started)}`
	const partial = session.partial ? ', only its start read: the file is too large' : ''
	return `${session.id}  ${when}, ${session.messages} messages${partial}`
}

// The messages from a few before the one asked for: the message with that number, or the one nearest the time.
function sessionPart(session: Session, entries: TranscriptEntry[], message: number | null, at: number | null): string {
	const said = entries.flatMap((entry, index) => (entry.kind === 'tool' ? [] : [{ entry, index }]))
	const asked =
		message !== null
			? said.find(({ entry }) => entry.message >= message)
			: at !== null
				? said.reduce<(typeof said)[number] | undefined>(
						(best, each) =>
							best === undefined || Math.abs(Date.parse(each.entry.at) - at) < Math.abs(Date.parse(best.entry.at) - at)
								? each
								: best,
						undefined,
					)
				: undefined
	const from = asked === undefined ? 0 : (said[Math.max(0, said.indexOf(asked) - CONTEXT)]?.index ?? 0)
	const lines: string[] = []
	let chars = 0
	let shown = 0
	let next: number | null = null
	for (const entry of entries.slice(from)) {
		if (entry.kind === 'tool') {
			lines.push(`(the agent ran ${entry.name}${entry.target === null ? '' : ` on ${entry.target}`})`)
			continue
		}
		if (shown === MAX_MESSAGES || chars > MAX_CHARS) {
			next = entry.message
			break
		}
		const most = entry === asked?.entry ? MAX_ASKED_CHARS : MAX_MESSAGE_CHARS
		const text = entry.text.slice(0, most)
		const cut = entry.text.length - text.length
		lines.push(`#${entry.message} ${entry.kind}, ${time(entry.at)}:`, text)
		if (cut > 0) lines.push(`(${cut} more characters. read_session with message ${entry.message} shows more.)`)
		chars += text.length
		shown++
	}
	const end = next === null ? [] : [`More follows. read_session with message ${next} reads on.`]
	return [
		`Session ${session.id}: ${sessionLine(session).slice(session.id.length + 2)}. Times in UTC.`,
		...lines,
		...end,
	].join('\n')
}

function time(at: string): string {
	return at.slice(0, 16).replace('T', ' ')
}
