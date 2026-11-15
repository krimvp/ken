import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { type EntryDraft, fileRecordStore, noteFreshness } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

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
	rejected: [],
	undo: 'easy',
	needsOwner: false,
	label: 'inferred',
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

test('a batch with a false quote or an unknown replaces is refused whole, and nothing is written', async () => {
	const store = emptyRecord()
	const falseQuote = { ...decision, quotes: [{ ...SLEEP, text: '    sleep(100)' }] }
	const unknownReplaces = { ...decision, replaces: '000000000000' }

	for (const bad of [falseQuote, unknownReplaces]) {
		const result = await store.append([topic, bad])
		assert.equal(result.kind, 'refused')
		assert.equal(result.kind === 'refused' && result.problems.length, 1, JSON.stringify(result))
	}
	assert.equal(existsSync(path.join(root, '.ken')), false, 'the valid topic in the same batch was not written')
	assert.deepEqual((await store.read()).entries, [])
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
	}
})
