// The question ken asks itself in live mode, while a coding agent works in the project and the owner watches. A note is
// an ordinary reply in its own chat, with rules for this case on top of the system prompt: it says what is new since
// the last note and why in a few sentences, and leaves out what earlier notes said. It follows plain-words.
import type { About } from '../live/index.ts'

// earlier: the first words of the last notes, newest first. session: the id of the newest saved session, null when ken
// reads none. leftOut: files the snapshot left out because they were binary or too large.
export type NoteFacts = {
	earlier: { at: string; summary: string }[]
	session: string | null
	leftOut: number
}

export function noteQuestion(about: About, facts: NoteFacts): string {
	const short = (hash: string) => hash.slice(0, 7)
	const head = about.kind === 'commits' ? about.head : about.snapshot
	const what =
		about.kind === 'commits'
			? `What changed: the commits from ${short(about.base)} to ${short(about.head)}. Read them with log and diff over that range.`
			: [
					`What changed: work in the working tree that nobody has committed yet. ken copied it into commit ${short(about.snapshot)} in its own store, on top of HEAD ${short(about.head)}. The project's history does not have that commit, so this note stays with the owner and goes into no record.`,
					`Since the last note, the change runs from ${short(about.base)} to ${short(about.snapshot)}. Read it with diff over that range, and read_file at ${short(about.snapshot)}, as you would a commit.`,
					...(facts.leftOut > 0
						? [`ken left ${facts.leftOut} files out of the snapshot because they were binary or too large.`]
						: []),
				].join(' ')
	const earlier =
		facts.earlier.length === 0
			? '- This is the first note, so there is nothing earlier to leave out.'
			: [
					'- Do not say again what an earlier note said. The earlier notes, newest first:',
					...facts.earlier.map((note) => `  - ${note.at}: ${note.summary}`),
				].join('\n')
	const session =
		facts.session === null
			? []
			: [
					`- When the saved session says why, quote it and label it from-the-session. The newest session is ${facts.session}: read its last messages with read_session.`,
				]
	const uncommitted =
		about.kind === 'uncommitted' ? ['- Send no work title and no topics: ken keeps this note out of the record.'] : []
	return [
		'ken is watching this project while a coding agent works in it. The owner reads your note beside their agent as the work happens, so keep it short and say only what is new.',
		'',
		what,
		'',
		'These rules come before the general ones:',
		'- Say what changed since the last note and why, in two to four sentences. Lead with what the change does and what it means for the code, not which lines moved.',
		`- Call show with scope base ${about.base} and head ${head}. Send a card only for a decision the change made or a risk that is real, with the changed lines quoted.`,
		'- Read only the code the change touches and the lines next to it; do not search the rest of the project.',
		'- Speak to the reader as "you": write "you asked for", never "the owner asked for".',
		earlier,
		...session,
		...uncommitted,
	].join('\n')
}
