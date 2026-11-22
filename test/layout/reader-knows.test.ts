import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { type LayoutLook, type LayoutSources, lookAtLayout, readLayoutAsk } from '../../src/layout/index.ts'
import type { Looked } from '../../src/map/index.ts'
import type { CommitHash } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { sourcesFor } from '../fixtures/layout-sources.ts'

const NOW = new Date('2026-11-17T10:00:00Z')
const START = { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n', 'src/c/z.ts': 'z\n' }

async function look(sources: LayoutSources, within = ['src']): Promise<LayoutLook> {
	const read = await readLayoutAsk(sources, { within, change: 'none' }, NOW)
	if (read.kind !== 'ok') assert.fail(read.message)
	return await lookAtLayout(sources, read.ask, NOW)
}

// Commits a new content for each file and answers with the new HEAD.
function commit(root: string, files: Record<string, string>): CommitHash {
	const git = (args: string[]) =>
		execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }).trim()
	for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text)
	git(['commit', '--quiet', '--all', '--message', `change ${Object.keys(files).join(' ')}`])
	return git(['rev-parse', 'HEAD']) as CommitHash
}

// The reader did one thing, some minutes after NOW's hour began, while the project was at head.
async function did(sources: LayoutSources, minute: number, head: string, looked: object) {
	const at = new Date(Date.UTC(2026, 10, 17, 9, minute))
	await sources.seen.add(looked as Looked, head as CommitHash, at)
}

const knows = (seen: LayoutLook) => Object.fromEntries(seen.boxes.map((box) => [box.name, box.knows]))

test('a part the reader read counts the commits that touched it since, and a part they read that nobody touched or one they never opened counts none', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const sources = await sourcesFor(root)
	await did(sources, 1, hashes[0] ?? '', { did: 'read', paths: ['src/a'] })
	await did(sources, 2, hashes[0] ?? '', { did: 'read', paths: ['src/c'] })
	commit(root, { 'src/a/x.ts': 'x2\n' })
	commit(root, { 'src/b/y.ts': 'y2\n' })
	commit(root, { 'src/a/x.ts': 'x3\n' })

	const { a, b, c } = knows(await look(sources))
	assert.deepEqual([a?.level, a?.since, a?.stale, a?.last], ['read', 2, true, '2026-11-17'])
	assert.deepEqual([b?.level, b?.since, b?.stale, b?.last], ['new', 0, false, null], 'a commit there is no news of it')
	assert.deepEqual([c?.level, c?.since, c?.stale], ['read', 0, false])
})

test('"Not right" after "I know this part" leaves the part seen, and a line broken by hand is skipped and named while the lines around it still count', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const [head = ''] = hashes
	const sources = await sourcesFor(root)
	await did(sources, 1, head, { did: 'said', paths: ['src/a'] })
	await did(sources, 2, head, { did: 'said', paths: ['src/b'] })
	assert.equal(knows(await look(sources)).a?.level, 'said')
	await did(sources, 3, head, { did: 'forgot', paths: ['src/a'] })

	const taken = await look(sources)
	assert.deepEqual([knows(taken).a?.level, knows(taken).b?.level], ['seen', 'said'])
	assert.equal(taken.boxes.find((box) => box.name === 'a')?.map.standing, 'open', 'the picture says the same')

	const typed = { at: '2026-11-17T09:30:00Z', did: 'code', paths: ['src/a/x.ts'], head }
	appendFileSync(
		sources.seen.file,
		`{"at": "2026-11-17T09:20:00Z", "did": "code", "paths": \n${JSON.stringify(typed)}\n`,
	)
	assert.equal(knows(await look(sources)).a?.level, 'code', 'a line on one file counts for the part that holds it')
	const { problems } = await sources.seen.read()
	assert.equal(problems.length, 1)
	assert.match(problems[0] ?? '', /Line 4\b/)
})

test('a change the reader walked through up to HEAD clears the commits since for the paths it names and no others, and a commit the project no longer has counts none', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const [start = ''] = hashes
	const sources = await sourcesFor(root)
	for (const [minute, part] of ['src/a', 'src/b', 'src/c'].entries()) {
		await did(sources, minute, start, { did: 'read', paths: [part] })
	}
	commit(root, { 'src/a/x.ts': 'x2\n', 'src/b/y.ts': 'y2\n' })
	const head = commit(root, { 'src/a/x.ts': 'x3\n', 'src/c/z.ts': 'z2\n' })
	const since = (seen: LayoutLook) => Object.fromEntries(seen.boxes.map((box) => [box.name, box.knows.since]))
	assert.deepEqual(since(await look(sources)), { a: 2, b: 1, c: 1 })

	const change = { base: start, head }
	// Read while the project was still at the first commit, so only the change's own last commit says they are current.
	await did(sources, 10, start, { did: 'change', paths: ['src/a/x.ts'], change })
	await did(sources, 30, 'f'.repeat(40), { did: 'read', paths: ['src/c'] })
	const after = await look(sources)
	assert.deepEqual(since(after), { a: 0, b: 1, c: 0 })
	assert.deepEqual(
		[knows(after).a?.level, knows(after).a?.stale],
		['read', false],
		'a change read is not the part read',
	)
	assert.match(knows(after).c?.why ?? '', /commit/, 'ken says it could not find the commit they last looked at')
	assert.doesNotMatch(knows(after).a?.why ?? '', /commit/)
})

test('what to look at next leads with the part that changed since the reader read it, then their uncommitted work, then the tour, then the parts they never opened', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: { ...START, 'src/d/w.ts': 'w\n' } }])
	const [start = ''] = hashes
	const sources = await sourcesFor(root)
	const parts = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, index) => ({
		name,
		job: `does ${name}`,
		paths: [`src/${'abcd'[index]}`],
	}))
	const named = await sources.record.append([{ kind: 'layout', within: ['src'], at: 'HEAD', parts, arrows: [] }])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	await did(sources, 1, start, { did: 'read', paths: ['src/c'] })
	await did(sources, 2, start, { did: 'opened', paths: ['src/a'] })
	const head = commit(root, { 'src/c/z.ts': 'z2\n' })
	writeFileSync(path.join(root, 'src/b/y.ts'), 'y\nnot committed\n')

	const { items } = (await look(sources)).next
	assert.deepEqual(
		items.map((item) => [item.kind, item.go.way, item.go.part ?? null, item.go.change ?? null]),
		[
			['stale', 'catch-up', 'Gamma', `${start}..${head}`],
			['review', 'review', null, 'uncommitted'],
			['tour', 'learn', 'Alpha', null],
			['read', 'learn', 'Beta', null],
			['read', 'learn', 'Delta', null],
		],
	)
})
