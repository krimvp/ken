import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { json, openKen, readerHome } from '../fixtures/ken-server.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and gives it what a browser would.
type Seen = { watch: () => void }
const { homeSeen }: { homeSeen: (app: object, loads: object) => Seen } = await import(
	path.join(import.meta.dirname, '../../src/page/level/seen.js')
)

test('a brief left open for the whole wait is marked read even when the browser fires the timer a millisecond early', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n' } }])
	const server = await openKen(root, readerHome())
	const { readMs } = await json(server, '/api/state')
	const sent: object[] = []
	const app = {
		state: { readMs },
		render() {},
		briefPaths: () => ['src/core'],
		post: async (_route: string, body: object) => {
			sent.push(body)
			return { written: false }
		},
	}

	const real = { setTimeout: globalThis.setTimeout, performance: globalThis.performance }
	let now = 0
	let early = 1
	const clock = (value: unknown) => Object.defineProperty(globalThis, 'performance', { value, configurable: true })
	clock({ now: () => now })
	Object.assign(globalThis, {
		document: { visibilityState: 'visible', addEventListener() {} },
		setTimeout: (fire: () => void, ms: number) => {
			now += ms - early
			early = 0
			queueMicrotask(fire)
		},
	})
	try {
		homeSeen(app, {}).watch()
		await new Promise((done) => real.setTimeout(done, 0))
	} finally {
		Object.assign(globalThis, { setTimeout: real.setTimeout })
		Reflect.deleteProperty(globalThis, 'document')
		clock(real.performance)
	}

	assert.equal(sent.length, 1, 'the page reports the brief once')
	const taken = await json(server, '/api/seen', sent[0] ?? {})
	assert.equal(taken.written, true, 'the map wrote the brief as read')
})
