import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test("with no change asked, the view lays the reader's uncommitted work over the boxes, else their branch against main, else nothing", async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n' } },
		{ message: 'feat: side work', files: { 'src/b/y.ts': 'y\ny2\n' } },
	])
	git(root, ['branch', '--force', 'feature', hashes[1] ?? ''])
	git(root, ['reset', '--quiet', '--hard', hashes[0] ?? ''])
	const sources = await sourcesFor(root)
	const touched = (seen: LayoutLook) => seen.boxes.filter((each) => each.touched).map((each) => each.name)

	const onMain = await look(sources, { within: ['src'] })
	assert.equal(onMain.change, null, 'on main with nothing uncommitted there is nothing to lay over')

	git(root, ['checkout', '--quiet', 'feature'])
	const onBranch = await look(sources, { within: ['src'] })
	assert.equal(onBranch.change?.name, 'feature')
	assert.deepEqual(touched(onBranch), ['b'])

	writeFileSync(path.join(root, 'src/a/x.ts'), 'x\nnot committed\n')
	const working = await look(sources, { within: ['src'] })
	assert.equal(working.change?.name, 'Uncommitted work')
	assert.deepEqual(touched(working), ['a'], 'uncommitted work comes before the branch')
	assert.equal((await look(sources, { within: ['src'], change: 'none' })).change, null)
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
	assert.match(after.next.line, /\ba\b.*\bb\b/, 'the changed box comes before the unmet one')
})

test('the line over the level and the line on each box say the same of the map, so a part the reader asked about and did not say they understand is never called done', async () => {
	const { root } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/retry.ts': 'retry()\n', 'src/b/quote.ts': 'check(quote)\n' } },
	])
	const sources = await sourcesFor(root)
	const appended = await sources.record.append([
		{ kind: 'topic', name: 'retry', quotes: [{ path: 'src/a/retry.ts', commit: 'HEAD', text: 'retry()' }] },
		{ kind: 'topic', name: 'quote check', quotes: [{ path: 'src/b/quote.ts', commit: 'HEAD', text: 'check(quote)' }] },
	])
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
	await sources.map.learn('know', ['retry'], NOW)
	await sources.map.learn('asked', ['quote check'], NOW)

	const asked = await look(sources, { within: ['src'] })
	assert.deepEqual(
		asked.boxes.map((each) => [each.name, each.map.standing]),
		[
			['a', 'understood'],
			['b', 'open'],
		],
	)
	assert.deepEqual(asked.next.open, ['b'])
	assert.match(asked.next.line, /\bb\b.*not said you understand/, 'the level names the part the box says is not done')
	assert.doesNotMatch(asked.next.line, /every part/)

	await sources.map.learn('know', ['quote check'], NOW)
	const done = await look(sources, { within: ['src'] })
	assert.ok(done.boxes.every((each) => each.map.standing === 'understood'))
	assert.match(done.next.line, /every part/)
})

test('a commit, a path or a change the project does not have is refused before ken reads git with it', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } }])
	const sources = await sourcesFor(root)
	for (const raw of [{ at: 'nope' }, { within: ['../outside'] }, { change: 'main..nope' }, { change: 'nope' }]) {
		assert.equal((await readLayoutAsk(sources, raw)).kind, 'refused', JSON.stringify(raw))
	}
})

type Part = { name: string; job: string; paths: string[] }
type Arrow = { from: string; to: string; text: string; quotes: { path: string; commit: string; text: string }[] }

async function name(sources: LayoutSources, within: string[], parts: Part[], arrows: Arrow[] = [], at = 'HEAD') {
	const read = await sources.record.read()
	const before = read.current.findLast((entry) => entry.kind === 'layout' && entry.within.join() === within.join())
	const appended = await sources.record.append([{ kind: 'layout', within, at, parts, arrows, replaces: before?.id }])
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
}

test('at an old commit the view shows the version of a named level that fit the code then, and at HEAD the newest', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n' } },
		{ message: 'feat: add c, change a', files: { 'src/a/x.ts': 'x2\n', 'src/c/z.ts': 'z\n' } },
	])
	const sources = await sourcesFor(root)
	await name(
		sources,
		['src'],
		[
			{ name: 'Alpha', job: 'does a', paths: ['src/a'] },
			{ name: 'Beta', job: 'does b', paths: ['src/b'] },
		],
		[],
		hashes[0],
	)
	await name(
		sources,
		['src'],
		[
			{ name: 'Alpha', job: 'does a', paths: ['src/a'] },
			{ name: 'Rest', job: 'does b and c', paths: ['src/b', 'src/c'] },
		],
	)
	const parts = (seen: LayoutLook) => seen.boxes.map((each) => [each.name, each.state])

	const old = await look(sources, { within: ['src'], at: hashes[0] })
	assert.deepEqual(
		parts(old),
		[
			['Alpha', 'changed'],
			['Beta', 'same'],
		],
		'at an old commit each part says whether it was different then from now',
	)
	assert.equal(old.named?.stale, false)
	const now = await look(sources, { within: ['src'] })
	assert.deepEqual(parts(now), [
		['Alpha', 'same'],
		['Rest', 'same'],
	])
	assert.deepEqual(box(now, 'Rest')?.job, 'does b and c')
})

test('a commit inside one named part marks that part changed and its arrows possibly stale, and a new folder beside the parts says the drawing no longer fits', async () => {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: {
				'src/server/serve.ts': "import { answer } from '../agent/answer.ts'\n",
				'src/agent/answer.ts': "import { save } from '../store/save.ts'\n",
				'src/store/save.ts': 'export function save() {}\n',
			},
		},
	])
	const sources = await sourcesFor(root)
	const quote = (path: string, text: string) => [{ path, commit: 'HEAD', text }]
	await name(
		sources,
		[],
		[
			{ name: 'Server', job: 'serves', paths: ['src/server'] },
			{ name: 'Engine', job: 'answers', paths: ['src/agent'] },
			{ name: 'Store', job: 'saves', paths: ['src/store'] },
		],
		[
			{
				from: 'Server',
				to: 'Engine',
				text: 'asks',
				quotes: quote('src/server/serve.ts', "import { answer } from '../agent/answer.ts'"),
			},
			{
				from: 'Engine',
				to: 'Store',
				text: 'saves to',
				quotes: quote('src/agent/answer.ts', "import { save } from '../store/save.ts'"),
			},
		],
	)
	const fresh = await look(sources, {})
	assert.equal(fresh.named?.stale, false)
	assert.deepEqual(fresh.loose, [])

	writeFileSync(path.join(root, 'src/agent/answer.ts'), "import { save } from '../store/save.ts'\nsave()\n")
	git(root, ['commit', '--quiet', '--all', '--message', 'fix: the engine saves'])
	const after = await look(sources, {})
	assert.deepEqual(
		after.boxes.map((each) => [each.name, each.state]),
		[
			['Server', 'same'],
			['Engine', 'changed'],
			['Store', 'same'],
		],
	)
	assert.deepEqual(
		after.arrows.map((each) => [each.from, each.stale]),
		[
			['Server', false],
			['Engine', true],
		],
	)
	assert.equal(after.named?.stale, true)

	mkdirSync(path.join(root, 'src/tools'))
	writeFileSync(path.join(root, 'src/tools/t.ts'), 'tool\n')
	git(root, ['add', 'src/tools/t.ts'])
	git(root, ['commit', '--quiet', '--message', 'feat: a tool'])
	assert.deepEqual((await look(sources, {})).named?.added, ['src/tools'], 'the new folder, not src, which holds parts')
})

test('a named part opens to the level named for its paths, or to the folders inside it', async () => {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/engine/run/a.ts': 'a\n', 'src/engine/check/b.ts': 'b\n', 'src/page/p.js': 'p\n' },
		},
	])
	const sources = await sourcesFor(root)
	await name(
		sources,
		[],
		[
			{ name: 'Engine', job: 'runs and checks', paths: ['src/engine'] },
			{ name: 'Page', job: 'shows it', paths: ['src/page'] },
		],
	)
	const engine = box(await look(sources, {}), 'Engine')
	assert.ok(engine?.opens)

	const folders = await look(sources, { within: engine.paths })
	assert.equal(folders.named, null)
	assert.deepEqual(
		folders.boxes.map((each) => each.name),
		['check', 'run'],
	)

	await name(
		sources,
		['src/engine'],
		[
			{ name: 'Runner', job: 'runs', paths: ['src/engine/run'] },
			{ name: 'Checker', job: 'checks', paths: ['src/engine/check'] },
		],
	)
	const named = await look(sources, { within: engine.paths })
	assert.deepEqual(
		named.boxes.map((each) => [each.name, each.job]),
		[
			['Runner', 'runs'],
			['Checker', 'checks'],
		],
	)
})
