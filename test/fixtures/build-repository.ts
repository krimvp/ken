import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'

// null deletes the file. A file left out keeps its content from the parent commit. parent is the index of an earlier
// commit to build on, which starts a second line of history; by default a commit builds on the one before it.
export type FixtureCommit = {
	message: string
	files: Record<string, string | Uint8Array | null>
	author?: { name: string; email: string }
	parent?: number
	body?: string
}

export const OWNER = { name: 'Ada Owner', email: 'ada@example.com' }

const FIRST_DAY = Date.UTC(2026, 0, 1) / 1000

// Builds a real git repository in a temp directory, one commit per entry. Commit n is dated 2026-01-01 plus n days
// at midnight UTC. The directory is removed when the test file ends.
export function buildRepository(commits: FixtureCommit[]): { root: string; hashes: string[] } {
	const root = mkdtempSync(path.join(tmpdir(), 'ken-repo-'))
	after(() => rmSync(root, { recursive: true, force: true }))
	const git = (args: string[], env: Record<string, string> = {}) =>
		execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, ...env },
		}).trim()

	git(['init', '--quiet', '--initial-branch=main'])
	git(['config', 'user.email', OWNER.email])
	const hashes: string[] = []
	for (const [day, { message, files, author = OWNER, parent, body }] of commits.entries()) {
		if (parent !== undefined) git(['checkout', '--quiet', '--detach', hashes[parent] ?? ''])
		for (const [file, content] of Object.entries(files)) {
			const full = path.join(root, file)
			if (content === null) {
				rmSync(full)
				continue
			}
			mkdirSync(path.dirname(full), { recursive: true })
			writeFileSync(full, content)
		}
		const date = `${FIRST_DAY + day * 86400} +0000`
		git(['add', '--all'])
		const bodyArgs = body === undefined ? [] : ['--message', body]
		git(['commit', '--quiet', '--no-verify', '--message', message, ...bodyArgs], {
			GIT_AUTHOR_NAME: author.name,
			GIT_AUTHOR_EMAIL: author.email,
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_NAME: author.name,
			GIT_COMMITTER_EMAIL: author.email,
			GIT_COMMITTER_DATE: date,
		})
		hashes.push(git(['rev-parse', 'HEAD']))
	}
	return { root, hashes }
}
