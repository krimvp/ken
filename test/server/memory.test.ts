import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, openKen, readerHome } from '../fixtures/ken-server.ts'
import { type ChatRequest, scriptedModel, toolResults } from '../fixtures/scripted-model.ts'

const FILES = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': 'export function run() {\n\treturn 1\n}\n',
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const home = readerHome()
const record = fileRecordStore(root, gitRepository(root))
const ABOUT = 'A command that runs one piece of work.'
const named = await record.append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		about: ABOUT,
		parts: [
			{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
			{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
		],
		arrows: [
			{
				from: 'Command',
				to: 'Core',
				text: 'runs',
				quotes: [{ path: 'src/cli/main.ts', commit: 'HEAD', text: "import { run } from '../core/run.ts'" }],
			},
		],
	},
	// Many terms that quote the command's file, more than memory gives back at once.
	...Array.from({ length: 50 }, (_, i) => ({
		kind: 'topic' as const,
		name: `workshop ${i}`,
		quotes: [{ path: 'src/cli/main.ts', commit: 'HEAD', text: 'run()' }],
	})),
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

const RETURNS = 'A run gives back one.'
const model = await scriptedModel([
	{
		tool: 'ken__show',
		args: {
			brief: {
				number: 1,
				line: 'Runs the work.',
				points: [
					{
						line: RETURNS,
						more: `${RETURNS} More.`,
						long: `${RETURNS} Long.`,
						drawing: { kind: 'dot' },
						quotes: [{ path: 'src/core/run.ts', text: '\treturn 1' }],
					},
				],
			},
		},
	},
	{ hang: () => {} },
	{
		calls: [
			{ tool: 'ken__memory_known', args: { about: 'part::Core' } },
			{ tool: 'ken__memory_level', args: { within: [] } },
			{ tool: 'ken__memory_quoted_in', args: { path: 'src/core/run.ts', start: 2, end: 2 } },
			{ tool: 'ken__memory_search', args: { words: 'gives back' } },
			{ tool: 'ken__memory_quoted_in', args: { path: 'src/cli' } },
		],
	},
	{ text: 'Done.' },
])
const server = await openKen(root, home, model.baseUrl)
await ask(server, { lens: { kind: 'explain', within: [], part: 'Core' } })
// The answer's run is held open: what it was asked with is what this test reads.
const stop = new AbortController()
void fetch(new URL('/api/questions', server.url), {
	method: 'POST',
	headers: { origin: new URL(server.url).origin, 'content-type': 'application/json' },
	body: JSON.stringify({ lens: { kind: 'answer', concept: 'part::Core', text: 'What does a run give back?' } }),
	signal: stop.signal,
}).catch(() => {})
while (model.requests.length < 2) await new Promise((resolve) => setTimeout(resolve, 20))
stop.abort()
const answerAsked = model.requests[1] as ChatRequest

writeFileSync(path.join(root, 'src/core/run.ts'), 'export function run() {\n\treturn 2\n}\n')
execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'feat: give back two'], { cwd: root })
await ask(server, { question: 'What does ken know of the core?' })
const [known = '', level = '', quotedIn = '', search = '', many = ''] = toolResults(model.requests[3])

test('an answer about a part starts from its brief with the lines each point quotes, and gets only the memory tools it asks', () => {
	const question = JSON.stringify(answerAsked.messages.at(-1))
	assert.match(question, /A run gives back one\. \(src\/core\/run\.ts:2\)/, 'the point comes with where its quote is')
	assert.deepEqual(
		answerAsked.tools.map((tool) => tool.function.name).filter((name) => name.startsWith('ken__')),
		[
			'ken__read_file',
			'ken__list_files',
			'ken__search',
			'ken__memory_known',
			'ken__memory_quoted_in',
			'ken__memory_search',
			'ken__show',
		],
	)
})

test('memory_known gives a part with its line and points, and marks a quote whose lines changed since', () => {
	assert.match(known, /part part::Core \(Core\): Runs the work\./)
	assert.match(known, /- A run gives back one\. \[src\/core\/run\.ts:2 \(changed since: read the file again\)\]/)
	assert.ok(known.length <= 2000)
})

test('memory_level gives the named level: its line, its parts with whether each has a brief, and its arrows', () => {
	assert.match(level, new RegExp(`Level \\[\\]: ${ABOUT}`))
	assert.match(level, /- Core \(src\/core\): Runs the work\n/)
	assert.match(level, /- Command \(src\/cli\): The command a person types \[no brief yet\]/)
	assert.match(level, /- Command runs Core/)
})

test('memory_quoted_in and memory_search find the brief that quotes those lines, and a long list is cut at its cap', () => {
	for (const found of [quotedIn, search]) {
		assert.match(
			found,
			/brief of part::Core \(Core\): A run gives back one\. More\. \[src\/core\/run\.ts:2 \(changed since/,
		)
	}
	assert.ok(many.length <= 2000, `${many.length} characters`)
	assert.match(many, /^40 that quote src\/cli:/)
	assert.match(many, /more lines left out\.$/)
})

test('a run whose output goes into the project record reads none of what the reader typed or keeps for themselves', async () => {
	const MARK = 'quokka'
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: {
				...FILES,
				'src/core/save.ts': 'export function save() {\n\treturn true\n}\n',
			},
		},
	])
	const named = await fileRecordStore(root, gitRepository(root)).append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			parts: [
				{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
				{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
			],
			arrows: [],
		},
	])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	const said = `The ${MARK} gives back one.`
	const model = await scriptedModel([
		{ tool: 'ken__remember', args: { note: `You call the core the ${MARK}.` } },
		{
			tool: 'ken__show',
			args: {
				brief: {
					number: 1,
					line: said,
					points: [
						{
							line: said,
							more: said,
							long: said,
							drawing: { kind: 'dot' },
							quotes: [{ path: 'src/core/run.ts', text: '\treturn 1' }],
						},
					],
				},
			},
		},
		{
			calls: [
				{ tool: 'ken__memory_known', args: { about: 'part::Core' } },
				{ tool: 'ken__memory_quoted_in', args: { path: 'src/core' } },
			],
		},
		{ hang: () => {} },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const typed = { kind: 'answer', concept: 'part::Core', text: `What is the ${MARK} for?`, typed: true }
	assert.equal((await ask(server, { lens: typed })).at(-1).kind, 'saved')
	const stop = new AbortController()
	void fetch(new URL('/api/questions', server.url), {
		method: 'POST',
		headers: { origin: new URL(server.url).origin, 'content-type': 'application/json' },
		body: JSON.stringify({ lens: { kind: 'parts', within: ['src/core'], name: 'Core' } }),
		signal: stop.signal,
	}).catch(() => {})
	while (model.requests.length < 4) await new Promise((resolve) => setTimeout(resolve, 20))
	stop.abort()
	const [known = ''] = toolResults(model.requests[3])
	assert.match(known, /part part::Core \(Core\): Runs the work/, 'memory answered the run')
	for (const request of model.requests.slice(2)) {
		assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(MARK), 'the naming run never saw the marked word')
	}
})
