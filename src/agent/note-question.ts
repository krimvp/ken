// The question ken asks itself in live mode, while a coding agent works in the project and the owner watches. A note is
// an ordinary answer, checked the same way, with rules for this case on top of the system prompt: it says what is new
// since the last note and why, in a few entries, and leaves out what earlier notes said. It follows plain-words.
import type { About } from '../live/index.ts'

// earlier: the summaries of the last notes, newest first. session: the id of the newest saved session, null when ken
// reads none. leftOut: files the snapshot left out because they were binary or too large.
export type NoteFacts = {
	earlier: { at: string; summary: string }[]
	session: string | null
	leftOut: number
}

export const MAX_NOTE_ENTRIES = 3

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
		`Send the note with the answer tool, with scope base ${about.base} and head ${head}. These rules come before the general ones:`,
		`- Say what changed since the last note and why, in at most ${MAX_NOTE_ENTRIES} entries: statements, decisions and risks together.`,
		'- Lead with what matters to someone watching: what the change does and what it means for the code, not which lines moved.',
		'- Quote the changed lines.',
		'- Speak to the reader as "you": write "you asked for", never "the owner asked for".',
		'- Name a risk only if it is real. If there is none, send risks as an empty list. Read only the code the change touches and the lines next to it; do not search the rest of the project.',
		"- Use the reader's map: skip what they know, and lead with what changed in what they knew.",
		earlier,
		...session,
		'- Send a decision only when the change made one.',
		'- Send no diagram unless the change is about how parts connect.',
		...uncommitted,
	].join('\n')
}
