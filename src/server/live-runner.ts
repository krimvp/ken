import { type Chat, firstWords, noteQuestion } from '../agent/index.ts'
import {
	type About,
	type LastAsk,
	lastAsk,
	type NowBlock,
	nowBlock,
	observe,
	PACE,
	type SnapshotStore,
	startWatch,
	takeSnapshot,
	type WatchAction,
	type WatchEvent,
	type WatchState,
	watchStep,
} from '../live/index.ts'
import type { Repository } from '../repo/index.ts'
import type { Transcripts } from '../transcripts/index.ts'
import type { QuestionView, questionDesk, Spent } from './question-desk.ts'

// What the Live view and "ken live" show. status says what ken does now; about is what the note it writes explains.
// said is ken's last word to the owner, such as "Nothing new since the last note", or null. since is when live mode was
// last turned on, null before the first time; spent counts the notes in the history from then on and what they cost,
// so it agrees with the notes the page shows.
export type LiveView = {
	status: 'off' | 'watching' | 'paused' | 'snapshot' | 'writing'
	about: About | null
	said: string | null
	now: NowBlock
	pace: typeof PACE
	since: string | null
	spent: Spent
	notes: QuestionView[]
}

export type LiveRunner = ReturnType<typeof liveRunner>

const EARLIER_NOTES = 5
const SHOWN_NOTES = 30
// How much of an earlier note the next one is told, so it does not say the same again.
const EARLIER_CHARS = 300

// Live mode for one project: every PACE.pollMs it reads the project, feeds watchStep, and does what it says. project
// reads the project's own git; withSnapshots also reads ken's store, to count the lines a snapshot changed. A note goes
// through the desk, so it takes turns with the owner's questions. chat is live mode's own: a note written into the
// reader's chat would sit in the thread they talk in, and "what about that?" could then mean a note they never read.
export function liveRunner(deps: {
	root: string
	project: Repository
	withSnapshots: Repository
	store: SnapshotStore
	sessions: Transcripts | null
	desk: ReturnType<typeof questionDesk>
	chat: Chat
}) {
	const { root, project, withSnapshots, store, sessions, desk, chat } = deps
	let state: WatchState | null = null
	let timer: ReturnType<typeof setInterval> | null = null
	let polling: Promise<void> | null = null
	let stop = new AbortController()
	let said: string | null = null
	let leftOut = 0
	let since: string | null = null
	let asked: { stamp: string; ask: LastAsk } | null = null
	const working = new Set<Promise<void>>()
	const listeners = new Set<(event: { kind: 'writing'; about: About } | { kind: 'note'; view: QuestionView }) => void>()

	function apply(event: WatchEvent) {
		if (state === null) return
		const step = watchStep(state, event, Date.now())
		state = step.state
		const work = act(step.action, stop.signal).catch((error: unknown) => {
			said = `ken stopped watching for a moment: ${error instanceof Error ? error.message : String(error)}`
		})
		working.add(work)
		void work.finally(() => working.delete(work))
	}

	async function act(action: WatchAction, signal: AbortSignal) {
		switch (action.kind) {
			case 'none':
				return
			case 'nothing-new':
				said = 'Nothing new since the last note.'
				return
			case 'snapshot': {
				const taken = await takeSnapshot(store, project, root, signal).catch(() => null)
				if (signal.aborted) return
				if (taken?.kind !== 'taken') return apply({ kind: 'snapshot', taken: null })
				leftOut = taken.leftOut
				const from = state?.noted.snapshot ?? state?.noted.head ?? taken.head
				const changed = await changedLines(withSnapshots, from, taken.commit, signal)
				return apply({ kind: 'snapshot', taken: { snapshot: taken.commit, head: taken.head, changed } })
			}
			case 'note': {
				said = null
				for (const listener of listeners) listener({ kind: 'writing', about: action.about })
				const earlier = (await desk.notes(EARLIER_NOTES)).flatMap(({ entry }) =>
					entry.outcome === 'answered'
						? [{ at: entry.askedAt.slice(11, 16), summary: firstWords(entry.reply.items, EARLIER_CHARS) }]
						: [],
				)
				const session = sessions && (await sessions.latest())
				const facts = {
					earlier,
					session: session?.id ?? null,
					leftOut: action.about.kind === 'uncommitted' ? leftOut : 0,
				}
				const view = await desk.note(chat, action.about, noteQuestion(action.about, facts), signal)
				if (view === null) return
				if (view.noNote !== null) said = 'There is no note on the last change.'
				for (const listener of listeners) listener({ kind: 'note', view })
				return apply({ kind: 'noted' })
			}
			default:
				return action satisfies never
		}
	}

	async function poll() {
		const seen = await observe(project, state?.noted.head ?? null, stop.signal)
		if (state === null) {
			const [newest] = await desk.notes(1)
			state = startWatch(seen, Date.now(), newest?.entry.about ?? null)
		}
		apply({ kind: 'observed', ...seen })
	}

	function tick() {
		polling ??= poll()
			.catch((error: unknown) => {
				said = `ken could not read the project: ${error instanceof Error ? error.message : String(error)}`
			})
			.finally(() => {
				polling = null
			})
		return polling
	}

	async function start() {
		if (timer !== null) return
		stop = new AbortController()
		state = null
		said = null
		since = new Date().toISOString()
		timer = setInterval(tick, PACE.pollMs)
		await tick()
	}

	// Turning live mode off stops a note being written, so it spends nothing more.
	async function off() {
		if (timer !== null) clearInterval(timer)
		timer = null
		stop.abort()
		await polling
		await Promise.all([...working])
		state = null
	}

	async function view(): Promise<LiveView> {
		const newest = sessions && (await sessions.latest())
		const stamp = newest ? `${newest.id} ${newest.bytes} ${newest.changedAt}` : ''
		if (asked?.stamp !== stamp) asked = { stamp, ask: await lastAsk(sessions) }
		const busy = state?.busy
		const status =
			timer === null
				? 'off'
				: busy?.kind === 'note' || desk.writing()
					? 'writing'
					: busy?.kind === 'snapshot'
						? 'snapshot'
						: state?.paused
							? 'paused'
							: 'watching'
		return {
			status,
			about: busy?.kind === 'note' ? busy.about : null,
			said,
			now: await nowBlock(project, asked.ask),
			pace: PACE,
			since,
			spent: await desk.spentSince(since),
			notes: await desk.notes(SHOWN_NOTES),
		}
	}

	return {
		start,
		off,
		view,
		on: () => timer !== null,
		pause: () => apply({ kind: 'pause' }),
		resume: () => apply({ kind: 'resume' }),
		noteNow: () => apply({ kind: 'note-now' }),
		subscribe(listener: Parameters<typeof listeners.add>[0]) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

// Lines added and removed between two commits, ken's snapshots among them.
async function changedLines(repo: Repository, base: string, head: string, signal: AbortSignal): Promise<number> {
	const [from, to] = await Promise.all([repo.resolve(base, signal), repo.resolve(head, signal)])
	if (from.kind !== 'ok' || to.kind !== 'ok') return 0
	const diff = await repo.diff({ base: from.commit, head: to.commit }, signal)
	if (diff.kind !== 'ok') return Number.POSITIVE_INFINITY
	return diff.files.reduce(
		(sum, file) =>
			file.kind === 'binary'
				? sum + 1
				: sum + file.hunks.reduce((n, hunk) => n + hunk.lines.filter((line) => /^[+-]/.test(line)).length, 0),
		0,
	)
}
