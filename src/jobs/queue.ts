// ken's queue of model runs. A job is one run of ken's model that makes one thing: the parts of a level, a part's
// brief, the answer to a question, a drawn process, a live note. The server says how to run a job, which jobs ken
// wants and how far each is from what the reader looks at. The queue decides the order, how many run at once, and
// which background job gives way when the reader asks for something. It holds nothing on disk: the server builds it
// again from what is missing each time it starts.

// 1 the reader asked or pressed it; 2 it fills what the reader looks at now; 3 the layer below what they opened; 4
// everything else.
export type Rank = 1 | 2 | 3 | 4

// key names what the job makes, so two jobs for one thing are one job. order places a background job within its rank,
// lowest first. yields says it gives way to the reader; a live note does not, as the reader turned live mode on and a
// note stopped halfway is lost. work is what the server needs to run it.
export type JobAsk<W> = {
	key: string
	kind: string
	concept: string | null
	title: string
	order: number
	yields: boolean
	work: W
}

export type JobState =
	| { kind: 'waiting' }
	| { kind: 'running'; startedAt: number; actions: number }
	| { kind: 'done'; skipped: boolean }
	| { kind: 'failed'; why: string }

// What the page sees of one job. place counts from 1 among the jobs that wait, in the order they will run.
export type JobView = {
	key: string
	kind: string
	concept: string | null
	title: string
	rank: Rank
	by: 'reader' | 'ken'
	state: JobState
	place: number | null
}

type Job<W, L> = JobAsk<W> & {
	// Who asked first. A job the reader started stops when they stop it; one ken started goes on.
	from: 'reader' | 'ken'
	asked: boolean
	state: JobState
	// A job that gave way to the reader goes back to the head of its rank.
	bumped: number
	seq: number
	stop: AbortController | null
	lines: L[]
	followers: Set<(line: L) => void>
	ended: Promise<void>
	end: () => void
}

// run makes the job's thing: it may call say with each line a follower should see, and acted with each action of the
// model. fresh says a background job's thing exists already, so the job is skipped. rankOf ranks a background job by
// what the reader looks at now. ended is told when any job ends, so the server can want what is missing next.
export type QueueDeps<W, L> = {
	parallel: number
	run(job: JobAsk<W>, signal: AbortSignal, say: (line: L) => void, acted: () => void): Promise<void>
	fresh(job: JobAsk<W>): Promise<boolean>
	rankOf(job: JobAsk<W>): Exclude<Rank, 1>
	ended?(job: JobView): void
}

// The jobs that ended stay in the list for a while, so the page can say what ken did.
const KEPT_ENDED = 20
const GAVE_WAY = 'gave way to the reader'

export function jobQueue<W, L>(deps: QueueDeps<W, L>) {
	const jobs: Job<W, L>[] = []
	const listeners = new Set<(jobs: JobView[]) => void>()
	// A background thing ken tried once in this server's life is not tried again by itself: a run that made nothing
	// would otherwise run again each time ken looks for what is missing. The reader can still ask for it.
	const tried = new Set<string>()
	let seq = 0
	let bumps = 0
	let closed = false

	const rank = (job: Job<W, L>): Rank => (job.asked ? 1 : deps.rankOf(job))
	const live = (job: Job<W, L>) => job.state.kind === 'waiting' || job.state.kind === 'running'
	const running = () => jobs.filter((job) => job.state.kind === 'running')

	// The waiting jobs in the order they will run.
	function line(): Job<W, L>[] {
		const ranked = jobs.filter((job) => job.state.kind === 'waiting').map((job) => ({ job, rank: rank(job) }))
		ranked.sort(
			(a, b) =>
				a.rank - b.rank ||
				b.job.bumped - a.job.bumped ||
				(a.job.asked ? a.job.seq - b.job.seq : a.job.order - b.job.order || a.job.seq - b.job.seq),
		)
		return ranked.map(({ job }) => job)
	}

	function view(): JobView[] {
		const waiting = line()
		const ended = jobs.filter((job) => !live(job)).slice(-KEPT_ENDED)
		const shown = [...running(), ...waiting, ...ended]
		return shown.map((job) => ({
			key: job.key,
			kind: job.kind,
			concept: job.concept,
			title: job.title,
			rank: rank(job),
			by: job.asked ? 'reader' : 'ken',
			state: job.state,
			place: job.state.kind === 'waiting' ? waiting.indexOf(job) + 1 : null,
		}))
	}

	function changed() {
		const now = view()
		for (const listener of listeners) listener(now)
	}

	// Starts the first jobs in line while a slot is free.
	function pump() {
		if (closed) return
		for (const job of line()) {
			if (running().length >= deps.parallel) break
			start(job)
		}
		changed()
	}

	function start(job: Job<W, L>) {
		const stop = new AbortController()
		Object.assign(job, { state: { kind: 'running', startedAt: Date.now(), actions: 0 }, stop, lines: [] })
		if (!job.asked) tried.add(job.key)
		const say = (said: L) => {
			if (job.stop !== stop) return
			job.lines.push(said)
			for (const follower of job.followers) follower(said)
		}
		const acted = () => {
			if (job.state.kind === 'running' && job.stop === stop)
				job.state = { ...job.state, actions: job.state.actions + 1 }
			changed()
		}
		void (async () => {
			let state: JobState
			try {
				const made = !job.asked && (await deps.fresh(job))
				if (stop.signal.aborted) state = stopped(stop.signal)
				else if (made) state = { kind: 'done', skipped: true }
				else {
					await deps.run(job, stop.signal, say, acted)
					state = stop.signal.aborted ? stopped(stop.signal) : { kind: 'done', skipped: false }
				}
			} catch (error) {
				state = stop.signal.aborted ? stopped(stop.signal) : { kind: 'failed', why: messageOf(error) }
			}
			job.stop = null
			job.state = state
			if (state.kind === 'waiting') job.bumped = ++bumps
			else finish(job)
			pump()
		})()
	}

	function finish(job: Job<W, L>) {
		job.followers.clear()
		job.end()
		const ended = view().find((each) => each.key === job.key && each.state === job.state)
		if (ended) deps.ended?.(ended)
		const old = jobs.filter((each) => !live(each))
		for (const each of old.slice(0, Math.max(0, old.length - KEPT_ENDED))) jobs.splice(jobs.indexOf(each), 1)
	}

	// A reader's job finds no free slot: the background job furthest from what the reader looks at gives way, and runs
	// again later from the head of its rank.
	function makeRoom() {
		const busy = running()
		if (busy.length < deps.parallel || busy.some((job) => job.stop?.signal.aborted)) return
		const yielding = busy
			.filter((job) => !job.asked && job.yields)
			.sort((a, b) => rank(b) - rank(a) || b.seq - a.seq)
			.at(0)
		yielding?.stop?.abort(GAVE_WAY)
	}

	// Asks for a job. One for the same thing that waits or runs is that job: the reader asking for it moves it to the
	// front. Returns null when ken already tried the thing by itself in this server's life, or the queue has closed.
	function want(ask: JobAsk<W>, by: 'reader' | 'ken'): JobView | null {
		if (closed) return null
		const same = jobs.find((job) => job.key === ask.key && live(job))
		if (same) {
			if (by === 'reader' && !same.asked) {
				same.asked = true
				same.seq = ++seq
				if (same.state.kind === 'waiting') makeRoom()
			}
			pump()
			return viewOf(same)
		}
		if (by === 'ken' && tried.has(ask.key)) return null
		let end = () => {}
		const ended = new Promise<void>((resolve) => (end = resolve))
		const job: Job<W, L> = {
			...ask,
			from: by,
			asked: by === 'reader',
			state: { kind: 'waiting' },
			bumped: 0,
			seq: ++seq,
			stop: null,
			lines: [],
			followers: new Set(),
			ended,
			end,
		}
		jobs.push(job)
		if (job.asked) makeRoom()
		pump()
		return viewOf(job)
	}

	function viewOf(job: Job<W, L>): JobView | null {
		return view().find((each) => each.key === job.key && live(job)) ?? null
	}

	// Sends the lines a job has said so far and each one after, until the job ends. Resolves when it has.
	async function follow(key: string, onLine: (line: L) => void): Promise<JobState | null> {
		const job = jobs.find((each) => each.key === key && live(each))
		if (!job) return null
		for (const said of job.lines) onLine(said)
		job.followers.add(onLine)
		await job.ended
		return job.state
	}

	// The reader stopped it, or closed the page that followed it. A job ken started that the reader only followed goes
	// on, as ken's again.
	function stop(key: string, how: 'stop' | 'unfollow') {
		const job = jobs.find((each) => each.key === key && live(each))
		if (!job) return
		if (how === 'unfollow' && job.from === 'ken') {
			job.asked = false
			return pump()
		}
		// The reader said no to it, so ken does not queue it again by itself.
		if (job.from === 'ken') tried.add(job.key)
		if (job.state.kind === 'running') return job.stop?.abort('stopped')
		job.state = { kind: 'failed', why: STOPPED }
		finish(job)
		pump()
	}

	// A stopped job may still be winding down. Resolves when none is.
	async function settled() {
		while (true) {
			const ending = running().filter((job) => job.stop?.signal.aborted)
			if (ending.length === 0) return
			await Promise.all(ending.map((job) => job.ended))
		}
	}

	// Ranks change when the reader looks at something else.
	function refocus() {
		pump()
	}

	// Stops every job and waits for the running ones to end.
	async function close() {
		closed = true
		const ending = running().map((job) => {
			job.stop?.abort('stopped')
			return job.ended
		})
		for (const job of jobs.filter((each) => each.state.kind === 'waiting')) {
			job.state = { kind: 'failed', why: STOPPED }
			job.end()
		}
		await Promise.all(ending)
	}

	function subscribe(listener: (jobs: JobView[]) => void): () => void {
		listeners.add(listener)
		return () => listeners.delete(listener)
	}

	return { want, follow, stop, settled, refocus, view, subscribe, close }
}

export type JobQueue<W, L> = ReturnType<typeof jobQueue<W, L>>

const STOPPED = 'You stopped it.'

// A run that sees this gave way to the reader and runs again later, so it keeps nothing of what it did.
export function gaveWay(signal: AbortSignal): boolean {
	return signal.reason === GAVE_WAY
}

function stopped(signal: AbortSignal): JobState {
	return signal.reason === GAVE_WAY ? { kind: 'waiting' } : { kind: 'failed', why: STOPPED }
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
