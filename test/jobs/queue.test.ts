import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type JobAsk, type JobView, jobQueue, type Rank } from '../../src/jobs/index.ts'

// A run the test ends by hand: each start is logged, and each run waits until the test lets it finish, or until the
// queue stops it.
function harness(options: { parallel?: number; fresh?: string[]; ranks?: Record<string, Exclude<Rank, 1>> } = {}) {
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
				signal.addEventListener('abort', () => reject(new Error('aborted')))
			})
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

test('a reader who follows a job gets what it said so far; stopping stops their own job and only unfollows one ken started', async () => {
	const { queue, ask, finish, settle, state } = harness()
	queue.want(ask('bg'), 'ken')
	await settle()
	queue.want(ask('bg'), 'reader')
	const heard: string[] = []
	const following = queue.follow('bg', (line) => heard.push(line))
	queue.stop('bg', 'unfollow')
	await settle()
	assert.equal(state('bg'), 'running', 'a job ken started goes on when the reader stops following it')
	await finish('bg')
	assert.deepEqual(await following, { kind: 'done', skipped: false })
	assert.deepEqual(heard, ['bg said'])
	queue.want(ask('mine'), 'reader')
	await settle()
	queue.stop('mine', 'unfollow')
	await settle()
	assert.deepEqual(queue.view().find((job) => job.key === 'mine')?.state, { kind: 'failed', why: 'You stopped it.' })
	queue.want(ask('holder'), 'ken')
	queue.want(ask('queued'), 'ken')
	queue.stop('queued', 'stop')
	assert.equal(queue.want(ask('queued'), 'ken'), null, 'ken does not queue again what the reader stopped before it ran')
})
