import { when } from '../follow-up/index.ts'
import { findRoot } from '../repo/index.ts'
import { projectSessions, readSession, type Session, type TranscriptEntry } from '../transcripts/index.ts'

// "ken sessions" lists the sessions Claude Code saved for the project, and "ken sessions <id>" prints one, cut to a
// size a person can read. Neither needs a model. Exit code 0 means it printed, 1 means no such session, 2 means no
// repository or KEN_SESSIONS=off.
export async function printSessions(directory: string, id: string | undefined, json: boolean): Promise<number> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') {
		process.stderr.write(`${directory} is not inside a git repository.\n`)
		return 2
	}
	const transcripts = projectSessions(found.root, process.env)
	if (transcripts === null) {
		process.stderr.write('ken reads no saved sessions: KEN_SESSIONS is off.\n')
		return 2
	}
	const write = (value: unknown, lines: string[]) =>
		process.stdout.write(`${json ? JSON.stringify(value, null, 2) : lines.join('\n')}\n`)

	if (id === undefined) {
		const list = await transcripts.sessions()
		const none = `There are no ${transcripts.tool} sessions for ${found.root} in ${transcripts.where}.`
		const older = list.older > 0 ? [`and ${list.older} older sessions ken did not read.`] : []
		write(list, list.sessions.length === 0 ? [none] : [...list.sessions.map(sessionLine), ...older])
		return 0
	}
	const read = await readSession(transcripts, id)
	if (read === null) {
		process.stderr.write(`There is no ${transcripts.tool} session ${id} for ${found.root}. Run "ken sessions".\n`)
		return 1
	}
	const more = read.more > 0 ? [`and ${read.more} more entries, not shown.`] : []
	write(read, [sessionLine(read.session), ...read.entries.flatMap(entryLines), ...more])
	return 0
}

function sessionLine(session: Session): string {
	const ran =
		session.started === null ? 'no messages' : `${when(session.started)} to ${when(session.ended ?? session.started)}`
	const count = plural(session.messages, 'message')
	const skipped = session.skipped > 0 ? `, ${plural(session.skipped, 'line')} ken could not read` : ''
	const partial = session.partial ? ', only the start read: the file is too large' : ''
	return `${session.id}  ${ran}, ${count}${skipped}${partial}`
}

function entryLines(entry: TranscriptEntry): string[] {
	if (entry.kind === 'tool') {
		const more = entry.more > 0 ? [`      (${plural(entry.more, 'more line')})`] : []
		return [
			`  ran ${entry.name}${entry.target === null ? '' : `: ${entry.target}`}`,
			...entry.output.map((line) => `    | ${line}`),
			...more,
		]
	}
	const cut = entry.cut > 0 ? [`    (${plural(entry.cut, 'more character')})`] : []
	const text = entry.text.split('\n').map((line) => `    ${line}`)
	return [`#${entry.message} ${entry.kind}, ${when(entry.at)}`, ...text, ...cut]
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`
}
