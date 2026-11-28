import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
	decisionWork,
	describeEntry,
	type EntryDraft,
	entryLine,
	fileRecordStore,
	noteFreshness,
} from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { projectSessions } from '../../src/transcripts/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { asked, claudeProjects, writeSession } from '../fixtures/claude-sessions.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const COLLABORATOR = { name: 'Bo Helper', email: 'bo@example.com' }
const AGENT = { name: 'Claude', email: 'noreply@anthropic.com' }
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n`, 'README.md': '# demo\n' } },
	{
		message: 'feat: wait between attempts',
		body: 'Co-authored-by: Claude Opus <noreply@anthropic.com>',
		files: { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` },
	},
	{ message: 'docs: say how long', author: COLLABORATOR, files: { 'README.md': '# demo\n\nWaits 100 ms.\n' } },
	{ message: 'docs: add a title', author: AGENT, files: { 'README.md': '# demo app\n\nWaits 100 ms.\n' } },
	{ message: 'docs: fix a word', files: { 'README.md': '# Demo app\n\nWaits 100 ms.\n' } },
])
const repo = gitRepository(root)
const SLEEP = { path: 'src/retry.ts', commit: 'HEAD', text: '\t\tsleep(100)' }

const decision: EntryDraft = {
	kind: 'decision',
	question: 'How long does a retry wait?',
	chosen: 'A fixed 100 ms after each attempt',
	reason: { text: 'One fixed wait is the simplest that works.', quotes: [] },
	rejected: [],
	undo: 'easy',
	needsOwner: false,
	quotes: [SLEEP],
	work: null,
}
const topic: EntryDraft = { kind: 'topic', name: 'retry logic', quotes: [SLEEP] }

function emptyRecord() {
	rmSync(path.join(root, '.ken'), { recursive: true, force: true })
	return fileRecordStore(root, repo)
}

function linesOf(file: string): string[] {
	return readFileSync(path.join(root, '.ken/record', file), 'utf8')
		.trimEnd()
		.split('\n')
}

async function appended(store: ReturnType<typeof fileRecordStore>, drafts: EntryDraft[]) {
	const result = await store.append(drafts)
	if (result.kind !== 'appended') assert.fail(`append was refused: ${result.problems.join(' ')}`)
	return result.entries.map(({ entry }) => entry)
}

test('an entry survives a restart, and writing the same entry again keeps one copy', async () => {
	const [written] = await appended(emptyRecord(), [decision])

	const restarted = fileRecordStore(root, repo)
	const { current, problems } = await restarted.read()
	assert.deepEqual(problems, [])
	assert.deepEqual(current, [written])
	assert.deepEqual(current[0]?.kind === 'decision' && current[0].quotes, [
		{ path: 'src/retry.ts', commit: hashes[4], startLine: 4, endLine: 4, text: '\t\tsleep(100)' },
	])
	const again = await restarted.append([decision])
	assert.deepEqual(again.kind === 'appended' && again.entries.map((each) => each.written), [false])
	assert.equal(linesOf('decisions.jsonl').length, 1)
	assert.equal(JSON.parse(linesOf('decisions.jsonl')[0] ?? '').question, 'How long does a retry wait?')
	assert.equal(readFileSync(path.join(root, '.ken/.gitattributes'), 'utf8'), 'record/*.jsonl merge=union\n')
})

test('a correction leaves the old entry readable, and reads return the new one', async () => {
	const store = emptyRecord()
	const [old] = await appended(store, [topic])
	const [fixed] = await appended(store, [{ ...topic, name: 'retry waits', replaces: old?.id }])

	const { entries, current } = await fileRecordStore(root, repo).read()
	assert.deepEqual(
		entries.map((entry) => entry.id),
		[old?.id, fixed?.id],
	)
	assert.deepEqual(
		current.map((entry) => entry.id),
		[fixed?.id],
	)
	assert.equal(fixed?.replaces, old?.id)
})

test('a batch with a false quote, an unknown replaces, a decision with no reason or a topic that quotes a commit message is refused whole, and nothing is written', async () => {
	const store = emptyRecord()
	const falseQuote = { ...decision, quotes: [{ ...SLEEP, text: '    sleep(100)' }] }
	const unknownReplaces = { ...decision, replaces: '000000000000' }
	const noReason = { ...decision, reason: { text: '  ', quotes: [] } }
	const messageTopic = {
		...topic,
		name: 'retry wait',
		quotes: [{ path: null, commit: 'HEAD', text: 'docs: fix a word' }],
	}

	for (const bad of [falseQuote, unknownReplaces, noReason, messageTopic]) {
		const result = await store.append([topic, bad])
		assert.equal(result.kind, 'refused')
		assert.equal(result.kind === 'refused' && result.problems.length, 1, JSON.stringify(result))
	}
	assert.equal(existsSync(path.join(root, '.ken')), false, 'the valid topic in the same batch was not written')
	assert.deepEqual((await store.read()).entries, [])
})

test("a batch drafted from the reader's own words writes its decision but no topic, so the record stays the same for every reader", async () => {
	const store = emptyRecord()
	const refused = await store.append([decision, topic], undefined, 'reader')
	assert.equal(refused.kind, 'refused')
	assert.deepEqual((await store.read()).entries, [])
	const written = await store.append([decision], undefined, 'reader')
	assert.equal(written.kind, 'appended')
	assert.deepEqual(
		(await store.read()).entries.map((entry) => entry.kind),
		['decision'],
	)
})

test('ken labels a decision by its strongest evidence: logged with ken decide, then the body of a commit message, then a saved session, then inferred, which a subject line or code alone stays', async () => {
	const built = buildRepository([
		{
			message: 'feat: wait between attempts',
			body: 'A fixed wait keeps the retry simple.',
			files: { 'retry.ts': '\t\tsleep(100)\n' },
		},
	])
	const [commit = ''] = built.hashes
	const projects = claudeProjects()
	writeSession(projects, built.root, 'wait-session', [
		asked(built.root, '2026-01-01T09:00:00.000Z', 'Wait between attempts.\nThe queue drains within a second.'),
	])
	const sessions = projectSessions(built.root, { KEN_CLAUDE_PROJECTS: projects })
	const code = { path: 'retry.ts', commit, text: '\t\tsleep(100)' }
	const body = { path: null, commit, text: 'A fixed wait keeps the retry simple.' }
	const subject = { path: null, commit, text: 'feat: wait between attempts' }
	const session = { session: 'wait-session', text: 'The queue drains within a second.' }
	const logged = { by: 'claude-code' }
	const cases = [
		{ reason: [session, body], quotes: [code], logged, label: 'recorded' },
		{ reason: [session], quotes: [], logged, label: 'recorded' },
		{ reason: [session, body], quotes: [code], label: 'recorded' },
		{ reason: [body], quotes: [code], label: 'recorded' },
		{ reason: [subject, session], quotes: [code], label: 'from-the-session' },
		{ reason: [code, session], quotes: [code], label: 'from-the-session' },
		{ reason: [], quotes: [code, body, session], label: 'inferred' },
		{ reason: [subject], quotes: [code], label: 'inferred' },
		{ reason: [code], quotes: [code], label: 'inferred' },
	]
	const drafts = cases.map(
		(each, at): EntryDraft => ({
			...decision,
			question: `Question ${at + 1}?`,
			reason: { text: 'A fixed wait is simple.', quotes: each.reason },
			quotes: each.quotes,
			...(each.logged && { logged: each.logged }),
		}),
	)
	const entries = await appended(fileRecordStore(built.root, gitRepository(built.root), sessions), drafts)

	assert.deepEqual(
		entries.map((entry) => entry.kind === 'decision' && entry.label),
		cases.map((each) => each.label),
	)
	const recorded = entries[3]
	assert.deepEqual(recorded?.kind === 'decision' && recorded.reason, {
		text: 'A fixed wait is simple.',
		quotes: [{ path: null, commit, startLine: 3, endLine: 3, text: 'A fixed wait keeps the retry simple.' }],
	})
	const fromSession = entries[4]
	assert.deepEqual(fromSession?.kind === 'decision' && fromSession.reason?.quotes[1], {
		tool: 'Claude Code',
		session: 'wait-session',
		message: 1,
		by: 'user',
		at: '2026-01-01T09:00:00.000Z',
		startLine: 2,
		endLine: 2,
		text: 'The queue drains within a second.',
	})
})

test('who did it comes from git: owner-agent with a trailer, collaborator by email, unknown without evidence', async () => {
	const [work] = await appended(emptyRecord(), [
		{
			kind: 'work',
			title: 'Retries wait',
			summary: 'Retries now wait 100 ms, and the README says so.',
			range: { base: hashes[0] ?? '', head: hashes[4] ?? '' },
			statements: [{ text: 'The loop sleeps after each attempt.', label: 'inferred', quotes: [SLEEP] }],
		},
	])

	assert.equal(work?.kind, 'work')
	if (work?.kind !== 'work') return
	assert.deepEqual(work.commits, [
		{ hash: hashes[4], by: 'unknown' },
		{ hash: hashes[3], by: 'unknown' },
		{ hash: hashes[2], by: 'collaborator' },
		{ hash: hashes[1], by: 'owner-agent' },
	])
	assert.deepEqual([work.first, work.last], ['2026-01-02T00:00:00.000Z', '2026-01-05T00:00:00.000Z'])
})

test('a note goes stale when its quoted code changes at HEAD, and stays fresh when another line changes', async () => {
	const start = { message: 'feat: start', files: { 'retry.ts': `${RETRY}\t}\n}\n` } }
	const cases = [
		{ edit: `${RETRY}\t}\n}\nexport const LIMIT = 3\n`, expected: { kind: 'fresh' } },
		{ edit: RETRY.replace('attempt()', 'attemptOnce()'), expected: { kind: 'stale', changed: ['retry.ts'] } },
	]
	for (const { edit, expected } of cases) {
		const built = buildRepository([start, { message: 'change retry.ts', files: { 'retry.ts': edit } }])
		const builtRepo = gitRepository(built.root)
		const store = fileRecordStore(built.root, builtRepo)
		const quote = { path: 'retry.ts', commit: built.hashes[0] ?? '', text: '\t\tattempt()' }
		const [written] = await appended(store, [{ kind: 'topic', name: 'retry logic', quotes: [quote] }])
		const [note] = await appended(store, [{ kind: 'note', topic: written?.id ?? '', text: 'Retries call attempt.' }])

		assert.ok(written?.kind === 'topic' && note?.kind === 'note')
		assert.deepEqual(await noteFreshness(builtRepo, written, note), expected)
		const direct = await describeEntry(builtRepo, await store.read(), note)
		assert.ok(direct.includes(`note ${note.id}, ${expected.kind}:`), direct)
	}
})

// Written by ken at 90725fb, before a piece of work kept diagrams, on this file's repository.
const OLD_WORK_LINE = String.raw`{"id":"b3e5d43f9434","kind":"work","title":"Retries wait","summary":"Retries now wait 100 ms.","range":{"base":"11db964a574b70e1d87686b8e7fee81cb14a306a","head":"ac026d46f80b8c52eeb8d85dbcf9a6d7a63bff69"},"commits":[{"hash":"ac026d46f80b8c52eeb8d85dbcf9a6d7a63bff69","by":"unknown"},{"hash":"b300476b7f00cb2a863c7e9c7f06a65ddbc5bb44","by":"unknown"},{"hash":"31827012466733268fbd888e60a2303641346be6","by":"collaborator"},{"hash":"64ca365a1f096278af5d084c364a63756ed402eb","by":"owner-agent"}],"first":"2026-01-02T00:00:00.000Z","last":"2026-01-05T00:00:00.000Z","statements":[{"text":"The loop sleeps after each attempt.","label":"inferred","quotes":[{"path":"src/retry.ts","commit":"ac026d46f80b8c52eeb8d85dbcf9a6d7a63bff69","startLine":4,"endLine":4,"text":"\t\tsleep(100)"}]}],"replaces":null,"at":"2026-11-15T21:40:07.202Z"}`

// Written by ken at 0d81f71, before a decision had a reason, on this file's repository.
const OLD_DECISION_LINE = String.raw`{"id":"9c1aca2a254d","kind":"decision","question":"How long does a retry wait?","chosen":"A fixed 100 ms after each attempt","rejected":[],"undo":"easy","needsOwner":true,"label":"inferred","quotes":[{"path":"src/retry.ts","commit":"ac026d46f80b8c52eeb8d85dbcf9a6d7a63bff69","startLine":4,"endLine":4,"text":"\t\tsleep(100)"}],"work":null,"replaces":null,"at":"2026-11-16T03:58:35.361Z"}`

test('a decision written before decisions had a reason still reads, inferred and with no reason, and ken record can show it', async () => {
	const store = emptyRecord()
	mkdirSync(path.join(root, '.ken/record'), { recursive: true })
	writeFileSync(path.join(root, '.ken/record/decisions.jsonl'), `${OLD_DECISION_LINE}\n`)

	const record = await store.read()
	assert.deepEqual(record.problems, [])
	const [old] = record.current
	assert.ok(old?.kind === 'decision', JSON.stringify(record))
	assert.deepEqual(
		[old.id, old.label, old.reason, old.quotes[0] && 'path' in old.quotes[0] && old.quotes[0].path],
		['9c1aca2a254d', 'inferred', null, 'src/retry.ts'],
	)
	const described = await describeEntry(repo, record, old)
	assert.match(described, /^chosen: A fixed 100 ms after each attempt$/m)
	assert.doesNotMatch(described, /^reason/m)
})

test('a piece of work written before diagrams and risks still reads, with no diagrams and risks never looked for, and ken record can show it', async () => {
	const store = emptyRecord()
	mkdirSync(path.join(root, '.ken/record'), { recursive: true })
	writeFileSync(path.join(root, '.ken/record/work.jsonl'), `${OLD_WORK_LINE}\n`)

	const record = await store.read()
	assert.deepEqual(record.problems, [])
	const [work] = record.current
	assert.ok(work?.kind === 'work', JSON.stringify(record))
	assert.deepEqual(
		[work.id, work.range.head, work.statements.length, work.diagrams, work.risks],
		['b3e5d43f9434', hashes[4], 1, [], null],
	)
	const described = await describeEntry(repo, record, work)
	assert.match(described, /statement 1 \[inferred\]: The loop sleeps after each attempt\./)
	assert.doesNotMatch(described, /^risk/m, 'an old piece of work does not claim that no risks were found')
})

// Written by ken at 1024923, before ken decide, on this file's repository. Its reason quotes the body of a commit message.
const OLD_RECORDED_LINE = String.raw`{"id":"49a3f4091409","kind":"decision","question":"Who wrote the wait?","chosen":"The owner with an agent","reason":{"text":"The commit names its co-author.","quotes":[{"path":null,"commit":"64ca365a1f096278af5d084c364a63756ed402eb","startLine":3,"endLine":3,"text":"Co-authored-by: Claude Opus <noreply@anthropic.com>"}]},"rejected":[],"undo":"easy","needsOwner":false,"label":"recorded","quotes":[{"path":"src/retry.ts","commit":"ac026d46f80b8c52eeb8d85dbcf9a6d7a63bff69","startLine":4,"endLine":4,"text":"\t\tsleep(100)"}],"work":null,"replaces":null,"at":"2026-11-16T04:56:03.892Z"}`

test('a decision recorded from a commit message before ken decide still reads, and its line says it came from a commit message', async () => {
	const store = emptyRecord()
	mkdirSync(path.join(root, '.ken/record'), { recursive: true })
	writeFileSync(path.join(root, '.ken/record/decisions.jsonl'), `${OLD_RECORDED_LINE}\n`)

	const record = await store.read()
	assert.deepEqual(record.problems, [])
	const [old] = record.current
	assert.ok(old?.kind === 'decision', JSON.stringify(record))
	assert.deepEqual([old.id, old.label, old.logged], ['49a3f4091409', 'recorded', undefined])
	assert.equal(entryLine(old), 'decision 49a3f4091409 "Who wrote the wait?" [recorded from a commit message]')
})

// Written by ken at 90b1c5c, when "I have decided" kept only when the owner answered and their note.
const OLD_ANSWER_LINE = String.raw`{"id":"417c949dbea0","kind":"decision","question":"Should a quote still match when only its whitespace changed?","chosen":"No: checkQuote compares each line with its ends trimmed, so a change inside a line breaks the quote.","reason":{"text":"Exact lines keep a quote honest; ignoring inner whitespace could match code that reads differently.","quotes":[]},"rejected":[],"undo":"some-work","needsOwner":false,"label":"inferred","quotes":[{"path":"src/checks/quote-check.ts","commit":"3a40b50ffdc762942d534fbaf91563ee36fe57b2","startLine":55,"endLine":55,"text":"\t\tif (wanted.every((line, at) => trimmed[index + at] === line)) starts.push(index + 1)"}],"work":null,"topic":"quote check","answer":{"at":"2026-11-16T05:51:48.557Z","note":"Keep exact lines. Revisit if renames break quotes often."},"replaces":"e35aa14e50d5","at":"2026-11-16T05:51:48.577Z"}`

test('an answer to a decision saved before ken asked whether the owner keeps the choice still reads, with its note and no outcome', async () => {
	const store = emptyRecord()
	mkdirSync(path.join(root, '.ken/record'), { recursive: true })
	writeFileSync(path.join(root, '.ken/record/decisions.jsonl'), `${OLD_ANSWER_LINE}\n`)

	const record = await store.read()
	assert.deepEqual(record.problems, [])
	const [old] = record.current
	assert.ok(old?.kind === 'decision', JSON.stringify(record))
	assert.deepEqual(old.answer, {
		at: '2026-11-16T05:51:48.557Z',
		note: 'Keep exact lines. Revisit if renames break quotes often.',
		outcome: null,
	})
})

test('a decision logged before its commits belongs to the piece of work whose range starts at or passes through the commit it was logged at, the smallest one first', async () => {
	const words = ['one', 'two', 'three', 'four']
	const built = buildRepository(words.map((word) => ({ message: `feat: ${word}`, files: { 'a.txt': `${word}\n` } })))
	const builtRepo = gitRepository(built.root)
	const store = fileRecordStore(built.root, builtRepo)
	const logged: string[] = []
	for (const [at, commit] of built.hashes.entries()) {
		execFileSync('git', ['checkout', '--quiet', '--detach', commit], { cwd: built.root, stdio: 'ignore' })
		const draft = { ...decision, question: `Logged at commit ${at}?`, quotes: [], logged: { by: 'an agent' } }
		const [entry] = await appended(store, [draft])
		logged.push(entry?.id ?? '')
	}
	const work = (base: number, head: number): EntryDraft => ({
		kind: 'work',
		title: `Commits ${base} to ${head}`,
		summary: 'a.txt changed.',
		range: { base: built.hashes[base] ?? '', head: built.hashes[head] ?? '' },
		statements: [
			{
				text: 'a.txt holds one word.',
				label: 'inferred',
				quotes: [{ path: 'a.txt', commit: built.hashes[head] ?? '', text: words[head] ?? '' }],
			},
		],
	})
	const [, first, second] = await appended(store, [work(0, 3), work(0, 2), work(2, 3)])

	const record = await store.read()
	const workOf = (id: string | undefined) => {
		const found = record.current.find((entry) => entry.id === id)
		return found?.kind === 'decision' ? decisionWork(found, record) : 'not a decision'
	}
	assert.deepEqual(
		logged.map(workOf),
		[first?.id, first?.id, second?.id, null],
		'commit 0 starts the first range and commit 1 is inside it; commit 2 ends it and starts the second; commit 3 ends every range',
	)
	assert.ok(first)
	const described = await describeEntry(builtRepo, record, first)
	assert.match(described, new RegExp(`decisions:\n  decision ${logged[0]} .*\n  decision ${logged[1]} .*$`))
})
