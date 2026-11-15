import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type CommitHash, gitRepository, parsePath, type RepoPath } from '../../src/repo/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'

const COLLABORATOR = { name: 'Bo Helper', email: 'bo@example.com' }

const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/app.ts': "export function greet(name: string) {\n\treturn greeting(name)\n}\nexport const part = 'bye'\n",
			'src/old_name.py':
				'def total(items):\n    result = 0\n    for item in items:\n        result += item\n    return result\n',
			'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
		},
	},
	{
		message: 'feat: greet loudly',
		author: COLLABORATOR,
		files: {
			'src/app.ts':
				"export function greet(name: string) {\n\treturn shout(greeting(name))\n}\nexport const part = 'bye'\n",
			'.ken/record.jsonl': '{"kind":"note"}\n',
		},
	},
	{ message: 'chore: update the record', files: { '.ken/record.jsonl': '{"kind":"note"}\n{"kind":"topic"}\n' } },
	{
		message: 'refactor: rename total and drop part',
		files: {
			'src/app.ts': 'export function greet(name: string) {\n\treturn shout(greeting(name))\n}\n',
			'src/old_name.py': null,
			'src/new_name.py':
				'def total(items):\n    result = 0\n    for item in items:\n        result += item\n    return int(result)\n',
			'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 3, 4]),
		},
	},
])
const repo = gitRepository(root)

async function commitAt(ref: string): Promise<CommitHash> {
	const resolved = await repo.resolve(ref)
	return resolved.kind === 'ok' ? resolved.commit : assert.fail(`${ref} did not resolve`)
}

function pathOf(raw: string): RepoPath {
	const parsed = parsePath(raw)
	return parsed.kind === 'ok' ? parsed.path : assert.fail(`${raw} was refused`)
}

test('a ref or path a model could pass as an option, or to leave the repository, is refused', async () => {
	for (const ref of ['-n', '--output=/tmp/ken-pwned', '']) {
		assert.equal((await repo.resolve(ref)).kind, 'refused', ref)
	}
	for (const raw of ['-rf', './-rf', '../secret', 'src/../../secret', '/etc/passwd', '.', 'a\0b']) {
		assert.equal(parsePath(raw).kind, 'refused', raw)
	}
	assert.deepEqual(await repo.resolve('no-such-branch'), { kind: 'no-commit', ref: 'no-such-branch' })
	assert.equal(await commitAt('HEAD~3'), hashes[0])
	assert.deepEqual(parsePath('./src//app.ts'), { kind: 'ok', path: 'src/app.ts' })
})

test('log lists who changed what and when, and leaves out commits and paths in .ken/', async () => {
	const result = await repo.log({ base: await commitAt('HEAD~3'), head: await commitAt('HEAD') })
	assert.deepEqual(result, {
		kind: 'ok',
		commits: [
			{
				hash: hashes[3],
				author: OWNER.name,
				email: OWNER.email,
				date: '2026-01-04T00:00:00.000Z',
				subject: 'refactor: rename total and drop part',
				paths: ['logo.png', 'src/app.ts', 'src/new_name.py', 'src/old_name.py'],
			},
			{
				hash: hashes[1],
				author: COLLABORATOR.name,
				email: COLLABORATOR.email,
				date: '2026-01-02T00:00:00.000Z',
				subject: 'feat: greet loudly',
				paths: ['src/app.ts'],
			},
		],
	})
	const diff = await repo.diff({ base: await commitAt('HEAD~3'), head: await commitAt('HEAD~1') })
	assert.deepEqual(diff.kind === 'ok' && diff.files.map((file) => file.path), ['src/app.ts'])
})

test('diff gives each hunk its old and new lines, a rename its old path, and a binary file no hunks', async () => {
	const result = await repo.diff({ base: await commitAt('HEAD~1'), head: await commitAt('HEAD') })
	assert.deepEqual(result, {
		kind: 'ok',
		files: [
			{ kind: 'binary', path: 'logo.png', oldPath: 'logo.png' },
			{
				kind: 'text',
				path: 'src/app.ts',
				oldPath: 'src/app.ts',
				hunks: [{ oldStart: 4, oldLength: 1, newStart: 3, newLength: 0, lines: ["-export const part = 'bye'"] }],
			},
			{
				kind: 'text',
				path: 'src/new_name.py',
				oldPath: 'src/old_name.py',
				hunks: [
					{
						oldStart: 5,
						oldLength: 1,
						newStart: 5,
						newLength: 1,
						lines: ['-    return result', '+    return int(result)'],
					},
				],
			},
		],
	})
})

test('search reads the commit it is given, and reports a pattern that does not compile', async () => {
	assert.deepEqual(await repo.search(await commitAt('HEAD~3'), 'return greeting'), {
		kind: 'ok',
		matches: [{ path: 'src/app.ts', line: 2, text: '\treturn greeting(name)' }],
	})
	assert.deepEqual(await repo.search(await commitAt('HEAD'), 'return greeting'), { kind: 'ok', matches: [] })
	assert.equal((await repo.search(await commitAt('HEAD'), '(')).kind, 'bad-pattern')
})

test('blame names the commit that last changed each line, and reports a missing file or a range past the end', async () => {
	const head = await commitAt('HEAD')
	const result = await repo.blame(head, pathOf('src/app.ts'), { start: 1, end: 2 })
	assert.deepEqual(result.kind === 'ok' && result.lines.map(({ line, commit, email }) => ({ line, commit, email })), [
		{ line: 1, commit: hashes[0], email: OWNER.email },
		{ line: 2, commit: hashes[1], email: COLLABORATOR.email },
	])
	assert.equal((await repo.blame(head, pathOf('src/app.ts'), { start: 5, end: 9 })).kind, 'bad-lines')
	assert.equal((await repo.blame(head, pathOf('src/old_name.py'), { start: 1, end: 1 })).kind, 'no-file')
})
