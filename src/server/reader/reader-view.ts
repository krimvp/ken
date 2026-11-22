// What the page shows of ken's own record of the reader: where the file of what they looked at is, the newest things
// ken recorded there and in the map, and when they last looked. Each sentence is built by code from one line, so the
// reader can check it against the file.
import { under } from '../../layout/index.ts'
import type { Evidence, SeenLine, SeenRead, TopicState } from '../../map/index.ts'
import type { Topic } from '../../record/index.ts'

// did is the line's did, or the evidence of a map line. at is a moment, or a day for a map line, which keeps no time.
// part is the top-level part the line counts for, null when it counts for none.
export type Learned = { at: string; did: string; part: string | null; text: string }

export type ReaderView = { file: string; learned: Learned[]; lastVisit: string | null; problems: string[] }

type Part = { name: string; paths: string[] }

const MOST = 20
// A line this old was written on an earlier visit, not on this one.
const VISIT_MS = 30 * 60 * 1000

const LOOKED: Record<SeenLine['did'], (where: string) => string> = {
	opened: (where) => `You opened ${where}.`,
	read: (where) => `You read about ${where}.`,
	code: (where) => `You opened the code of ${where}.`,
	said: (where) => `You said you know ${where}.`,
	forgot: (where) => `You said you do not know ${where}.`,
	change: (where) => `You walked through a change in ${where}.`,
}

const SIGNALLED: Record<Evidence, (topic: string) => string> = {
	asked: (topic) => `You asked ken about ${topic}.`,
	read: (topic) => `You found the answer on ${topic} too much.`,
	said: (topic) => `You said you know ${topic}.`,
	wrote: (topic) => `You wrote ${topic} by hand.`,
	forgot: (topic) => `You said you do not know ${topic} any more.`,
	toured: (topic) => `You met ${topic} on a tour.`,
}

// The newest line written on an earlier visit, or null on a first visit.
export function lastVisit(lines: SeenLine[], now: Date): SeenLine | null {
	const earlier = lines.filter((line) => now.getTime() - Date.parse(line.at) > VISIT_MS)
	return earlier.reduce<SeenLine | null>((best, line) => (best === null || line.at >= best.at ? line : best), null)
}

// states is the map read now, which holds the newest line of each topic. parts are the top-level parts.
export function readerView(
	file: string,
	seen: SeenRead,
	map: { states: TopicState[]; problems: string[] },
	topics: Topic[],
	parts: Part[],
	now: Date,
): ReaderView {
	const holds = (paths: string[]) =>
		parts.find((part) => paths.some((file) => part.paths.some((place) => under(file, place))))
	const looked = seen.lines.map((line) => {
		const part = holds(line.paths)?.name ?? null
		const [first = '', ...more] = line.paths
		const where = part ?? (more.length === 0 ? first : `${first} and ${more.length} more`)
		return { at: line.at, did: line.did, part, text: LOOKED[line.did](where) }
	})
	const signalled = map.states.flatMap((state) => {
		if (state.kind === 'never-met') return []
		const quoted = topics.find((topic) => topic.name === state.topic)?.quotes.flatMap((quote) => quote.path ?? [])
		const { date, evidence } = state.entry
		return [
			{ at: date, did: evidence, part: holds(quoted ?? [])?.name ?? null, text: SIGNALLED[evidence](state.topic) },
		]
	})
	const learned = [...looked, ...signalled].toSorted((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
	return {
		file,
		learned: learned.slice(0, MOST),
		lastVisit: lastVisit(seen.lines, now)?.at ?? null,
		problems: [...seen.problems, ...map.problems],
	}
}
