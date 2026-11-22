import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, toolResults } from '../fixtures/scripted-model.ts'

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
		name: `workshop ${i} ${'reader detail '.repeat(4)}`,
		quotes: [{ path: 'src/cli/main.ts', commit: 'HEAD', text: 'run()' }],
	})),
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

const RETURNS = 'A run gives back one.'
const brief = {
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
}
const model = await scriptedModel([
	brief,
	brief,
	{
		calls: [
			{ tool: 'ken__memory_known', args: { about: 'part::Core' } },
			{ tool: 'ken__memory_level', args: { within: [] } },
			{ tool: 'ken__memory_quoted_in', args: { path: 'src/core/run.ts', start: 2, end: 2 } },
			{ tool: 'ken__memory_search', args: { words: 'gives back' } },
			{ tool: 'ken__memory_quoted_in', args: { path: 'src/cli' } },
			{ tool: 'ken__memory_search', args: { words: 'workshop' } },
		],
	},
	{ text: 'Done.' },
])
const server = await openKen(root, home, model.baseUrl)
await ask(server, { lens: { kind: 'explain', within: [], part: 'Core' } })
await ask(server, { lens: { kind: 'answer', concept: 'part::Core', text: 'What does a run give back?' } })
const answerAsked = model.requests[1]
assert.ok(answerAsked)

writeFileSync(path.join(root, 'src/core/run.ts'), 'export function run() {\n\treturn 2\n}\n')
execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'feat: give back two'], { cwd: root })
await ask(server, { question: 'What does ken know of the core?' })
const [known = '', level = '', quotedIn = '', search = '', many = '', page = ''] = toolResults(model.requests[3])

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
	assert.match(level, /- Command imports Core/)
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

test('a memory search lists every id on a page even when the names are long', () => {
	assert.match(page, /^100 hits:/)
	assert.equal(new Set([...page.matchAll(/^term of term:workshop (\d+)/gm)].map((match) => match[1])).size, 20)
	assert.match(page, /Ask for page 2/)
	assert.ok(page.length <= 3000)
})
