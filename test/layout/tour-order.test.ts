import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tourOrder } from '../../src/layout/index.ts'

const part = (name: string, paths: string[], job = '') => ({ name, job, paths })
const arrow = (from: string, to: string) => ({ from, to })

// The parts and arrows ken's model named for aigents, in the order it named them.
const AIGENTS = [
	part('Plugin engine', ['src/engine.ts', 'src/session.ts'], 'The agent engine: sessions, plugins and gates'),
	part('Eval harness', ['src/cli.ts', 'src/eval'], 'The aigent CLI: runs a scenario on a model'),
	part('Test suite', ['test'], 'Unit tests on a scripted fake loop'),
	part('multeval integration', ['integrations'], 'Plugs into the multeval grading tool'),
	part('Vendored agent skills', ['.agents', 'third_party'], 'Skills vendored at pinned refs'),
	part('Build scripts', ['scripts'], 'Builds the installable tarball'),
]
const AIGENTS_ARROWS = [
	arrow('Eval harness', 'Plugin engine'),
	arrow('Test suite', 'Plugin engine'),
	arrow('Test suite', 'Eval harness'),
	arrow('multeval integration', 'Eval harness'),
	arrow('multeval integration', 'Plugin engine'),
	arrow('multeval integration', 'Test suite'),
	arrow('Build scripts', 'Vendored agent skills'),
	arrow('Build scripts', 'Plugin engine'),
]

test('a tour starts at the part nothing in the code uses, goes inward along the arrows, and leaves tests, build and vendored parts for last', () => {
	const stops = tourOrder(AIGENTS, AIGENTS_ARROWS)
	assert.deepEqual(
		stops.map((stop) => [stop.name, stop.kind]),
		[
			['multeval integration', 'start'],
			['Eval harness', 'inward'],
			['Plugin engine', 'inward'],
			['Test suite', 'support'],
			['Vendored agent skills', 'support'],
			['Build scripts', 'support'],
		],
	)
	assert.deepEqual(stops[1]?.paths, ['src/cli.ts', 'src/eval'], 'each stop keeps its paths for the question')
})

test('a tour walks breadth first from every start, takes the busiest start first, and puts parts no arrow joins after the walk', () => {
	const stops = tourOrder(
		[
			part('Store', ['src/store']),
			part('Docs site', ['site']),
			part('Worker', ['src/worker']),
			part('Web app', ['src/web']),
			part('Queue', ['src/queue']),
			part('Checks', ['src/checks'], 'Tests the store against a real database'),
		],
		[
			arrow('Worker', 'Queue'),
			arrow('Web app', 'Queue'),
			arrow('Web app', 'Store'),
			arrow('Queue', 'Store'),
			arrow('Checks', 'Store'),
		],
	)
	assert.deepEqual(
		stops.map((stop) => stop.name),
		['Web app', 'Worker', 'Queue', 'Store', 'Docs site', 'Checks'],
	)
})

test('parts that use each other in a loop no start reaches still get a stop each, from the one that uses the most', () => {
	const stops = tourOrder(
		[part('Parser', ['src/parse']), part('Printer', ['src/print']), part('Core', ['src/core'])],
		[arrow('Parser', 'Core'), arrow('Core', 'Parser'), arrow('Core', 'Printer'), arrow('Printer', 'Core')],
	)
	assert.deepEqual(
		stops.map((stop) => [stop.name, stop.kind]),
		[
			['Core', 'start'],
			['Parser', 'inward'],
			['Printer', 'inward'],
		],
	)
})
