import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
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

await json(server, '/api/seen', { did: 'said', paths: ['src/core'] })
writeFileSync(path.join(root, 'src/core/run.ts'), 'export function run() {\n\treturn 2\n}\n')
// The command's lines move down by one, and the terms that quote them still read the same.
writeFileSync(path.join(root, 'src/cli/main.ts'), `// The command.\n${FILES['src/cli/main.ts']}`)
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
	assert.match(known, /You said you know this part.*code has changed since you looked/is)
	assert.ok(known.length <= 2000)
})

test('memory_level gives the named level: its line, its parts with whether each has a brief, and its arrows', () => {
	assert.match(level, new RegExp(`Level \\[\\]: ${ABOUT}`))
	assert.match(level, /- Core \(src\/core\): Runs the work\n/)
	assert.match(level, /- Command \(src\/cli\): The command a person types \[no brief yet\]/)
	assert.match(level, /- Command imports Core/)
})

test('memory_quoted_in and memory_search find the brief that quotes those lines, point at where lines are now, and cut a long list at its cap', () => {
	for (const found of [quotedIn, search]) {
		assert.match(
			found,
			/brief of part::Core \(Core\): A run gives back one\. More\. \[src\/core\/run\.ts:2 \(changed since/,
		)
	}
	assert.ok(many.length <= 2000, `${many.length} characters`)
	assert.match(many, /^Quotes of src\/cli:/)
	assert.match(many, /Continue with from \d+\.$/)
	assert.match(many, /\[src\/cli\/main\.ts:3\]/, 'a quote whose lines moved points at where they are now')
	assert.doesNotMatch(many, /main\.ts:2/)
})

for (const concept of ['part::Core', 'term:retry']) {
	test(`a shared run omits the private answer about ${concept} from concept and file recall`, () =>
		sharedRecall(concept))
}

async function sharedRecall(concept: string) {
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
		{ kind: 'topic', name: 'retry', quotes: [{ path: 'src/core/run.ts', commit: 'HEAD', text: '\treturn 1' }] },
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
				{ tool: 'ken__memory_known', args: { about: 'term:retry' } },
				{ tool: 'ken__memory_quoted_in', args: { path: 'src/core' } },
			],
		},
		{ text: 'Done.' },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const typed = {
		kind: 'answer',
		concept,
		text: concept === 'term:retry' ? 'What does "retry" mean in this project?' : `What is the ${MARK} for?`,
		typed: true,
	}
	assert.equal((await ask(server, { lens: typed })).at(-1).kind, 'saved')
	const result = await ask(server, { lens: { kind: 'parts', within: ['src/core'], name: 'Core' } })
	assert.equal(result.at(-1).kind, 'saved')
	const [known = '', term = ''] = toolResults(model.requests[3])
	assert.match(term, /retry/)
	assert.match(term, /src\/core\/run\.ts/)
	assert.match(known, /part part::Core \(Core\): Runs the work/, 'memory answered the run')
	for (const request of model.requests.slice(2)) {
		assert.doesNotMatch(JSON.stringify(request.messages), new RegExp(MARK), 'the naming run never saw the marked word')
	}
}

test('a memory search lists every id on a page even when the names are long', () => {
	assert.match(page, /^100 hits:/)
	assert.equal(new Set([...page.matchAll(/^term of term:workshop (\d+)/gm)].map((match) => match[1])).size, 20)
	assert.match(page, /Ask for page 2/)
	assert.ok(page.length <= 3000)
})

test('a free question that names one part starts with what the reader last said about it', async () => {
	const questions = [
		'What does Core do?',
		'Please explain the following part.\nCore.',
		'Compare Core and Command.',
		'What is Coreless?',
	]
	const provider = await scriptedModel(questions.map(() => ({ text: 'Done.' })))
	const open = await openKen(root, readerHome(), provider.baseUrl)
	await json(open, '/api/seen', { did: 'said', paths: ['src/core'] })
	await ask(open, { question: questions[0] })
	await json(open, '/api/seen', { did: 'set', level: 'new', paths: ['src/core'] })
	for (const question of questions.slice(1)) await ask(open, { question })

	const maps = provider.requests.map((request) => {
		const message = request.messages.find((each) => each.role === 'user')
		return String(message?.content).match(/^Reader's map for (.+)$/m)?.[1]
	})
	assert.equal(maps.length, 4)
	assert.match(maps[0] ?? '', /^Core: You said you know this part/)
	assert.match(maps[1] ?? '', /^Core: You said .* that this part is new to you/)
	assert.deepEqual(maps.slice(2), [undefined, undefined])
})
