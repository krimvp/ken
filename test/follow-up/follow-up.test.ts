import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { decide, openItems, rangeQuestion, sinceChoices, timeRange } from '../../src/follow-up/index.ts'
import { openMap } from '../../src/map/index.ts'
import { type EntryDraft, fileRecordStore, type RecordEntry } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { projectSessions } from '../../src/transcripts/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'
import { asked, claudeProjects, writeSession } from '../fixtures/claude-sessions.ts'

const COLLABORATOR = { name: 'Bo Helper', email: 'bo@example.com' }
const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const QUOTE = 'export function checkQuote(text: string) {\n\treturn text.length > 0\n}\n'

function setUp() {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n`, 'src/quote.ts': QUOTE, 'README.md': '# demo\n' },
		},
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(root)
	const record = fileRecordStore(root, repo)
	// A commit at a set time by a set author, so the test controls the order of commits and of the reader's signals.
	const commit = (author: { name: string; email: string }, date: string, files: Record<string, string>) => {
		for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text)
		const as = { NAME: author.name, EMAIL: author.email, DATE: date }
		const env = Object.fromEntries(
			['AUTHOR', 'COMMITTER'].flatMap((who) => Object.entries(as).map(([key, value]) => [`GIT_${who}_${key}`, value])),
		)
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', `edit ${date}`], {
			cwd: root,
			env: { ...process.env, ...env },
		})
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
	}
	return { home, repo, record, commit }
}

async function append(record: ReturnType<typeof fileRecordStore>, drafts: EntryDraft[]) {
	const appended = await record.append(drafts)
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
	return appended.entries.map(({ entry }) => entry)
}

test("after a collaborator's commits, what is open lists the topic the owner understood with their commit and the changed lines, and nothing about a topic the owner never met", async () => {
	const { home, repo, record, commit } = setUp()
	// The owner's own edit earlier the same day, before they said "I know this", is part of what they understood.
	commit(OWNER, '2026-11-16T09:00:00Z', { 'src/retry.ts': `${RETRY}\t\tsleep(150)\n\t}\n}\n` })
	await append(record, [
		{
			kind: 'topic',
			name: 'retry logic',
			quotes: [{ path: 'src/retry.ts', commit: 'HEAD', text: '\t\tattempt()\n\t\tsleep(150)' }],
		},
		{
			kind: 'topic',
			name: 'quote check',
			quotes: [{ path: 'src/quote.ts', commit: 'HEAD', text: '\treturn text.length > 0' }],
		},
	])
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	await opened.map.learn('know', ['retry logic'], new Date('2026-11-16T10:00:00Z'))

	const retry = commit(COLLABORATOR, '2026-11-16T11:00:00Z', { 'src/retry.ts': `${RETRY}\t\tsleep(400)\n\t}\n}\n` })
	commit(COLLABORATOR, '2026-11-16T11:10:00Z', { 'src/quote.ts': QUOTE.replace('> 0', '> 1') })
	commit(COLLABORATOR, '2026-11-16T11:20:00Z', { 'README.md': '# demo\n\nRetries wait 400 ms.\n' })
	const now = new Date('2026-11-16T12:00:00Z')
	const open = await openItems(repo, await record.read(), (await opened.map.read(now)).states)

	assert.deepEqual(
		open.topics.map(({ state, commits }) => ({
			topic: state.topic,
			changed: state.changed,
			commits: commits.map(({ hash, author, by }) => ({ hash, author, by })),
		})),
		[
			{
				topic: 'retry logic',
				changed: [{ path: 'src/retry.ts', startLine: 3, endLine: 4 }],
				commits: [{ hash: retry, author: 'Bo Helper', by: 'collaborator' }],
			},
		],
	)
	assert.deepEqual(open.decisions, [])
})

test('a decision that needs the owner is open until "I have decided", which adds an entry with the same content and the answer, and leaves the old one readable', async () => {
	const { repo, record } = setUp()
	const sleep = { path: 'src/retry.ts', commit: 'HEAD', text: '\t\tsleep(100)' }
	const ask = (question: string, needsOwner: boolean): EntryDraft => ({
		kind: 'decision',
		question,
		chosen: 'A fixed 100 ms',
		reason: { text: 'One fixed wait is the simplest that works.', quotes: [] },
		rejected: [{ option: 'A wait that doubles', reason: 'No caller needs it yet.' }],
		undo: 'easy',
		needsOwner,
		quotes: [sleep],
		work: null,
	})
	const [waiting, settled] = await append(record, [
		ask('How long does a retry wait?', true),
		ask('Does retry log each attempt?', false),
	])
	const openNow = async () => (await openItems(repo, await record.read(), [])).decisions.map((d) => d.id)
	assert.deepEqual(await openNow(), [waiting?.id], 'only the decision that needs the owner is open')

	const now = new Date('2026-11-16T12:00:00Z')
	const unsaid = await decide(record, { id: waiting?.id ?? '', note: ' ', outcome: 'change', now })
	assert.equal(unsaid.kind, 'refused', 'wanting a change needs a note that says what to change')
	assert.deepEqual(await openNow(), [waiting?.id], 'a refused answer leaves the decision open')
	const decided = await decide(record, {
		id: waiting?.id ?? '',
		note: '  Keep it until users complain. ',
		outcome: 'keep',
		now,
	})
	if (decided.kind !== 'decided') assert.fail(decided.problem)

	assert.deepEqual(await openNow(), [])
	const read = await record.read()
	const old = read.entries.find((entry) => entry.id === waiting?.id)
	if (old?.kind !== 'decision' || decided.entry.kind !== 'decision') return assert.fail('both entries are decisions')
	assert.deepEqual(
		{ replaces: decided.entry.replaces, needsOwner: decided.entry.needsOwner, answer: decided.entry.answer },
		{
			replaces: old.id,
			needsOwner: false,
			answer: { at: now.toISOString(), note: 'Keep it until users complain.', outcome: 'keep' },
		},
	)
	assert.deepEqual(contentOf(decided.entry), contentOf(old), 'the answer keeps what was decided')
	assert.deepEqual(
		read.current.map((entry) => entry.id).sort(),
		[decided.entry.id, settled?.id].sort(),
		'the old entry stays readable, and the new one replaces it',
	)

	const again = await decide(record, { id: waiting?.id ?? '', note: '', outcome: 'keep', now })
	assert.equal(again.kind, 'refused', 'a decision answered once does not wait on the owner')
	const settledAnswer = await decide(record, { id: settled?.id ?? '', note: '', outcome: 'keep', now })
	assert.equal(settledAnswer.kind, 'refused', 'a decision that never waited on the owner cannot be answered')
})

test('"I have decided" on a decision an agent logged keeps who logged it, the commit checked out then, and a reason quoted from a session', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` } },
	])
	const projects = claudeProjects()
	writeSession(projects, root, 'retry-session', [
		asked(root, '2026-01-02T09:00:00.000Z', 'Keep the retry wait fixed at 100 ms.'),
	])
	const repo = gitRepository(root)
	const record = fileRecordStore(root, repo, projectSessions(root, { KEN_CLAUDE_PROJECTS: projects }))
	const [logged] = await append(record, [
		{
			kind: 'decision',
			question: 'How long does a retry wait?',
			chosen: 'A fixed 100 ms',
			reason: {
				text: 'The owner asked for a fixed wait.',
				quotes: [{ session: 'retry-session', text: 'Keep the retry wait fixed at 100 ms.' }],
			},
			rejected: [],
			undo: 'easy',
			needsOwner: true,
			quotes: [],
			work: null,
			logged: { by: 'claude-code' },
		},
	])
	writeFileSync(path.join(root, 'src/retry.ts'), `${RETRY}\t\tsleep(200)\n\t}\n}\n`)
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '-m', 'fix: wait longer'], {
		cwd: root,
	})

	const now = new Date('2026-11-16T12:00:00Z')
	const decided = await decide(record, { id: logged?.id ?? '', note: '', outcome: 'keep', now })
	if (decided.kind !== 'decided') return assert.fail(decided.problem)
	if (decided.entry.kind !== 'decision') return assert.fail('the answer is a decision')
	assert.deepEqual(
		{
			logged: decided.entry.logged,
			label: decided.entry.label,
			reason: decided.entry.reason?.quotes.map((quote) => quote.text),
		},
		{
			logged: { by: 'claude-code', head: hashes[0] },
			label: 'recorded',
			reason: ['Keep the retry wait fixed at 100 ms.'],
		},
	)
})

test('the time range lens turns "the last N days" into what landed on the main line since then, a merged branch included, and says when nothing did', async () => {
	// Commit n is dated 2026-01-01 plus n days. Commit 3 is a collaborator's, on a branch from commit 1 that commit 4
	// merges, so it is the newest commit before 4 January noon but not on the main line.
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'total = 0\n' } },
		{ message: 'feat: count', files: { 'app.py': 'total = 1\n' } },
		{ message: 'feat: count more', files: { 'app.py': 'total = 2\n' } },
		{ message: 'feat: notes', author: COLLABORATOR, parent: 1, files: { 'notes.md': '# notes\n' } },
		{ message: 'merge the notes', parent: 2, merge: 3, files: {} },
		{ message: 'feat: count again', files: { 'app.py': 'total = 3\n' } },
	])
	const repo = gitRepository(root)
	const record = await fileRecordStore(root, repo).read()
	const lastDays = async (days: number, now: string) => {
		const found = await timeRange(repo, { kind: 'days', days }, new Date(now))
		if (found.kind !== 'ok') return assert.fail(found.problem)
		return found.range
	}

	const lastTwo = await lastDays(2, '2026-01-06T12:00:00Z')
	assert.deepEqual(
		{ base: lastTwo.base, commits: lastTwo.commits.map((commit) => commit.hash) },
		{ base: hashes[2], commits: [hashes[5], hashes[3]] },
		'the range starts at the last main-line commit before 4 January noon; the merge itself is left out',
	)
	assert.equal(rangeQuestion(lastTwo, record, null).empty, false)

	const quiet = await lastDays(2, '2026-01-20T00:00:00Z')
	assert.deepEqual(quiet.commits, [])
	assert.equal(rangeQuestion(quiet, record, null).empty, true, 'nothing landed, so ken does not ask the agent')

	const all = await lastDays(30, '2026-01-06T12:00:00Z')
	assert.deepEqual(
		{ base: all.base, fromFirst: all.fromFirst, commits: all.commits.length },
		{ base: hashes[0], fromFirst: true, commits: 4 },
		'no commit is older than the start, so the range starts at the first commit',
	)
})

// What a decision says, without the fields an answer changes and those every entry has.
function contentOf(entry: Extract<RecordEntry, { kind: 'decision' }>) {
	const { id, at, replaces, needsOwner, answer, ...content } = entry
	return content
}

test("the spans for catching up start at the reader's last question when it was at an older commit, and at their own last commit, then the last days, each with the commits it holds, and a span with the same commits as one before it is left out", async () => {
	const { repo, commit } = setUp()
	const now = new Date('2026-11-16T12:00:00Z')
	assert.deepEqual(await sinceChoices(repo, [], now), [], 'nothing landed after the one old commit')

	const asked = commit(OWNER, '2026-08-01T12:00:00Z', { 'README.md': '# demo\n\nOne.\n' })
	const own = commit(OWNER, '2026-10-20T12:00:00Z', { 'README.md': '# demo\n\nTwo.\n' })
	const week = commit(COLLABORATOR, '2026-11-01T12:00:00Z', { 'README.md': '# demo\n\nThree.\n' })
	const head = commit(COLLABORATOR, '2026-11-12T12:00:00Z', { 'README.md': '# demo\n\nFour.\n' })
	// Only the newest question with a head counts: an older one at a commit further back is not offered.
	const questions = [
		{ askedAt: '2026-07-01T12:00:00Z', head: null },
		{ askedAt: '2026-07-02T12:00:00Z', head: own },
		{ askedAt: '2026-08-02T12:00:00Z', head: asked },
		{ askedAt: '2026-08-03T12:00:00Z', head: null },
	]
	const changes = async (questions: { askedAt: string; head: string | null }[]) =>
		(await sinceChoices(repo, questions, now)).map(({ choice }) => [choice.change, choice.commits])

	const choices = await sinceChoices(repo, questions, now)
	assert.deepEqual(
		choices.map(({ choice }) => [choice.change, choice.commits]),
		[
			[`${asked}..${head}`, 3],
			[`${own}..${head}`, 2],
			[`${week}..${head}`, 1],
		],
		'the last question, the last commit and 7 days; 30 and 90 days hold what the last question holds',
	)
	assert.ok(choices.every(({ choice }) => choice.name.includes(String(choice.commits))))

	const withoutQuestion = [
		[`${own}..${head}`, 2],
		[`${week}..${head}`, 1],
		[`${asked}..${head}`, 3],
	]
	assert.deepEqual(
		await changes([...questions, { askedAt: '2026-11-14T12:00:00Z', head }]),
		withoutQuestion,
		'the last question was asked at HEAD, so nothing landed since it',
	)
	assert.deepEqual(
		await changes([...questions, { askedAt: '2026-11-14T12:00:00Z', head: 'f'.repeat(40) }]),
		withoutQuestion,
		'the last question was asked at a commit this history does not have, as after a rebase',
	)
})

test("the span since the reader's own last commit finds a commit that came in through a merge, with their email in any case", async () => {
	const decoy = { name: 'Not Ada', email: `x${OWNER.email}` }
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'a.txt': 'a\n' } },
		{ message: 'feat: b', files: { 'b.txt': 'b\n' }, author: COLLABORATOR },
		{
			message: 'feat: c',
			files: { 'c.txt': 'c\n' },
			author: { ...OWNER, email: OWNER.email.toUpperCase() },
			parent: 0,
		},
		{ message: 'Merge c', files: {}, author: COLLABORATOR, parent: 1, merge: 2 },
		{ message: 'feat: d', files: { 'd.txt': 'd\n' }, author: decoy },
	])
	const [, , own, , head] = hashes
	const choices = await sinceChoices(gitRepository(root), [], new Date('2026-11-16T12:00:00Z'))
	assert.deepEqual(
		choices.map(({ anchor, choice }) => [anchor, choice.change]),
		[['commit', `${own}..${head}`]],
	)
})
