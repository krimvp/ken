import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository, type FixtureCommit } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, toolResults } from '../fixtures/scripted-model.ts'

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
	const model = await scriptedModel([{ text: 'It adds a side and changes main.' }, { text: 'Nothing I can see.' }])
	const server = await openKen(root, readerHome(), model.baseUrl)
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
	assert.equal(top.change.merges, 1, 'the merge is counted apart')
	const [asked] = await ask(server, { lens: { kind: 'change', change, want: 'story' } })
	assert.match(asked.question, /2 commits and 1 merge/, 'and the question ken writes about the change counts the same')
	const name = asked.question.match(/^What did (.+) do, and why\?$/m)?.[1]
	assert.ok(name, asked.question)
	const [risks] = await ask(server, { lens: { kind: 'change', change, want: 'risks' } })
	assert.ok(
		risks.question.split('\n')[0].includes(name),
		`a second question about the change calls it what the first did: ${risks.question.split('\n')[0]}`,
	)

	const one = (await json(server, layoutOf(hashes[2] ?? ''))).look
	assert.deepEqual(one.change.range, { base: hashes[0], head: hashes[2] }, 'one commit is the change that commit made')
	const merge = (await json(server, layoutOf((hashes[3] ?? '').slice(0, 10)))).look
	assert.deepEqual(
		merge.change.range,
		{ base: hashes[2], head: hashes[3] },
		'and one merge, by a short hash too, is what it brought to the line it merged into',
	)
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

	const part = await json(server, `/api/change/diff?change=${change}&within=src/a`)
	assert.deepEqual(
		part.commits.map((each: { hash: string }) => each.hash),
		[hashes[1]],
	)
	assert.deepEqual(part.files, [{ path: 'src/a/y.ts', oldPath: 'src/a/y.ts' }])
	assert.deepEqual(
		part.hunks.flatMap((each: { hunk: { lines: string[] } }) => each.hunk.lines),
		['+y', '+y'],
	)

	const inside = (await json(server, layoutOf(change, 'src'))).look
	assert.deepEqual(
		[inside.change.files, inside.change.outside],
		[2, []],
		'the changed doc is outside src, so it is neither counted nor named there',
	)
})

test('a file moved from one box to another counts in both, each listing it by the path it has there', async () => {
	const moved = 'export const x = 1\nexport const y = 2\n'
	const { root, hashes } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/a/x.ts': moved, 'src/a/w.ts': 'w\n', 'src/b.ts': 'b\n', 'lib/y.ts': 'y\n' },
		},
		{ message: 'refactor: move x', files: { 'src/a/x.ts': null, 'lib/x.ts': moved } },
	])
	const server = await openKen(root, readerHome())
	const change = `${hashes[0]}..${hashes[1]}`

	const { look } = await json(server, layoutOf(change))
	const pathsIn = (name: string) =>
		look.boxes
			.find((box: { name: string }) => box.name === name)
			.touched?.paths.map((each: { path: string }) => each.path)
	assert.deepEqual([pathsIn('src'), pathsIn('lib')], [['src/a/x.ts'], ['lib/x.ts']])
	for (const part of ['src', 'lib']) {
		const moved = await json(server, `/api/change/diff?change=${change}&within=${part}`)
		assert.deepEqual(moved.files, [{ oldPath: 'src/a/x.ts', path: 'lib/x.ts' }])
		assert.deepEqual(moved.hunks, [], 'a move keeps both names without reporting a deletion or addition')
	}
	const inside = (await json(server, layoutOf(change, 'src'))).look
	assert.deepEqual([inside.change.files, inside.change.outside], [1, []], 'src lost the file, and its box a holds it')
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
	// The fixture's commits are months old, so a bare number of days that reaches them reads as that many days.
	const days = await json(server, layoutOf('since:3000'))
	assert.equal(days.look.change.range.head, third, 'a bare number is a number of days')
	const noDay = await call(server, layoutOf('since:2026-02-30'))
	assert.equal(noDay.status, 400, 'a date that is no day of the calendar is refused')

	const lens = (change: string) => ({ lens: { kind: 'change', change, want: 'story' } })
	assert.equal((await call(server, '/api/questions', lens('since:1d'))).status, 400)
	assert.equal(model.requests.length, 0, 'a span with no commit never reaches the model')
	const asked = await ask(server, lens('since:2026-01-02'))
	const replied = asked.find((line) => line.kind === 'replied')
	assert.deepEqual([replied.reply.change.base, replied.reply.change.head], [second, third])
})

test('a small part still shows its changed lines when an unrelated patch exceeds the git output limit', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'start', files: { 'part/limit\twith spaces.ts': '3\n' } },
		{ message: 'raise the limit', files: { 'part/limit\twith spaces.ts': '5\n' } },
		{ message: 'regenerate data', files: { 'data.txt': 'x'.repeat(17 * 1024 * 1024) } },
	])
	const server = await openKen(root, readerHome())
	const view = await json(server, `/api/change/diff?within=part&change=${hashes[0]}..${hashes[2]}`)
	assert.equal(view.hunks[0].path, 'part/limit\twith spaces.ts')
	assert.deepEqual(view.hunks[0].hunk.lines, ['-3', '+5'])
	assert.deepEqual(
		view.commits.map((commit: { subject: string }) => commit.subject),
		['raise the limit'],
	)
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

test('a long part diff pages through replacement lines at their git positions and counts a file only when it ends', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'old values', files: { 'part/replaced': lines(450, 'old').trimEnd(), 'part/old-name': 'moved' } },
		{
			message: 'new values',
			files: { 'part/replaced': lines(430, 'new').trimEnd(), 'part/old-name': null, 'part/new-name': 'moved' },
		},
	])
	const server = await openKen(root, readerHome())
	const url = `/api/change/diff?within=part&change=${hashes[0]}..${hashes[1]}`
	const pages = await Promise.all([1, 2, 3].map((page) => json(server, `${url}&page=${page}`)))
	const [first, middle, last] = pages
	assert.deepEqual(
		pages.map(({ page, pages, cut }) => [page, pages, cut]),
		[
			[1, 3, true],
			[2, 3, true],
			[3, 3, false],
		],
	)
	assert.deepEqual(first.complete.toSorted(), ['part/new-name', 'part/old-name'])
	assert.deepEqual(middle.complete, [])
	assert.deepEqual(last.complete, ['part/replaced'])
	const hunks = pages.map((page) => page.hunks[0].hunk)
	assert.deepEqual(
		hunks.map(
			({
				oldStart,
				oldLength,
				newStart,
				newLength,
			}: {
				oldStart: number
				oldLength: number
				newStart: number
				newLength: number
			}) => [oldStart, oldLength, newStart, newLength],
		),
		[
			[1, 400, 0, 0],
			[401, 50, 1, 350],
			[450, 0, 351, 80],
		],
	)
	assert.deepEqual(
		hunks.flatMap((h) => h.lines),
		[
			...lines(450, 'old')
				.trimEnd()
				.split('\n')
				.map((line) => `-${line}`),
			'\\ No newline at end of file',
			...lines(430, 'new')
				.trimEnd()
				.split('\n')
				.map((line) => `+${line}`),
			'\\ No newline at end of file',
		],
	)
	for (const page of [0, 1.5, 4]) assert.equal((await call(server, `${url}&page=${page}`)).status, 400)
})

test("explaining one part reads its changed files and keeps the whole change's story available", async () => {
	const { root, hashes } = buildRepository([
		{ message: 'First receipt', files: { 'receipts/lookup.js': 'lookup', 'other.js': 'older' } },
		{
			message: 'Expand support lookup',
			files: {
				'receipts/lookup.js': 'retain',
				'receipts/status.js': 'saved',
				'policy/days.js': 'thirty days',
				'other.js': 'unrelated',
			},
		},
	])
	const [base, head] = hashes
	const within = ['receipts', 'policy/days.js']
	const model = await scriptedModel([
		{ calls: within.map((path) => ({ tool: 'ken__diff', args: { base, head, path } })) },
		{ text: 'The policy allows thirty days.' },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const [asked] = await ask(server, {
		lens: { kind: 'change', want: 'story', change: `${base}..${head}`, part: 'Receipts', within },
	})
	assert.match(asked.question, /^What changed in Receipts/)
	for (const path of within) assert.ok(asked.question.includes(JSON.stringify(path)))
	const [folder, file] = toolResults(model.requests[1])
	assert.match(folder ?? '', /receipts\/lookup.js/)
	assert.match(folder ?? '', /receipts\/status.js/)
	assert.match(file ?? '', /thirty days/)
	assert.doesNotMatch([folder, file].join(' '), /other.js|unrelated/)
	const row = (await json(server, '/api/questions')).questions.at(-1)
	assert.equal(row?.want, null)
	const query = new URLSearchParams({ change: `${base}..${head}`, part: 'Receipts' })
	for (const path of within.toReversed()) query.append('within', path)
	const same = await json(server, `/api/change/diff?${query}`)
	assert.equal(same.question, row.question, 'reopening the same paths finds the saved explanation')
	query.delete('within')
	query.append('within', 'receipts')
	const narrower = await json(server, `/api/change/diff?${query}`)
	assert.notEqual(narrower.question, row.question)
})
