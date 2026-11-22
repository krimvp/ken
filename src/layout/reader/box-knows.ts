// What ken thinks the reader knows of one box, and why (plan: "What the reader looked at"). It is worked out from all
// ken holds on the reader: the lines on what they looked at, and the map's topics that sit in the box. believe is the
// one place that decides the level, and the box's standing is read from its answer, so the two cannot disagree.
// Looking is never understanding: only "I know this part", or "I know this" on every topic in the box, gives "said".
import { onDay } from '../../follow-up/index.ts'
import type { Did, Evidence as MapEvidence, SeenLine, TopicState } from '../../map/index.ts'
import { under } from '../folder-split.ts'
import type { Since } from './since-looked.ts'

// The five levels, weakest first, with the words the page shows for each.
export const LEVELS = [
	{ level: 'new', label: 'New to you' },
	{ level: 'seen', label: 'Seen' },
	{ level: 'read', label: 'Read' },
	{ level: 'code', label: 'Read the code' },
	{ level: 'said', label: 'You said you know it' },
] as const
export type Level = (typeof LEVELS)[number]['level']

// why is one sentence the reader can check. last is the day they last looked, null when they never did. since counts
// the commits, merges left out, that touched the box after the commit they last looked at, and stale says some did.
export type Knows = { level: Level; why: string; last: string | null; since: number; stale: boolean }

// One thing the reader did that counts for a box. A line on what they looked at gives its did. The map gives the
// rest: topics is "I know this" on every topic in the box, toured a tour stop reached, answered an answer read, and
// unlearned one topic taken back.
type Kind = Did | 'topics' | 'toured' | 'answered' | 'unlearned'

// at is a moment for a line on what they looked at and a day for a line of the map, which keeps no time. As text a
// day sorts before every moment in it, so "Not right" takes back what the map held that day.
type Evidence = { kind: Kind; at: string }

// What a box's belief is worked out from. lookedAt holds the commits the reader may have last looked at, the first
// that HEAD reaches counts: for a change they read it is the change's last commit, then the commit they read it at.
export type Looks = { evidence: Evidence[]; lookedAt: string[] }

// on is the day in words, such as "on 20 Nov", and often the same with a count before it when there were several.
const KINDS: Record<Kind, { level: Exclude<Level, 'new'>; why: (on: string, often: string, times: number) => string }> =
	{
		opened: {
			level: 'seen',
			why: (on, often, times) =>
				times === 1 ? `You opened it once ${on} and did not read on.` : `You opened it ${often}, and did not read on.`,
		},
		change: { level: 'seen', why: (_, often) => `You looked at a change here ${often}.` },
		forgot: { level: 'seen', why: (on) => `You said ${on} that you do not know this part.` },
		unlearned: { level: 'seen', why: (on) => `You said ${on} that you do not know a topic here any more.` },
		read: { level: 'read', why: (_, often) => `You read about it ${often}.` },
		toured: { level: 'read', why: (_, often) => `You read its tour stop ${often}.` },
		answered: { level: 'read', why: (_, often) => `You read an answer about it ${often}.` },
		code: { level: 'code', why: (_, often) => `You read its code ${often}.` },
		said: { level: 'said', why: (on) => `You said you know this part ${on}.` },
		topics: {
			level: 'said',
			why: (on) => `You said you understand each topic ken explained here, the last one ${on}.`,
		},
	}

const FROM_MAP: Record<MapEvidence, Kind> = {
	asked: 'answered',
	read: 'answered',
	said: 'answered',
	wrote: 'answered',
	toured: 'toured',
	forgot: 'unlearned',
}

// A line counts for a box when one of its paths is the box's path or inside it. So a line on one file counts for the
// part that holds the file, and a line on a whole part does not count for the boxes inside that part. states are the
// map's topics that sit in the box.
export function looksAt(paths: string[], lines: SeenLine[], states: TopicState[]): Looks {
	const counted = lines.filter((line) => line.paths.some((file) => paths.some((place) => under(file, place))))
	const evidence: Evidence[] = [...counted.map((line) => ({ kind: line.did, at: line.at })), ...fromMap(states)]
	// Opening a part is not reading it, so it does not move the commit they last looked at.
	const newest = counted
		.filter((line) => line.did !== 'opened')
		.toSorted(oldestFirst)
		.at(-1)
	const lookedAt = newest ? [...(newest.did === 'change' ? [newest.change.head] : []), newest.head] : []
	return { evidence: evidence.toSorted(oldestFirst), lookedAt }
}

function oldestFirst(a: { at: string }, b: { at: string }): number {
	return a.at < b.at ? -1 : a.at > b.at ? 1 : 0
}

function fromMap(states: TopicState[]): Evidence[] {
	const met = states.flatMap((state) => (state.kind === 'never-met' ? [] : [state]))
	const days = met.map((state) => state.entry.date).toSorted()
	const last = days.at(-1)
	if (last === undefined) return []
	if (met.length === states.length && met.every((state) => state.kind !== 'met')) return [{ kind: 'topics', at: last }]
	return met.map((state) => ({ kind: FROM_MAP[state.entry.evidence], at: state.entry.date }))
}

export function believe(looks: Looks, since: Since, now: Date): Knows {
	const { evidence } = looks
	// "Not right" takes back all that came before it and leaves the part seen.
	const takenBack = evidence.findLastIndex((each) => each.kind === 'forgot')
	const standing = takenBack === -1 ? evidence : evidence.slice(takenBack)
	const rank = (each: Evidence) => LEVELS.findIndex(({ level }) => level === KINDS[each.kind].level)
	const best = standing.reduce<Evidence | undefined>(
		(top, each) => (top === undefined || rank(each) >= rank(top) ? each : top),
		undefined,
	)
	const last = evidence.at(-1)?.at.slice(0, 10) ?? null
	if (best === undefined) return { level: 'new', why: 'You have not opened this part.', last, since: 0, stale: false }
	const times = standing.filter((each) => each.kind === best.kind).length
	const on = onDay(best.at.slice(0, 10), now)
	const often = times === 1 ? on : `${times === 2 ? 'twice' : `${times} times`}, last ${on}`
	const said = KINDS[best.kind].why(on, often, times)
	const why = since === 'gone' ? `${said} ken could not find the commit you last looked at.` : said
	const commits = since === 'gone' || since === null ? 0 : since.commits
	return { level: KINDS[best.kind].level, why, last, since: commits, stale: commits > 0 }
}
