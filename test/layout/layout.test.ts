import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import {
	type LayoutLook,
	type LayoutSources,
	lookAtLayout,
	type RawAsk,
	readLayoutAsk,
} from '../../src/layout/index.ts'
import { openSnapshots } from '../../src/live/index.ts'
import { openMap } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const NOW = new Date('2026-11-17T10:00:00Z')

async function sourcesFor(root: string): Promise<LayoutSources> {
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const store = await openSnapshots(home, gitRepository(root), root)
	const repo = gitRepository(root, { alternate: store.objects })
	const record = fileRecordStore(root, repo)
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the fixture has commits')
	return { root, repo, snapshots: store, record, map: opened.map }
}

async function look(sources: LayoutSources, raw: RawAsk): Promise<LayoutLook> {
	const read = await readLayoutAsk(sources, raw)
	if (read.kind !== 'ok') assert.fail(read.message)
	return await lookAtLayout(sources, read.ask, NOW)
}

function git(root: string, args: string[]) {
	execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore' })
}

const box = (seen: LayoutLook, name: string) => seen.boxes.find((each) => each.name === name)

test('a folder of nine folders shows its five largest and one box for the other four, and opening a box shows the level inside it', async () => {
	const files: Record<string, string> = { 'README.md': '# demo\n', 'package.json': '{}\n' }
	for (const [n, folder] of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].entries()) {
		for (let file = 0; file < 9 - n; file++) files[`src/${folder}/f${file}.ts`] = `${folder}${file}\n`
	}
	const { root } = buildRepository([{ message: 'feat: start', files }])
	const sources = await sourcesFor(root)

	const top = await look(sources, {})
	assert.deepEqual(
		top.boxes.map((each) => [each.name, each.files]),
		[
			['src', 45],
			['Files at the top', 2],
		],
	)

	const src = await look(sources, { within: ['src'] })
	assert.deepEqual(
		src.boxes.map((each) => [each.name, each.files]),
		[
			['a', 9],
			['b', 8],
			['c', 7],
			['d', 6],
			['e', 5],
			['4 more folders', 10],
		],
	)

	const more = box(src, '4 more folders')
	assert.ok(more?.opens)
	const inside = await look(sources, { within: more.paths })
	assert.deepEqual(
		inside.boxes.map((each) => [each.name, each.files]),
		[
			['f', 4],
			['g', 3],
			['h', 2],
			['i', 1],
		],
	)
	const folder = await look(sources, { within: ['src/h'] })
	assert.deepEqual(
		folder.boxes.map((each) => [each.name, each.opens]),
		[
			['f0.ts', false],
			['f1.ts', false],
		],
	)
})

test('at an older commit a box that a later commit changed is changed, one that was not there yet is gone, and a folder HEAD no longer has is named loose', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n', 'src/old/o.ts': 'o\n' } },
		{ message: 'feat: add c, drop old', files: { 'src/c/z.ts': 'z\n', 'src/old/o.ts': null } },
		{ message: 'fix: change a', files: { 'src/a/x.ts': 'x2\n' } },
	])
	const sources = await sourcesFor(root)
	const states = (seen: LayoutLook) => Object.fromEntries(seen.boxes.map((each) => [each.name, each.state]))

	assert.deepEqual(states(await look(sources, { within: ['src'] })), { a: 'same', b: 'same', c: 'same' })
	assert.deepEqual(states(await look(sources, { within: ['src'], at: hashes[1] })), {
		a: 'changed',
		b: 'same',
		c: 'same',
	})
	const first = await look(sources, { within: ['src'], at: hashes[0] })
	assert.deepEqual(states(first), { a: 'changed', b: 'same', c: 'gone' })
	assert.deepEqual(first.loose, ['src/old'])
})

test("a branch's change counts from where it left main, lands its files in their boxes, and names a file in no box as outside; uncommitted work lands the same way", async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n' } },
		{ message: 'feat: more', files: { 'src/b/w.ts': 'w\n' } },
		{ message: 'fix: change a on main', files: { 'src/a/x.ts': 'x2\n' } },
		{ message: 'feat: side work', files: { 'src/b/y.ts': 'y\ny2\ny3\n', 'extra/e.ts': 'e\n' }, parent: 1 },
	])
	git(root, ['branch', 'feature', hashes[3] ?? ''])
	git(root, ['checkout', '--quiet', 'main'])
	const sources = await sourcesFor(root)

	const branch = await look(sources, { within: ['src'], change: 'feature' })
	assert.deepEqual(box(branch, 'b')?.touched, { files: 1, added: 2, removed: 0 })
	assert.equal(
		box(branch, 'a')?.touched,
		null,
		'main moved on in a after the branch left it, and that is not the branch',
	)
	assert.deepEqual(branch.change?.outside, ['extra/e.ts'])
	assert.equal(branch.change?.files, 2)

	writeFileSync(path.join(root, 'src/a/x.ts'), 'x2\nnot committed\n')
	const uncommitted = await look(sources, { within: ['src'], change: 'uncommitted' })
	assert.deepEqual(box(uncommitted, 'a')?.touched, { files: 1, added: 1, removed: 0 })
	assert.equal(box(uncommitted, 'b')?.touched, null)
	assert.deepEqual(uncommitted.change?.outside, [])
})

test('a topic the reader understood whose code then changed marks its box, and that box leads where to look next, before a box whose topics they never met', async () => {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/a/retry.ts': 'retry()\n\tsleep(100)\n', 'src/b/quote.ts': 'check(quote)\n', 'src/c/c.ts': 'c\n' },
		},
	])
	const sources = await sourcesFor(root)
	const appended = await sources.record.append([
		{ kind: 'topic', name: 'retry wait', quotes: [{ path: 'src/a/retry.ts', commit: 'HEAD', text: '\tsleep(100)' }] },
		{ kind: 'topic', name: 'quote check', quotes: [{ path: 'src/b/quote.ts', commit: 'HEAD', text: 'check(quote)' }] },
	])
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
	await sources.map.learn('know', ['retry wait'], NOW)

	const before = await look(sources, { within: ['src'] })
	assert.deepEqual(box(before, 'a')?.topics, [{ topic: 'retry wait', mark: 'understood' }])
	assert.deepEqual([before.next.changed, before.next.unmet], [[], ['b']])

	writeFileSync(path.join(root, 'src/a/retry.ts'), 'retry()\n\tsleep(500)\n')
	git(root, ['commit', '--quiet', '--all', '--message', 'fix: wait longer'])
	const after = await look(sources, { within: ['src'] })
	assert.deepEqual(box(after, 'a')?.topics, [{ topic: 'retry wait', mark: 'changed' }])
	assert.deepEqual(box(after, 'b')?.topics, [{ topic: 'quote check', mark: 'new' }])
	assert.deepEqual(box(after, 'c')?.topics, [])
	assert.deepEqual([after.next.changed, after.next.unmet], [['a'], ['b']])
	assert.match(after.next.line, /^Look next at a\b.*Then at b\b/)
})

test('a commit, a path or a change the project does not have is refused before ken reads git with it', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } }])
	const sources = await sourcesFor(root)
	for (const raw of [{ at: 'nope' }, { within: ['../outside'] }, { change: 'main..nope' }, { change: 'nope' }]) {
		assert.equal((await readLayoutAsk(sources, raw)).kind, 'refused', JSON.stringify(raw))
	}
})
