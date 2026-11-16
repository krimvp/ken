// When ken writes a note while it watches. A note is a model call, so the pace is calm and bounded: a commit always
// earns a note; uncommitted work earns one once it has been quiet for PACE.quietMs and changed by PACE.minLines lines
// since the last note; one note at a time, PACE.gapMs apart at least, and PACE.perHour at most. The owner's "Write a
// note now" skips the wait, the gap and the cap, and works while paused too. watchStep is pure: the state, what happened and the time go in, and
// the new state and what to do come out, so tests drive it with made-up observations and times.
import type { CommitHash } from '../repo/index.ts'

export const PACE = {
	// How often ken reads HEAD, the branch, the working tree and the newest session.
	pollMs: 2_000,
	quietMs: 20_000,
	minLines: 3,
	gapMs: 60_000,
	perHour: 12,
}

const HOUR_MS = 60 * 60 * 1000

// What a note explains. commits: the commits from base to head. uncommitted: work nobody has committed, as ken's
// snapshot holds it, on top of HEAD head; base is the snapshot of the last note, or HEAD when the last note was about
// commits. at is when ken took the snapshot.
export type About =
	| { kind: 'commits'; base: CommitHash; head: CommitHash }
	| { kind: 'uncommitted'; base: CommitHash; snapshot: CommitHash; head: CommitHash; at: string }

// One poll. tree is a fingerprint of the uncommitted files, null when there are none. landed is the range from the HEAD
// the last note covered to HEAD now, and how many commits in it change more than ken's own .ken/.
export type Observation = {
	head: CommitHash
	tree: string | null
	landed: { base: CommitHash; commits: number }
}

export type WatchEvent =
	| ({ kind: 'observed' } & Observation)
	// The snapshot ken was told to take, and how many lines it changed since the last note. null: there was nothing to
	// take in, or it failed.
	| { kind: 'snapshot'; taken: { snapshot: CommitHash; head: CommitHash; changed: number } | null }
	| { kind: 'noted' }
	| { kind: 'pause' }
	| { kind: 'resume' }
	| { kind: 'note-now' }

export type WatchAction =
	| { kind: 'none' }
	| { kind: 'snapshot' }
	| { kind: 'note'; about: About }
	// The owner asked for a note and nothing changed since the last one.
	| { kind: 'nothing-new' }

// noted is what the last note covered: HEAD then, and its snapshot when it was about uncommitted work. seen is the
// newest observation, with when its tree last changed. snapshotted is the tree of the last snapshot, so a quiet tree is
// not taken twice. notes holds when each note of the last hour started. asked: the owner asked for a note now.
export type WatchState = {
	paused: boolean
	busy: { kind: 'idle' } | { kind: 'snapshot'; tree: string } | { kind: 'note'; about: About }
	noted: { head: CommitHash; snapshot: CommitHash | null }
	seen: Observation & { changedAt: number }
	snapshotted: string | null
	notes: number[]
	asked: boolean
}

type Step = { state: WatchState; action: WatchAction }

// last is what the newest note in the history explained. While HEAD has not moved since, live mode picks up from it, so
// turning live mode off and on again does not explain the same uncommitted work twice.
export function startWatch(first: Observation, now: number, last: About | null = null): WatchState {
	const snapshot = last?.kind === 'uncommitted' && last.head === first.head ? last.snapshot : null
	return {
		paused: false,
		busy: { kind: 'idle' },
		noted: { head: first.head, snapshot },
		seen: { ...first, changedAt: now },
		snapshotted: null,
		notes: [],
		asked: false,
	}
}

export function watchStep(state: WatchState, event: WatchEvent, now: number): Step {
	const current = { ...state, notes: state.notes.filter((at) => now - at < HOUR_MS) }
	switch (event.kind) {
		case 'pause':
			return { state: { ...current, paused: true, asked: false }, action: { kind: 'none' } }
		case 'resume':
			return next({ ...current, paused: false }, now)
		case 'note-now':
			return next({ ...current, asked: true }, now)
		case 'noted':
			return next({ ...current, busy: { kind: 'idle' } }, now)
		case 'observed': {
			const { kind, ...observed } = event
			const changedAt = observed.tree === current.seen.tree ? current.seen.changedAt : now
			return next({ ...current, seen: { ...observed, changedAt } }, now)
		}
		case 'snapshot':
			return snapshotTaken(current, event.taken, now)
		default:
			return event satisfies never
	}
}

// What comes next once nothing is running: a note on the commits that landed, a snapshot of quiet uncommitted work, or
// nothing yet.
function next(state: WatchState, now: number): Step {
	const wait: Step = { state, action: { kind: 'none' } }
	if ((state.paused && !state.asked) || state.busy.kind !== 'idle') return wait
	const free =
		state.asked || (state.notes.length < PACE.perHour && now - (state.notes.at(-1) ?? -HOUR_MS) >= PACE.gapMs)
	const { head, landed, tree, changedAt } = state.seen
	if (head !== state.noted.head) {
		const moved = { ...state, noted: { head, snapshot: null }, snapshotted: null }
		// HEAD moved with nothing to explain, such as a commit of ken's own .ken/ alone: the next note starts from here.
		if (landed.commits === 0) return next(moved, now)
		return free ? startNote(moved, { kind: 'commits', base: landed.base, head }, now) : wait
	}
	const fresh = tree !== null && tree !== state.snapshotted
	if (state.asked && !fresh) return { state: { ...state, asked: false }, action: { kind: 'nothing-new' } }
	if (!fresh || !free || !(state.asked || now - changedAt >= PACE.quietMs)) return wait
	return { state: { ...state, busy: { kind: 'snapshot', tree } }, action: { kind: 'snapshot' } }
}

function snapshotTaken(state: WatchState, taken: Extract<WatchEvent, { kind: 'snapshot' }>['taken'], now: number) {
	if (state.busy.kind !== 'snapshot') return { state, action: { kind: 'none' } } satisfies Step
	const settled: WatchState = { ...state, busy: { kind: 'idle' }, snapshotted: state.busy.tree, asked: false }
	// Paused while the snapshot ran: take it again once the owner resumes.
	if (state.paused && !state.asked)
		return { state: { ...settled, snapshotted: null }, action: { kind: 'none' } } satisfies Step
	const enough = taken !== null && taken.changed >= (state.asked ? 1 : PACE.minLines)
	if (taken === null || !enough || taken.snapshot === state.noted.snapshot) {
		return { state: settled, action: { kind: state.asked ? 'nothing-new' : 'none' } } satisfies Step
	}
	const about: About = {
		kind: 'uncommitted',
		base: state.noted.snapshot ?? state.noted.head,
		snapshot: taken.snapshot,
		head: taken.head,
		at: new Date(now).toISOString(),
	}
	return startNote({ ...settled, noted: { head: taken.head, snapshot: taken.snapshot } }, about, now)
}

function startNote(state: WatchState, about: About, now: number): Step {
	return {
		state: { ...state, busy: { kind: 'note', about }, notes: [...state.notes, now], asked: false },
		action: { kind: 'note', about },
	}
}
