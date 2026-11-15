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

test('ken ask --json prints the checked answer, with its quote read from git', async () => {
	const model = await scriptedModel([
		{
			tool: 'ken__answer',
			args: {
				scope: { base, head },
				summary: 'total now adds the items.',
				statements: [
					{
						text: 'total returns the sum of the items instead of 0.',
						label: 'inferred',
						quotes: [{ path: 'app.py', commit: head, text: '    return sum(items)' }],
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
	]
	for (const { env, names } of cases) {
		const { code, stdout, stderr } = await ken(['ask', 'What changed?', '--repo', root], env)
		assert.equal(code, 2)
		assert.equal(stdout, '')
		for (const name of names) assert.ok(stderr.includes(name), `the message names ${name}: ${stderr}`)
	}
})
