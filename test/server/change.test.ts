import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository, type FixtureCommit } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

const lines = (count: number, prefix = 'line') =>
	Array.from({ length: count }, (_, at) => `${prefix} ${at + 1}\n`).join('')
const layoutOf = (change: string, within = '') =>
	`/api/layout?change=${encodeURIComponent(change)}${within && `&within=${within}`}`

test('a change laid over the picture lists its commits newest first without the merge, and each box its changed files; inside a part the counts are of that part alone', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/z.ts': 'z\n', 'docs/d.md': 'd\n' } },
		{ message: 'feat: side', files: { 'src/a/y.ts': 'y\ny\n' }, parent: 0 },
		{ message: 'feat: main', files: { 'src/b/z.ts': 'zed\n', 'docs/d.md': 'd\nmore\n' }, parent: 0 },
		{ message: 'Merge pull request #5 from someone/side', files: {}, merge: 1 },
	])
	const server = await openKen(root, readerHome())
	const change = `${hashes[0]}..${hashes[3]}`

	const top = (await json(server, layoutOf(change))).look
	assert.deepEqual(
		top.change.commits.map((each: { hash: string; subject: string }) => [each.hash, each.subject]),
		[
			[hashes[2], 'feat: main'],
			[hashes[1], 'feat: side'],
		],
	)
	assert.deepEqual(Object.keys(top.change.commits[0]).sort(), ['author', 'date', 'hash', 'subject'])
	assert.equal(top.change.moreCommits, 0)
	const src = top.boxes.find((box: { name: string }) => box.name === 'src')
	assert.deepEqual(src.touched, {
		files: 2,
		added: 3,
		removed: 1,
		paths: [
			{ path: 'src/a/y.ts', added: 2, removed: 0 },
			{ path: 'src/b/z.ts', added: 1, removed: 1 },
		],
		morePaths: 0,
	})
	assert.equal(top.change.files, 3)

	const inside = (await json(server, layoutOf(change, 'src'))).look
	assert.deepEqual(
		[inside.change.files, inside.change.outside],
		[2, []],
		'the changed doc is outside src, so it is neither counted nor named there',
	)
})

test("uncommitted work laid over the picture has no commits, since ken's snapshot of it is no commit of the project", async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a.ts': 'a\n' } }])
	const server = await openKen(root, readerHome())
	writeFileSync(path.join(root, 'src/a.ts'), 'a\nb\n')

	const { look } = await json(server, layoutOf('uncommitted'))
	assert.deepEqual([look.change.commits, look.change.moreCommits, look.change.files], [[], 0, 1])
})

test('a change with more commits or more files in a box than the page lists says how many it left out', async () => {
	const many: Record<string, string> = {}
	for (let file = 0; file < 23; file++) many[`src/f${String(file).padStart(2, '0')}.ts`] = 'new\n'
	const commits: FixtureCommit[] = [{ message: 'feat: start', files: { 'src/a.ts': 'a\n' } }]
	for (let n = 1; n <= 52; n++)
		commits.push({ message: `feat: step ${n}`, files: n === 52 ? many : { 'n.txt': `${n}\n` } })
	const { root, hashes } = buildRepository(commits)
	const server = await openKen(root, readerHome())

	const { look } = await json(server, layoutOf(`${hashes[0]}..${hashes[52]}`))
	assert.deepEqual(
		[look.change.commits.length, look.change.commits[0].subject, look.change.moreCommits],
		[50, 'feat: step 52', 2],
	)
	const { touched } = look.boxes.find((box: { name: string }) => box.name === 'src')
	assert.deepEqual([touched.files, touched.paths.length, touched.morePaths], [23, 20, 3])
})

test('a range whose commits list more file names than git hands ken is still laid out, with the newest 50 commits and a count of the rest', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: { 'src/a.ts': 'a\n' } }])
	// 1100 commits that each change the same 64 long-named files list about 18 MB of names, past git's 16 MB limit.
	const files = Array.from({ length: 64 }, (_, at) => `src/${'deep/'.repeat(48)}f${at}.ts`)
	let stream = ''
	for (let n = 1; n <= 1100; n++) {
		const from = n === 1 ? `from ${hashes[0]}\n` : ''
		stream += `commit refs/heads/main\ncommitter Ada <ada@example.com> ${1767225600 + n} +0000\ndata ${`step ${n}`.length}\nstep ${n}\n${from}`
		for (const file of files) stream += `M 100644 inline ${file}\ndata ${`${n}\n`.length}\n${n}\n`
	}
	execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: stream })
	execFileSync('git', ['reset', '--quiet', '--hard'], { cwd: root })
	const server = await openKen(root, readerHome())

	const { look } = await json(server, layoutOf(`${hashes[0]}..main`))
	assert.deepEqual(
		[look.change.commits.length, look.change.commits[0].subject, look.change.moreCommits],
		[50, 'step 1100', 1050],
	)
})

test('a change asked as a span of time is the commits since then, a span with no commit is refused, and the change lens takes a span too', async () => {
	// The fixture dates commit n at midnight UTC on 2026-01-01 plus n days.
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a.ts': 'a\n' } },
		{ message: 'feat: second day', files: { 'src/a.ts': 'a\nb\n' } },
		{ message: 'feat: third day', files: { 'src/a.ts': 'a\nb\nc\n' } },
	])
	const [, second = '', third = ''] = hashes
	const model = await scriptedModel([{ text: 'It adds c.' }])
	const server = await openKen(root, readerHome(), model.baseUrl)

	const { look } = await json(server, layoutOf('since:2026-01-02'))
	assert.deepEqual(look.change.range, { base: second, head: third })
	assert.equal(look.change.asked, 'since:2026-01-02', 'the same text asks for the span again')
	assert.deepEqual(
		look.change.commits.map((each: { subject: string }) => each.subject),
		['feat: third day'],
	)

	const quiet = await call(server, layoutOf('since:1d'))
	assert.equal(quiet.status, 400, 'the fixture has no commit in the last day')
	assert.equal(JSON.parse(quiet.text).field, 'change')
	assert.equal((await call(server, layoutOf('since:soon'))).status, 400)

	const lens = (change: string) => ({ lens: { kind: 'change', change, want: 'story' } })
	assert.equal((await call(server, '/api/questions', lens('since:1d'))).status, 400)
	assert.equal(model.requests.length, 0, 'a span with no commit never reaches the model')
	const asked = await ask(server, lens('since:2026-01-02'))
	const replied = asked.find((line) => line.kind === 'replied')
	assert.deepEqual([replied.reply.change.base, replied.reply.change.head], [second, third])
})

test('the diff of a change comes from git for the files asked, as hunks with their line numbers, cut after 400 changed lines, and names the asked files that are binary', async () => {
	const { root, hashes } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/a.ts': 'one\ntwo\nthree\n', 'src/b.ts': 'b\n', 'src/big.ts': 'top\n', 'src/same.ts': 's\n' },
		},
		{
			message: 'feat: more',
			files: {
				'src/a.ts': 'one\n2\nthree\n',
				'src/b.ts': 'b\nbee\n',
				'src/big.ts': `top\n${lines(500)}`,
				'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
			},
		},
	])
	const server = await openKen(root, readerHome())
	const diffOf = (paths: string[], change = `${hashes[0]}..${hashes[1]}`) =>
		`/api/change/diff?change=${encodeURIComponent(change)}${paths.map((each) => `&path=${each}`).join('')}`

	const one = await json(server, diffOf(['src/a.ts']))
	assert.deepEqual(one, {
		hunks: [
			{
				path: 'src/a.ts',
				oldPath: 'src/a.ts',
				hunk: { oldStart: 2, oldLength: 1, newStart: 2, newLength: 1, lines: ['-two', '+2'] },
			},
		],
		cut: false,
		binary: [],
		tooLarge: false,
	})

	const why = await json(server, diffOf(['logo.png', 'src/same.ts']))
	assert.deepEqual(why, { hunks: [], cut: false, binary: ['logo.png'], tooLarge: false }, 'src/same.ts did not change')

	const big = await json(server, diffOf(['src/b.ts', 'src/big.ts']))
	const changed = big.hunks.flatMap((each: { hunk: { lines: string[] } }) =>
		each.hunk.lines.filter((line) => /^[+-]/.test(line)),
	)
	assert.deepEqual([changed.length, changed[0], changed.at(-1), big.cut], [400, '+bee', '+line 399', true])
	const last = big.hunks.at(-1).hunk
	assert.deepEqual([last.oldLength, last.newLength], [0, 399], 'the hunk that was cut counts the lines it still has')

	const eleven = Array.from({ length: 11 }, (_, at) => `src/f${at}.ts`)
	for (const refused of [diffOf(eleven), diffOf([]), diffOf(['src/a.ts'], 'nope..HEAD'), diffOf(['../outside'])]) {
		assert.equal((await call(server, refused)).status, 400, refused)
	}
})
