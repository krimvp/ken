import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	{ message: 'fix: add the items', files: { 'app.py': 'def total(items):\n    return sum(items)\n' } },
])
const [base = '', head = ''] = hashes
const NO_KEN_VARIABLES = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('KEN_')))

// Async, because the scripted model answers from this process while ken runs.
function ken(args: string[], env: Record<string, string | undefined>) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		execFile('node', [KEN, ...args], { env }, (error, stdout, stderr) => {
			resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
		})
	})
}

const SUM = { path: 'app.py', commit: head, text: '    return sum(items)' }

test('ken ask --json prints the checked answer and what it recorded, and ken record reads it back with no model', async () => {
	const model = await scriptedModel([
		{
			tool: 'ken__answer',
			args: {
				scope: { base, head },
				work: { title: 'Fix total' },
				summary: 'total now adds the items.',
				statements: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
				diagrams: [
					{
						kind: 'component',
						title: 'What total uses',
						label: 'found-by-search',
						boxes: [{ name: 'total' }, { name: 'sum' }],
						arrows: [{ from: 'total', to: 'sum', text: 'calls', quotes: [SUM] }],
					},
				],
				decisions: [
					{
						question: 'How does total add the items?',
						chosen: "Python's built-in sum",
						rejected: [],
						undo: 'easy',
						needs_owner: false,
						quotes: [SUM],
					},
				],
			},
		},
		{ text: 'Nothing was left out.' },
	])
	const env = {
		...NO_KEN_VARIABLES,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: model.baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_KEY',
		KEN_TEST_KEY: 'scripted-model-key',
	}
	const { code, stdout, stderr } = await ken(['ask', 'What did the fix do?', '--repo', root, '--json'], env)

	assert.equal(code, 0, `${stderr}${stdout}`)
	const result = JSON.parse(stdout)
	assert.equal(result.outcome, 'answered')
	assert.deepEqual(result.answer.statements[0].quotes, [
		{ path: 'app.py', commit: head, startLine: 2, endLine: 2, text: '    return sum(items)' },
	])
	assert.deepEqual(
		result.answer.change.commits.map((commit: { subject: string }) => commit.subject),
		['fix: add the items'],
	)
	assert.deepEqual(result.answer.change.uncovered, [])
	const [diagram] = result.answer.diagrams
	assert.deepEqual(
		[diagram.kind, diagram.arrows[0].number, diagram.arrows[0].label],
		['component', 3, 'found-by-search'],
	)
	assert.match(diagram.mermaid, /^flowchart LR\n.*"3\. calls"/s, 'the JSON carries the Mermaid text that draws it')
	assert.deepEqual(
		result.recorded.map((entry: { kind: string }) => entry.kind),
		['work', 'decision'],
	)

	const listed = await ken(['record', '--repo', root, '--json'], NO_KEN_VARIABLES)
	assert.equal(listed.code, 0, listed.stderr)
	assert.deepEqual(JSON.parse(listed.stdout), result.recorded)
	const decision = result.recorded[1]
	const one = await ken(['record', decision.id, '--repo', root, '--json'], NO_KEN_VARIABLES)
	assert.deepEqual(JSON.parse(one.stdout), decision)
	assert.equal(decision.label, 'inferred')
	assert.equal((await ken(['record', 'no-such-id', '--repo', root], NO_KEN_VARIABLES)).code, 1)
})

test('ken refuses to start without a model, and says what to set', async () => {
	const cases = [
		{ env: NO_KEN_VARIABLES, names: ['KEN_MODEL', 'KEN_BASE_URL', 'KEN_API_KEY_ENV'] },
		{
			env: {
				...NO_KEN_VARIABLES,
				KEN_MODEL: 'm',
				KEN_BASE_URL: 'http://127.0.0.1:9/v1',
				KEN_API_KEY_ENV: 'KEN_NO_KEY',
			},
			names: ['KEN_NO_KEY'],
		},
		{
			env: {
				...NO_KEN_VARIABLES,
				KEN_MODEL: 'm',
				KEN_BASE_URL: 'http://127.0.0.1:9/v1',
				KEN_API_KEY_ENV: 'KEN_SHORT_KEY',
				KEN_SHORT_KEY: 'abc',
			},
			names: ['KEN_SHORT_KEY'],
		},
	]
	for (const { env, names } of cases) {
		const { code, stdout, stderr } = await ken(['ask', 'What changed?', '--repo', root], env)
		assert.equal(code, 2, stderr)
		assert.equal(stdout, '')
		for (const name of names) assert.ok(stderr.includes(name), `the message names ${name}: ${stderr}`)
		assert.doesNotMatch(stderr, /^\s+at /m, 'a plain message, not a stack trace')
	}
})
