import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { checkQuote } from '../../src/checks/index.ts'
import { openSnapshots, takeSnapshot } from '../../src/live/index.ts'
import { gitRepository, parsePath } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) attempt()\n}\n'

// Every file and folder under a directory, with each file's bytes as a hash, its size and its last change, so a file
// rewritten with the same bytes shows too.
function fingerprint(root: string, keep: (name: string) => boolean) {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.map((entry) => path.join(path.relative(root, entry.parentPath), entry.name))
		.filter(keep)
		.sort()
		.map((name) => {
			const info = statSync(path.join(root, name))
			if (info.isDirectory()) return `${name}/`
			const bytes = createHash('sha256')
				.update(readFileSync(path.join(root, name)))
				.digest('hex')
			return `${name} ${bytes} ${info.size} ${info.mtimeMs}`
		})
}

test('a snapshot of uncommitted work reads back through the repository and passes the quote check, and the project does not change', async () => {
	const { root } = buildRepository([
		{
			message: 'feat: retry',
			files: { 'src/retry.ts': RETRY, 'notes.md': '# notes\n', '.gitignore': '*.log\n' },
		},
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	writeFileSync(path.join(root, 'src/retry.ts'), RETRY.replace('attempt()', 'attempt(i)'))
	writeFileSync(path.join(root, 'src/wait.ts'), 'export const WAIT_MS = 100\n')
	unlinkSync(path.join(root, 'notes.md'))
	writeFileSync(path.join(root, 'debug.log'), 'ignored\n')
	writeFileSync(path.join(root, 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 0, 1]))
	writeFileSync(path.join(root, 'dump.txt'), 'x'.repeat(1024 * 1024 + 1))
	const gitBefore = fingerprint(path.join(root, '.git'), () => true)
	const treeBefore = fingerprint(root, (name) => !name.startsWith('.git/') && name !== '.git')

	const repo = gitRepository(root)
	const store = await openSnapshots(home, repo, root)
	const first = await takeSnapshot(store, repo, root)
	if (first.kind !== 'taken') return assert.fail(`ken took no snapshot: ${first.kind}`)

	assert.deepEqual(
		fingerprint(path.join(root, '.git'), () => true),
		gitBefore,
		"the project's .git is unchanged",
	)
	assert.deepEqual(
		fingerprint(root, (name) => !name.startsWith('.git/') && name !== '.git'),
		treeBefore,
		"the project's working tree is unchanged",
	)
	assert.equal(first.leftOut, 2, 'the binary file and the file over the limit stay out')
	const project = await repo.resolve(first.commit)
	assert.equal(project.kind, 'no-commit', 'the project itself cannot find the snapshot')

	const withStore = gitRepository(root, { alternate: store.objects })
	const listed = await withStore.listFiles(first.commit)
	assert.deepEqual(listed.kind === 'ok' ? listed.paths.sort() : listed, ['.gitignore', 'src/retry.ts', 'src/wait.ts'])
	const read = async (file: string) => {
		const at = parsePath(file)
		if (at.kind !== 'ok') return assert.fail(at.reason)
		const text = await withStore.readFile(first.commit, at.path)
		return text.kind === 'ok' ? text.text : text.kind
	}
	assert.equal(await read('src/wait.ts'), 'export const WAIT_MS = 100\n')
	const quote = { path: 'src/retry.ts', commit: first.commit, text: '\tfor (let i = 0; i < times; i++) attempt(i)' }
	const checked = await checkQuote(withStore, quote)
	assert.equal(checked.kind, 'verified', JSON.stringify(checked))

	const second = await takeSnapshot(store, repo, root)
	assert.deepEqual(second, first, 'the same work on the same HEAD is the same snapshot')
	assert.deepEqual(
		fingerprint(path.join(root, '.git'), () => true),
		gitBefore,
		'still unchanged after a second one',
	)
})
