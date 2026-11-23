import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type JobAsk, type JobView, jobQueue, type Rank } from '../../src/jobs/index.ts'

// A run the test ends by hand: each start is logged, and each run waits until the test lets it finish, or until the
// queue stops it. windDown is how long a run takes to end once stopped, as a git call or a model request does.
function harness(
	options: { parallel?: number; fresh?: string[]; ranks?: Record<string, Exclude<Rank, 1>>; windDown?: number } = {},
) {
	const started: string[] = []
	const finishers = new Map<string, () => void>()
	const ended: JobView[] = []
	const queue = jobQueue<null, string>({
		parallel: options.parallel ?? 1,
		async run(job, signal, say) {
			started.push(job.key)
			say(`${job.key} said`)
			await new Promise<void>((resolve, reject) => {
				finishers.set(job.key, resolve)
				const stopped = () => reject(new Error('aborted'))
				signal.addEventListener('abort', () => setTimeout(stopped, options.windDown ?? 0))
			})
			return { kind: 'ran' }
		},
		fresh: async (job) => options.fresh?.includes(job.key) ?? false,
		rankOf: (job) => options.ranks?.[job.key] ?? 4,
		ended: (job) => ended.push(job),
	})
	const ask = (key: string, order = 0): JobAsk<null> => ({
		key,
		kind: 'explain',
		concept: null,
		title: key,
		order,
		yields: true,
		work: null,
	})
	const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
	async function finish(key: string) {
		finishers.get(key)?.()
		await settle()
	}
	const state = (key: string) => queue.view().find((job) => job.key === key)?.state.kind
	return { queue, ask, started, finish, settle, state, ended }
}

test('background jobs run one at a time in their order, and a job the reader looks at goes before the rest', async () => {
	const { queue, ask, started, finish, settle } = harness({ ranks: { core: 2 } })
	queue.want(ask('first', 0), 'ken')
	queue.want(ask('store', 2), 'ken')
	queue.want(ask('core', 3), 'ken')
	queue.want(ask('cli', 1), 'ken')
	await settle()
	assert.deepEqual(started, ['first'], 'KEN_PARALLEL of 1 runs one job')
	const waiting = queue.view().filter((job) => job.state.kind === 'waiting')
	assert.deepEqual(
		waiting.map((job) => [job.key, job.place]),
		[
			['core', 1],
			['cli', 2],
			['store', 3],
		],
	)
	for (const key of ['first', 'core', 'cli']) await finish(key)
	assert.deepEqual(started, ['first', 'core', 'cli', 'store'])
})

test('jobs ken wants together start in their order, whatever order it found them in', async () => {
	const { queue, ask, started, settle } = harness()
	queue.wantAll([ask('answer', 300), ask('brief', 101)])
	await settle()
	assert.deepEqual(started, ['brief'])
})

test("the reader's request stops the lowest background job, which runs again later from the head of its rank", async () => {
	const { queue, ask, started, finish, settle, state } = harness({ ranks: { near: 2 } })
	queue.want(ask('far', 0), 'ken')
	queue.want(ask('later', 1), 'ken')
	queue.want(ask('near', 5), 'ken')
	await settle()
	assert.deepEqual(started, ['far'])
	const asked = queue.want(ask('asked'), 'reader')
	assert.equal(asked?.rank, 1)
	await settle()
	assert.deepEqual(started, ['far', 'asked'], 'the running background job gave way at once')
	assert.equal(state('far'), 'waiting')
	await finish('asked')
	await finish('near')
	assert.deepEqual(started, ['far', 'asked', 'near', 'far'], 'it runs again before the job that was behind it')
	await finish('far')
	assert.equal(state('far'), 'done')
	assert.equal(started.at(-1), 'later')
})

test('no two jobs run for the same thing, and the reader asking for a waiting one moves it to the front', async () => {
	const { queue, ask, started, finish, settle } = harness()
	queue.want(ask('a'), 'ken')
	queue.want(ask('b'), 'ken')
	queue.want(ask('a'), 'ken')
	queue.want(ask('b'), 'reader')
	await settle()
	assert.deepEqual(started, ['b'], 'a gave way to b, which the reader asked for, before its model run began')
	assert.equal(queue.view().filter((job) => job.key === 'a').length, 1)
	await finish('b')
	await finish('a')
	assert.deepEqual(started, ['b', 'a'])
	assert.equal(queue.want(ask('a'), 'ken'), null, 'ken does not try a thing again by itself in one server life')
	queue.want(ask('a'), 'reader')
	await settle()
	assert.deepEqual(started, ['b', 'a', 'a'], 'the reader can ask for it again')
})

test('a background job whose thing is already there and fresh is skipped without a model run', async () => {
	const { queue, ask, started, settle, ended } = harness({ fresh: ['made'] })
	queue.want(ask('made'), 'ken')
	await settle()
	assert.deepEqual(started, [])
	assert.deepEqual(
		ended.map((job) => [job.key, job.state]),
		[['made', { kind: 'done', skipped: true }]],
	)
})

test('KEN_PARALLEL of 2 runs two jobs at once, and the third waits for a free slot', async () => {
	const { queue, ask, started, finish, settle } = harness({ parallel: 2 })
	for (const key of ['a', 'b', 'c']) queue.want(ask(key), 'ken')
	await settle()
	assert.deepEqual(started, ['a', 'b'])
	await finish('b')
	assert.deepEqual(started, ['a', 'b', 'c'])
})

test('a follower gets what a job said so far and leaves it running when it goes; Stop ends a job, which ken queues again only after Start again', async () => {
	const { queue, ask, finish, settle, state } = harness()
	queue.want(ask('mine'), 'reader')
	await settle()
	const tab = new AbortController()
	const heard: string[] = []
	const following = queue.follow('mine', (line) => heard.push(line), tab.signal)
	tab.abort()
	assert.equal(await following, null)
	await settle()
	assert.equal(state('mine'), 'running', 'the closed tab left the run going')
	await finish('mine')
	assert.deepEqual(heard, ['mine said'])
	queue.want(ask('bg'), 'ken')
	await settle()
	queue.stop('bg')
	await settle()
	assert.deepEqual(queue.view().find((job) => job.key === 'bg')?.state, { kind: 'failed', why: 'You stopped it.' })
	assert.equal(queue.want(ask('bg'), 'ken'), null, 'ken does not queue again what the reader stopped')
	queue.again('bg')
	assert.equal(queue.want(ask('bg'), 'ken')?.state.kind, 'running', 'Start again lets ken queue it')
	await finish('bg')
})

test('a background job that gave way and takes time to stop holds nothing up: settled waits for its run alone, and close ends it', async () => {
	const inTime = async (promise: Promise<unknown>) =>
		await Promise.race([promise.then(() => 'ended'), new Promise((resolve) => setTimeout(resolve, 500, 'hung'))])
	const first = harness({ windDown: 30 })
	first.queue.want(first.ask('bg'), 'ken')
	await first.settle()
	first.queue.want(first.ask('asked'), 'reader')
	assert.equal(await inTime(first.queue.settled()), 'ended', 'settled waits for the stopped run, not for the job')
	assert.equal(first.state('asked'), 'running')
	assert.equal(first.state('bg'), 'waiting')

	const second = harness({ windDown: 30 })
	second.queue.want(second.ask('bg'), 'ken')
	await second.settle()
	second.queue.want(second.ask('asked'), 'reader')
	const following = second.queue.follow('bg', () => {})
	assert.equal(await inTime(second.queue.close()), 'ended', 'close returns while the job winds down')
	assert.deepEqual(await inTime(following), 'ended', 'whoever followed the job that gave way hears it end')
	assert.deepEqual(second.state('bg'), 'failed')
})

test("a job the model refused is tried again after a growing wait, with the model's reason, and not given up", async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	const started: string[] = []
	let refuse = true
	const queue = jobQueue<null, string>({
		parallel: 1,
		async run(job) {
			started.push(job.key)
			return refuse ? { kind: 'model-error', why: 'The model endpoint is busy: 429.' } : { kind: 'ran' }
		},
		fresh: async () => false,
		rankOf: () => 4,
	})
	const flush = () => new Promise((resolve) => setImmediate(resolve))
	const brief = { key: 'brief', kind: 'explain', concept: null, title: 'brief', order: 0, yields: true, work: null }
	const shown = () => queue.view().findLast((job) => job.key === 'brief')
	queue.want(brief, 'ken')
	await flush()
	assert.deepEqual(
		[shown()?.state.kind, shown()?.reason, shown()?.retryIn],
		['failed', 'The model endpoint is busy: 429.', 30],
	)
	assert.equal(queue.want(brief, 'ken'), null, 'ken does not queue it again before the wait')
	t.mock.timers.tick(29_000)
	await flush()
	assert.equal(started.length, 1)
	t.mock.timers.tick(1_000)
	await flush()
	assert.deepEqual([started.length, shown()?.retryIn], [2, 120], 'the second wait is longer')
	refuse = false
	t.mock.timers.tick(120_000)
	await flush()
	assert.deepEqual([started.length, shown()?.state.kind], [3, 'done'])
})

test('on an endpoint that serves one request at a time, KEN_PARALLEL above 1 fails a few runs, not every job', async (t) => {
	const { ask, settle } = harness()
	const finishing = new Map<string, () => void>()
	let inFlight = 0
	const busy = jobQueue<null, string>({
		parallel: 3,
		async run(job, signal) {
			inFlight += 1
			try {
				if (inFlight > 1) return { kind: 'model-error', why: 'The model endpoint is busy: 429.' }
				await new Promise<void>((resolve, reject) => {
					finishing.set(job.key, resolve)
					signal.addEventListener('abort', () => reject(new Error('aborted')))
				})
				return { kind: 'ran' }
			} finally {
				inFlight -= 1
			}
		},
		fresh: async () => false,
		rankOf: () => 4,
	})
	t.after(() => busy.close())
	for (const key of ['a', 'b', 'c', 'd', 'e']) busy.want(ask(key), 'ken')
	await settle()
	const states = () => busy.view().map((job) => `${job.key}:${job.state.kind}`)
	assert.equal(states().filter((each) => each.endsWith('failed')).length, 2, 'the two that found it busy')
	assert.deepEqual(
		states().filter((each) => each.endsWith('waiting')),
		['d:waiting', 'e:waiting'],
	)
	finishing.get('a')?.()
	await settle()
	assert.ok(states().includes('d:running'), 'one runs at a time from then on')
	assert.ok(states().includes('e:waiting'))
})

test('a background run that has gone on 20 seconds is not thrown away for the reader, who runs next', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	const flush = () => new Promise((resolve) => setImmediate(resolve))
	const { queue, ask, started, state } = harness()
	queue.want(ask('long'), 'ken')
	await flush()
	t.mock.timers.tick(20_000)
	queue.want(ask('asked'), 'reader')
	t.mock.timers.tick(1)
	await flush()
	assert.deepEqual([state('long'), state('asked'), started], ['running', 'waiting', ['long']])
	assert.equal(queue.view().find((job) => job.key === 'asked')?.place, 1)
})

test('the queue says when each waiting job starts and when all end, from how long the last runs of a kind took', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	const flush = () => new Promise((resolve) => setImmediate(resolve))
	const { queue, ask, finish } = harness()
	queue.want(ask('first'), 'ken')
	await flush()
	assert.deepEqual(queue.left(), { jobs: 1, seconds: 60 }, 'a guess before any run of the kind')
	t.mock.timers.tick(30_000)
	const finished = finish('first')
	t.mock.timers.tick(5)
	await finished
	for (const key of ['a', 'b', 'c']) queue.want(ask(key), 'ken')
	await flush()
	assert.deepEqual(
		queue.view().flatMap((job) => (job.key === 'first' ? [] : [[job.key, job.startsIn]])),
		[
			['a', null],
			['b', 30],
			['c', 60],
		],
	)
	assert.deepEqual(queue.left(), { jobs: 3, seconds: 90 })
	t.mock.timers.tick(10_000)
	assert.deepEqual(queue.left(), { jobs: 3, seconds: 80 })
})

test('no job starts while a running job makes one of the same things, as two briefs of one part would', async () => {
	const { queue, ask, started, finish, settle } = harness({ parallel: 2 })
	queue.want({ ...ask('every', 0), holds: ['part::Core', 'part::Command'] }, 'ken')
	queue.want({ ...ask('core', 1), holds: ['part::Core'] }, 'ken')
	queue.want({ ...ask('store', 2), holds: ['part::Store'] }, 'ken')
	await settle()
	assert.deepEqual(started, ['every', 'store'])
	await finish('every')
	assert.deepEqual(started, ['every', 'store', 'core'])
})

test('ken can renew a completed brief after its code changes and keeps a stopped brief stopped', async () => {
	const { queue, ask, finish, settle, started } = harness()
	const asks = [ask('brief'), ask('paused')]
	queue.wantAll(asks, 'first commit')
	queue.stop('paused')
	await settle()
	await finish('brief')
	queue.wantAll(asks, 'first commit')
	await settle()
	assert.deepEqual(started, ['brief'])
	queue.wantAll(asks, 'next commit')
	await settle()
	assert.deepEqual(started, ['brief', 'brief'])
	await finish('brief')
})

test('closing ken finishes a background job that was giving way to the reader', { timeout: 1000 }, async () => {
	const { queue, ask, settle } = harness()
	queue.want(ask('background'), 'ken')
	await settle()
	queue.want(ask('reader'), 'reader')
	await queue.close()
	assert.ok(queue.view().every((job) => job.state.kind === 'failed'))
})

test('closing one of two tabs following a brief leaves the other one reading the same run', async () => {
	const { queue, ask, started, settle, finish } = harness()
	queue.want(ask('brief'), 'reader')
	const tab = new AbortController()
	const left = queue.follow('brief', () => {}, tab.signal)
	queue.want(ask('brief'), 'reader')
	const heard: string[] = []
	const stayed = queue.follow('brief', (line) => heard.push(line))
	tab.abort()
	assert.equal(await left, null)
	await settle()
	await finish('brief')
	assert.deepEqual(await stayed, { kind: 'done', skipped: false })
	assert.deepEqual(started, ['brief'])
	assert.deepEqual(heard, ['brief said'])
})

test('two waiting readers can take two busy background slots', async () => {
	const { queue, ask, started, finish, settle } = harness({ parallel: 2 })
	queue.wantAll([ask('parts'), ask('process')])
	await settle()
	queue.want(ask('first question'), 'reader')
	queue.want(ask('second question'), 'reader')
	// Each reader waits for a stopped run to wind down, which takes more than one settle on a busy machine.
	for (let tries = 0; started.length < 4 && tries < 200; tries++) await settle()
	assert.deepEqual(started, ['parts', 'process', 'first question', 'second question'])
	for (const key of ['first question', 'second question', 'parts', 'process']) await finish(key)
})
