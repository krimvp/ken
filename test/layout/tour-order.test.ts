import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tourOrder } from '../../src/layout/index.ts'

const part = (name: string, paths: string[], job = '') => ({ name, job, paths })
const arrow = (from: string, to: string) => ({ from, to })

test('a tour starts at the part the most other parts of the code use, goes outward along the arrows, and leaves tests, build and vendored parts for last', () => {
	// The parts and arrows ken's model named for aigents, in the order it named them.
	const stops = tourOrder(
		[
			part('Engine', ['src/engine.ts', 'src/session.ts'], 'Runs a session: plugins, tools and gates'),
			part('Eval harness', ['src/cli.ts', 'src/eval'], 'Runs a scenario on a model'),
			part('multeval integration', ['integrations'], 'Plugs into the multeval grading tool'),
			part('Tests', ['test'], 'Unit tests on a scripted fake loop'),
			part('Tooling scripts', ['scripts'], 'Builds the installable tarball'),
			part('Vendored agent skills', ['.agents', 'third_party'], 'Skills vendored at pinned refs'),
		],
		[
			arrow('Eval harness', 'Engine'),
			arrow('multeval integration', 'Eval harness'),
			arrow('multeval integration', 'Engine'),
			arrow('Tests', 'Engine'),
			arrow('Tests', 'Eval harness'),
			arrow('Tooling scripts', 'Vendored agent skills'),
		],
	)
	assert.deepEqual(
		stops.map((stop) => [stop.name, stop.kind]),
		[
			['Engine', 'heart'],
			['Eval harness', 'outward'],
			['multeval integration', 'outward'],
			['Tests', 'support'],
			['Tooling scripts', 'support'],
			['Vendored agent skills', 'support'],
		],
	)
	assert.deepEqual(stops[1]?.paths, ['src/cli.ts', 'src/eval'], 'each stop keeps its paths for the question')
})

test("a tour takes a stop's neighbours on either side before theirs, and puts parts no arrow joins after the walk", () => {
	const stops = tourOrder(
		[
			part('Store', ['src/store']),
			part('Docs site', ['site']),
			part('Mailer', ['src/mail']),
			part('Worker', ['src/worker']),
			part('Web app', ['src/web']),
			part('Queue', ['src/queue']),
			part('Checks', ['src/checks'], 'Tests the store against a real database'),
		],
		[
			arrow('Worker', 'Mailer'),
			arrow('Worker', 'Queue'),
			arrow('Web app', 'Queue'),
			arrow('Web app', 'Store'),
			arrow('Queue', 'Store'),
			arrow('Checks', 'Store'),
		],
	)
	assert.deepEqual(
		stops.map((stop) => stop.name),
		['Store', 'Web app', 'Queue', 'Worker', 'Mailer', 'Docs site', 'Checks'],
	)
})

test('a group of parts no arrow joins to the first walk still gets a stop each, from its own most used part', () => {
	const stops = tourOrder(
		[
			part('Site', ['site']),
			part('Theme', ['theme']),
			part('Api', ['src/api']),
			part('Db', ['src/db']),
			part('Auth', ['src/auth']),
		],
		[arrow('Site', 'Theme'), arrow('Api', 'Db'), arrow('Auth', 'Db')],
	)
	assert.deepEqual(
		stops.map((stop) => [stop.name, stop.kind]),
		[
			['Db', 'heart'],
			['Api', 'outward'],
			['Auth', 'outward'],
			['Theme', 'heart'],
			['Site', 'outward'],
		],
	)
})

test('when two parts are used as much, a tour starts at the one that uses the fewest others, and a part named for upkeep comes last', () => {
	// The parts ken's model named for aigents on 2026-11-22: the eval part and the engine each have two users.
	const stops = tourOrder(
		[
			part('Eval scenarios and checks', ['src/cli.ts', 'src/eval'], 'Runs scenarios and grades the run'),
			part('Plugin engine', ['src/engine.ts'], 'Runs an agent session and gates every tool call'),
			part('multeval integration', ['integrations'], 'Lets the multeval runner grade live models'),
			part('Code sandbox', ['src/sandbox.ts'], 'Runs model code in a worker'),
			part('Repository upkeep', ['scripts', '.agents'], 'Packs the tarball and pins agent skills'),
		],
		[
			arrow('Eval scenarios and checks', 'Plugin engine'),
			arrow('multeval integration', 'Eval scenarios and checks'),
			arrow('Code sandbox', 'Eval scenarios and checks'),
			arrow('Code sandbox', 'Plugin engine'),
		],
	)
	assert.deepEqual(
		stops.map((stop) => [stop.name, stop.kind]),
		[
			['Plugin engine', 'heart'],
			['Eval scenarios and checks', 'outward'],
			['Code sandbox', 'outward'],
			['multeval integration', 'outward'],
			['Repository upkeep', 'support'],
		],
	)
})
