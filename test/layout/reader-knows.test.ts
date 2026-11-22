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

test('opening a group of files leaves each file new until its own brief is opened', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const sources = await sourcesFor(root)
	const [head = ''] = hashes
	const group = ['src/a/x.ts', 'src/b/y.ts']
	await did(sources, 1, head, { did: 'opened', paths: group })
	assert.equal(knows(await look(sources, group))['x.ts']?.level, 'new')
	await did(sources, 2, head, { did: 'opened', paths: ['src/a/x.ts'] })
	assert.match(knows(await look(sources, group))['x.ts']?.why ?? '', /opened it once/)
})

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

test('what to look at next leads with the part that changed since the reader read it, then for a reader who read less than half the parts the tour before their uncommitted work, then the parts they never opened', async () => {
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
	commit(root, { 'src/c/z.ts': 'z2\n' })
	const head = commit(root, { 'src/c/z.ts': 'z3\n' })
	writeFileSync(path.join(root, 'src/b/y.ts'), 'y\nnot committed\n')

	const seen = await look(sources)
	const { items } = seen.next
	assert.deepEqual(
		items.map((item) => [item.kind, item.go.way, item.go.part ?? null, item.go.detail, item.go.change ?? null]),
		[
			['stale', 'catch-up', 'Gamma', 'code', `${start}..${head}`],
			['tour', 'learn', 'Alpha', 'how', null],
			['review', 'review', null, 'how', 'uncommitted'],
			['read', 'learn', 'Beta', 'big', null],
			['read', 'learn', 'Delta', 'big', null],
		],
	)
	assert.deepEqual(
		items.map((item) => item.parts),
		[['Gamma'], ['Alpha'], ['Beta'], ['Beta'], ['Delta']],
		'each item names the boxes it is about, and the review the box the uncommitted work touched',
	)
	assert.deepEqual(items[0]?.landed, { files: 1, added: 1, removed: 1 })
	assert.deepEqual(items[2]?.size, { files: 1, what: 'your uncommitted work' })
	for (const item of items.filter((each) => each.kind !== 'review')) {
		const { part, ...opens } = item.go
		assert.deepEqual(seen.boxes.find((box) => box.name === part)?.knows.go, opens, `${part} opens where its item goes`)
	}

	await did(sources, 3, head, { did: 'read', paths: ['src/d'] })
	assert.deepEqual(
		(await look(sources)).next.items.map((item) => item.kind),
		['stale', 'review', 'tour', 'read'],
		'a reader who read half the parts sees their uncommitted work before the tour',
	)
})

test('a correction sets the level the reader picks in place of what came before, and only "I know it" clears the commits that landed since they looked', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const [start = ''] = hashes
	const sources = await sourcesFor(root)
	await did(sources, 1, start, { did: 'code', paths: ['src/a/x.ts'] })
	const head = commit(root, { 'src/a/x.ts': 'x2\n' })
	const a = async () => knows(await look(sources)).a

	await did(sources, 2, head, { did: 'set', level: 'read', paths: ['src/a'] })
	const down = await a()
	assert.deepEqual([down?.level, down?.since, down?.stale], ['read', 1, true], 'it still says the part changed')
	assert.deepEqual(down?.go, { way: 'catch-up', detail: 'code', change: `${start}..${head}` })

	await did(sources, 3, head, { did: 'set', level: 'said', paths: ['src/a'] })
	const known = await a()
	assert.deepEqual([known?.level, known?.since, known?.stale], ['said', 0, false])
	assert.deepEqual(known?.go, { way: 'learn', detail: 'code' })

	await did(sources, 4, head, { did: 'set', level: 'new', paths: ['src/a'] })
	const fresh = await a()
	assert.deepEqual([fresh?.level, fresh?.stale, fresh?.go], ['new', false, { way: 'learn', detail: 'big' }])
})

test('a change the reader walks through after reading the part at HEAD does not count again the commits they already read', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const [start = ''] = hashes
	const sources = await sourcesFor(root)
	const merged = commit(root, { 'src/a/x.ts': 'x2\n' })
	const head = commit(root, { 'src/a/x.ts': 'x3\n' })
	await did(sources, 1, head, { did: 'code', paths: ['src/a'] })
	// Later the reader walks through the older change, which ended one commit before HEAD.
	await did(sources, 5, head, { did: 'change', paths: ['src/a/x.ts'], change: { base: start, head: merged } })
	const { a } = knows(await look(sources))
	assert.deepEqual([a?.since, a?.stale], [0, false])
})

test('a change to review comes before a part one commit touched since the reader read it, and after it when they said they know that part', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: START }])
	const sources = await sourcesFor(root)
	await did(sources, 1, hashes[0] ?? '', { did: 'read', paths: ['src/a'] })
	commit(root, { 'src/a/x.ts': 'x2\n' })
	writeFileSync(path.join(root, 'src/b/y.ts'), 'y\nnot committed\n')
	const kinds = async () => (await look(sources)).next.items.slice(0, 2).map((item) => item.kind)
	assert.deepEqual(await kinds(), ['review', 'stale'])
	await did(sources, 2, hashes[0] ?? '', { did: 'said', paths: ['src/a'] })
	assert.deepEqual(await kinds(), ['stale', 'review'])
})
