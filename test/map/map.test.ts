import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { openMap, openNotes, type TopicState } from '../../src/map/index.ts'
import { type EntryDraft, fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const QUOTE = 'export function checkQuote(text: string) {\n\treturn text.length > 0\n}\n'
const NOW = new Date('2026-11-16T10:00:00Z')

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
	const commit = (files: Record<string, string>) => {
		for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text)
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', 'change'], {
			cwd: root,
		})
	}
	return { root, home, repo, record, commit }
}

async function withTopics(record: ReturnType<typeof fileRecordStore>, drafts: EntryDraft[]) {
	const appended = await record.append(drafts)
	if (appended.kind !== 'appended') assert.fail(appended.problems.join(' '))
}

const RETRY_TOPIC: EntryDraft = {
	kind: 'topic',
	name: 'retry logic',
	quotes: [{ path: 'src/retry.ts', commit: 'HEAD', text: '\t\tattempt()\n\t\tsleep(100)' }],
}
const QUOTE_TOPIC: EntryDraft = {
	kind: 'topic',
	name: 'quote check',
	quotes: [{ path: 'src/quote.ts', commit: 'HEAD', text: '\treturn text.length > 0' }],
}

function kinds(states: TopicState[]) {
	return Object.fromEntries(states.map((state) => [state.topic, state.kind]))
}

test('"I know this" marks a topic understood at its code now; an unrelated edit leaves it so, and an edit to a quoted line marks it changed with those lines', async () => {
	const { home, repo, record, commit } = setUp()
	await withTopics(record, [RETRY_TOPIC, QUOTE_TOPIC])
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	const { map } = opened

	const learned = await map.learn('know', ['Retry logic'], NOW)

	assert.deepEqual(kinds(learned), { 'retry logic': 'unchanged' }, 'a name in another case still finds the topic')
	assert.deepEqual(kinds((await map.read(NOW)).states), { 'retry logic': 'unchanged', 'quote check': 'never-met' })

	commit({ 'src/retry.ts': `// Retries a call.\n${RETRY}\t\tsleep(100)\n\t}\n}\n`, 'README.md': '# demo app\n' })
	assert.deepEqual(
		kinds((await map.read(NOW)).states),
		{ 'retry logic': 'unchanged', 'quote check': 'never-met' },
		'a line added above the quoted lines moves them but does not change them',
	)

	commit({ 'src/retry.ts': `// Retries a call.\n${RETRY}\t\tsleep(200)\n\t}\n}\n` })
	const [retry] = (await map.read(NOW)).states
	assert.deepEqual(retry?.kind === 'changed' && retry.changed, [{ path: 'src/retry.ts', startLine: 3, endLine: 4 }])

	const current = (await record.read()).current.find((entry) => entry.kind === 'topic' && entry.name === 'retry logic')
	await withTopics(record, [
		{
			...RETRY_TOPIC,
			replaces: current?.id,
			quotes: [
				{ path: 'src/retry.ts', commit: 'HEAD', text: 'export function retry(times: number) {' },
				{ path: 'src/retry.ts', commit: 'HEAD', text: '\t\tattempt()\n\t\tsleep(200)' },
			],
		},
	])
	const rewritten = (await map.read(NOW)).states.find((state) => state.topic === 'retry logic')
	assert.deepEqual(
		rewritten?.kind === 'changed' && rewritten.changed,
		[{ path: 'src/retry.ts', startLine: 3, endLine: 4 }],
		'once the record holds a newer version of the topic, the changed lines are still those the reader knew',
	)

	const later = new Date(NOW.getTime() + 31 * 86_400_000)
	assert.deepEqual(
		kinds((await map.read(later)).states)['retry logic'],
		'long-ago',
		'a month on, the reader gets a reminder first',
	)
})

test('a line a person changed by hand counts, a line that does not parse is skipped and named, and the newest line for a topic wins', async () => {
	const { home, repo, record } = setUp()
	await withTopics(record, [RETRY_TOPIC, QUOTE_TOPIC])
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	const { map } = opened
	await map.learn('asked', ['quote check'], NOW)
	const asked = readFileSync(map.file, 'utf8')
	assert.equal((await map.read(NOW)).states[1]?.kind, 'met', 'a question is interest, not understanding')

	// The reader wrote the quote check by hand, says so in the line ken wrote, and adds two lines of their own.
	writeFileSync(
		map.file,
		asked.replace('"depth":"heard-of","evidence":"asked"', '"depth":"could-change","evidence":"wrote"'),
	)
	appendFileSync(map.file, '{"topic": "retry logic", "depth": "expert", "evidence": "said"}\n')
	appendFileSync(map.file, 'retry logic: I know it\n')
	const read = await map.read(NOW)

	assert.deepEqual(kinds(read.states), { 'retry logic': 'never-met', 'quote check': 'unchanged' })
	assert.deepEqual(read.problems, [
		'Line 2 of the map is skipped: its depth is not one of heard-of, can-follow, could-change.',
		'Line 3 of the map is skipped: it is not JSON.',
	])

	await map.learn('know', ['retry logic'], NOW)
	assert.equal((await map.read(NOW)).states[0]?.kind, 'unchanged')
	await map.learn('deeper', ['retry logic'], NOW)
	assert.equal(
		(await map.read(NOW)).states[0]?.kind,
		'unchanged',
		'"Go deeper" preserves the knowledge the reader reported',
	)

	await map.learn('know', ['retry logic'], NOW)
	await map.learn('forgot', ['retry logic'], NOW)
	const [forgotten] = (await map.read(NOW)).states
	assert.deepEqual(
		forgotten?.kind === 'met' && [forgotten.entry.depth, forgotten.entry.evidence],
		['heard-of', 'forgot'],
		'"I do not know this any more" drops the understanding and the depth',
	)
})

test('ken keeps a reader note on one line, once whatever its case and spaces, reads the newest twelve oldest first, drops one the reader removed, and skips a line that does not parse', async () => {
	const { home, repo } = setUp()
	const opened = await openNotes(home, repo)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	const { notes } = opened
	const texts = async () => (await notes.read()).map((note) => note.text)

	await notes.add('Explain with examples.', NOW)
	await notes.add('  explain   with EXAMPLES. ', NOW)
	assert.deepEqual(await texts(), ['Explain with examples.'])
	assert.equal((await notes.add('x'.repeat(201), NOW)).kind, 'refused')

	appendFileSync(notes.file, 'not json\n{"id":"by-hand","text":"I know git well.","at":"2026-11-16T10:00:00Z"}\n')
	assert.deepEqual(await texts(), ['Explain with examples.', 'I know git well.'], 'a person may add a line')
	const [first] = await notes.read()
	const left = await notes.remove(first?.id ?? '', NOW)
	assert.deepEqual(
		left.map((note) => note.text),
		['I know git well.'],
	)

	for (let n = 1; n <= 13; n++) await notes.add(`Note ${n}.`, NOW)
	const read = await texts()
	assert.deepEqual([read.length, read[0], read.at(-1)], [12, 'Note 2.', 'Note 13.'])

	await notes.add('Note 1.', NOW, 'reader')
	const promoted = (await notes.read()).at(-1)
	assert.equal(promoted?.text, 'Note 1.', 'a note outside the latest twelve becomes active again')
	await notes.remove(promoted?.id ?? '', NOW)
	for (const note of await notes.read()) await notes.remove(note.id, NOW)
	assert.ok(!(await texts()).includes('Note 1.'), 'removing the promoted note removes its earlier copy too')

	await notes.add('Show the tests\r\nfirst,\u2028 then   the code.', NOW)
	assert.equal(
		(await texts()).at(-1),
		'Show the tests first, then the code.',
		'every break and run of spaces is one space',
	)
})
