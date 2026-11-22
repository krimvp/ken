import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tourOrder } from '../../src/layout/index.ts'

const part = (name: string, paths: string[], job = '') => ({ name, job, paths })

test('a tour follows the order the level lists its parts in, and leaves tests, build, vendored and upkeep parts for last', () => {
	// The parts ken's model named for aigents on 2026-11-22, with the tests moved up to show they still come last.
	const stops = tourOrder([
		part('Tests and scenarios', ['test'], 'Proves the engine offline'),
		part('Plugin engine', ['src/engine.ts'], 'Runs an agent session and gates every tool call'),
		part('Code sandbox', ['src/sandbox.ts'], 'Runs model code in a worker'),
		part('Eval scenarios and checks', ['src/cli.ts', 'src/eval'], 'Runs scenarios and grades the run'),
		part('Repository upkeep', ['scripts', '.agents'], 'Packs the tarball and pins agent skills'),
		part('multeval integration', ['integrations'], 'Lets the multeval runner grade live models'),
		part('Pinned skills', ['third_party', 'vendor/skills'], 'Skills at pinned refs'),
	])
	assert.deepEqual(
		stops.map((stop) => stop.name),
		[
			'Plugin engine',
			'Code sandbox',
			'Eval scenarios and checks',
			'multeval integration',
			'Tests and scenarios',
			'Repository upkeep',
			'Pinned skills',
		],
	)
	assert.deepEqual(stops[2]?.paths, ['src/cli.ts', 'src/eval'], 'each stop keeps its paths for the question')
})
