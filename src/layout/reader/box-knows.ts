// What ken thinks the reader knows of one box, and why (plan: "What the reader looked at"). It is worked out from all
// ken holds on the reader: the lines on what they looked at, and the map's topics that sit in the box. believe is the
// one place that decides the level, and the box's standing is read from its answer, so the two cannot disagree.
// Looking is never understanding: only "I know this part", or "I know this" on every topic in the box, gives "said".
import { onDay } from '../../follow-up/index.ts'
import type { Did, Known, Evidence as MapEvidence, SeenLine, TopicState } from '../../map/index.ts'
import type { CommitHash } from '../../repo/index.ts'
import { under } from '../folder-split.ts'
import type { Since } from './since-looked.ts'

export type Level = Known

// The five levels, weakest first, with the words the page shows for each.
export const LEVELS: { level: Level; label: string }[] = [
	{ level: 'new', label: 'New to you' },
	{ level: 'seen', label: 'Seen' },
	{ level: 'read', label: 'Read' },
	{ level: 'code', label: 'Read the code' },
	{ level: 'said', label: 'You said you know it' },
]

// Where ken would open a part: a way in, a level of detail, and for a part that changed the change to lay over it,
// as the layout takes a change.
export type OpensAt = { way: 'learn' | 'catch-up' | 'review'; detail: 'big' | 'how' | 'code'; change?: string }

// why is one sentence the reader can check. last is the day they last looked, null when they never did. since counts
// the commits, merges left out, that touched the box after the commit they last looked at, and stale says some did.
// go is where ken would open the part for this reader.
export type Knows = { level: Level; why: string; last: string | null; since: number; stale: boolean; go: OpensAt }

// One thing the reader did that counts for a box. A line on what they looked at gives its did. The map gives the
// rest: topics is "I know this" on every topic in the box, toured a tour stop reached, answered an answer read, and
// unlearned one topic taken back.
type Kind = Exclude<Did, 'set'> | 'topics' | 'toured' | 'answered' | 'unlearned'

// at is a moment for a line on what they looked at and a day for a line of the map, which keeps no time. As text a
// day sorts before every moment in it, so a correction takes back what the map held that day. A correction carries
// the level the reader picked.
type Evidence = { at: string } & ({ kind: Kind } | { kind: 'set'; level: Level })

// What a box's belief is worked out from. lookedAt holds the commits the reader may have last looked at, the first
// that HEAD reaches counts: for a change they read it is the change's last commit, then the commit they read it at.
export type Looks = { evidence: Evidence[]; lookedAt: string[] }

// What a belief is about, as its sentence names it: a box is a part, and a term and a drawn process have briefs too.
export type Thing = 'part' | 'term' | 'process'

// on is the day in words, such as "on 20 Nov", and often the same with a count before it when there were several.
type Said = { on: string; often: string; times: number; thing: Thing }
const KINDS: Record<Kind, { level: Exclude<Level, 'new'>; why: (said: Said) => string }> = {
	opened: {
		level: 'seen',
		why: ({ on, often, times }) =>
			times === 1 ? `You opened it once ${on} and did not read on.` : `You opened it ${often}, and did not read on.`,
	},
	change: { level: 'seen', why: ({ often }) => `You looked at a change here ${often}.` },
	forgot: { level: 'seen', why: ({ on, thing }) => `You said ${on} that you do not know this ${thing}.` },
	unlearned: { level: 'seen', why: ({ on }) => `You said ${on} that you do not know a topic here any more.` },
	read: { level: 'read', why: ({ often }) => `You read about it ${often}.` },
	toured: { level: 'read', why: ({ often }) => `You read its tour stop ${often}.` },
	answered: { level: 'read', why: ({ often }) => `You read an answer about it ${often}.` },
	code: { level: 'code', why: ({ often }) => `You read its code ${often}.` },
	said: { level: 'said', why: ({ on, thing }) => `You said you know this ${thing} ${on}.` },
	topics: {
		level: 'said',
		why: ({ on }) => `You said you understand each topic ken explained here, the last one ${on}.`,
	},
}

const SET: Record<Level, (on: string, thing: Thing) => string> = {
	new: (on, thing) => `You said ${on} that this ${thing} is new to you.`,
	seen: (on, thing) => `You said ${on} that you have only seen this ${thing}.`,
	read: (on, thing) => `You said ${on} that you have read about this ${thing}.`,
	code: (on) => `You said ${on} that you have read its code.`,
	said: (on, thing) => `You said you know this ${thing} ${on}.`,
}

// A part new to the reader opens at its job, one they have seen at how it works, and one they have read at the code.
const OPENS: Record<Level, OpensAt['detail']> = { new: 'big', seen: 'how', read: 'code', code: 'code', said: 'code' }

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
	const looked: Evidence[] = counted.map((line) =>
		line.did === 'set' ? { kind: 'set', level: line.level, at: line.at } : { kind: line.did, at: line.at },
	)
	const evidence = [...looked, ...fromMap(states)]
	// Opening a part is not reading it, and a correction says what the reader knows, not that they looked again. So
	// neither moves the commit they last looked at, and a correction never hides that the part changed. "I know it"
	// is the one correction that says they know the part as it is now.
	const moves = (line: SeenLine) =>
		line.did === 'set' ? line.level === 'said' : line.did !== 'opened' && line.did !== 'forgot'
	const newest = counted.filter(moves).toSorted(oldestFirst).at(-1)
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

// head is the commit checked out, where a change that shows what landed since the reader looked ends.
export function believe(looks: Looks, since: Since, head: CommitHash, now: Date, thing: Thing = 'part'): Knows {
	const { evidence } = looks
	// A correction takes back all that came before it and leaves the level the reader picked: seen, for one that
	// only says they do not know the part.
	const takenBack = evidence.findLastIndex((each) => each.kind === 'forgot' || each.kind === 'set')
	const standing = takenBack === -1 ? evidence : evidence.slice(takenBack)
	const levelOf = (each: Evidence) => (each.kind === 'set' ? each.level : KINDS[each.kind].level)
	const rank = (each: Evidence) => LEVELS.findIndex(({ level }) => level === levelOf(each))
	const best = standing.reduce<Evidence | undefined>(
		(top, each) => (top === undefined || rank(each) >= rank(top) ? each : top),
		undefined,
	)
	const last = evidence.at(-1)?.at.slice(0, 10) ?? null
	const fresh = { level: 'new', last, since: 0, stale: false, go: { way: 'learn', detail: OPENS.new } } as const
	if (best === undefined) return { ...fresh, why: `You have not opened this ${thing}.` }
	const on = onDay(best.at.slice(0, 10), now)
	// A part the reader calls new to them has no look of theirs to count commits from.
	if (best.kind === 'set' && best.level === 'new') return { ...fresh, why: SET.new(on, thing) }
	const times = standing.filter((each) => each.kind === best.kind).length
	const often = times === 1 ? on : `${times === 2 ? 'twice' : `${times} times`}, last ${on}`
	const said = best.kind === 'set' ? SET[best.level](on, thing) : KINDS[best.kind].why({ on, often, times, thing })
	const why = since === 'gone' ? `${said} ken could not find the commit you last looked at.` : said
	const landed = since === 'gone' || since === null || since.commits === 0 ? null : since
	const level = levelOf(best)
	return {
		level,
		why,
		last,
		since: landed?.commits ?? 0,
		stale: landed !== null,
		// A part that changed since the reader looked opens at what changed, whatever they know of it.
		go: landed
			? { way: 'catch-up', detail: 'code', change: `${landed.commit}..${head}` }
			: { way: 'learn', detail: OPENS[level] },
	}
}
