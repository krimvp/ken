import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

test('a source question finds the current lines of a moved quote and flags a removed quote at its last known line', async () => {
	const file = 'src/worker.ts'
	const { root, hashes } = buildRepository([
		{ message: 'record the worker', files: { [file]: 'start()\nrun()\nstop()\n' } },
		{ message: 'prepare the worker', files: { [file]: 'start()\nprepare()\nrun()\n' } },
	])
	const [commit] = hashes
	assert.ok(commit)
	const store = fileRecordStore(root, gitRepository(root))
	const named = await store.append(
		['run()', 'stop()'].map((text) => ({
			kind: 'topic' as const,
			name: text,
			quotes: [{ path: file, commit, text }],
		})),
	)
	assert.equal(named.kind, 'appended')
	const model = await scriptedModel([
		{ calls: [2, 3].map((line) => ({ tool: 'ken__memory_quoted_in', args: { path: file, start: line, end: line } })) },
		{ text: 'Done.' },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)
	await ask(server, { question: 'Which saved facts cite these lines?' })
	const [previous, current] = toolResults(model.requests[1])
	assert.match(previous ?? '', /ken holds nothing/)
	assert.match(current ?? '', /run\(\).*\[src\/worker\.ts:3\]/)
	assert.match(current ?? '', /stop\(\).*\[src\/worker\.ts:3 \(changed since: read the file again\)\]/)
})

test('the agent can follow the printed cursor to every matching term within the character limit', async () => {
	const file = 'work.ts'
	const { root } = buildRepository([{ message: 'add worker', files: { [file]: 'run()' } }])
	const store = fileRecordStore(root, gitRepository(root))
	const terms = Array.from({ length: 45 }, (_, index) => `entry ${index} ${'named detail '.repeat(3)}`)
	const saved = await store.append(
		terms.map((name) => ({
			kind: 'topic' as const,
			name,
			quotes: [{ path: file, commit: 'HEAD', text: 'run()' }],
		})),
	)
	if (saved.kind !== 'appended') assert.fail(saved.problems.join(' '))
	const turns: Turn[] = []
	const model = await scriptedModel(turns)
	const server = await openKen(root, readerHome(), model.baseUrl)
	const found: number[] = []
	let from = 1
	for (;;) {
		turns.push({ tool: 'ken__memory_quoted_in', args: { path: file, from } }, { text: 'Done.' })
		await ask(server, { question: 'Read the next saved quotes.' })
		const page = toolResults(model.requests.at(-1)).at(-1) ?? ''
		assert.ok(page.length <= 2000)
		found.push(...Array.from(page.matchAll(/^term of term:entry (\d+)/gm), (match) => Number(match[1])))
		const next = /Continue with from (\d+)\./.exec(page)
		if (!next) break
		const cursor = Number(next[1])
		assert.ok(cursor > from && cursor <= terms.length)
		from = cursor
	}
	assert.deepEqual(
		found.toSorted((a, b) => a - b),
		terms.map((_, i) => i),
	)
})

test('a search keeps the changed-source warning on every shortened fact', async () => {
	const file = 'service.ts'
	const { root } = buildRepository([{ message: 'allow fourteen retries', files: { [file]: 'const retries = 14' } }])
	const store = fileRecordStore(root, gitRepository(root))
	const topics = await store.append(
		Array.from({ length: 20 }, (_, i) => ({
			kind: 'topic' as const,
			name: `retry ${i}`,
			quotes: [{ path: file, commit: 'HEAD', text: 'const retries = 14' }],
		})),
	)
	if (topics.kind !== 'appended') assert.fail(topics.problems.join(' '))
	const notes = await store.append(
		topics.entries.map(({ entry }) => ({
			kind: 'note' as const,
			topic: entry.id,
			text:
				'The service retries fourteen times when deliveries fail. ' +
				'Another delivery gets the same limit. '.repeat(4),
		})),
	)
	if (notes.kind !== 'appended') assert.fail(notes.problems.join(' '))
	writeFileSync(path.join(root, file), 'const retries = 3')
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'allow three retries'], { cwd: root })

	const model = await scriptedModel([{ tool: 'ken__memory_search', args: { words: 'retry' } }, { text: 'Done.' }])
	const server = await openKen(root, readerHome(), model.baseUrl)
	await ask(server, { question: 'What retry limits do we know?' })
	const page = toolResults(model.requests[1])[0] ?? ''
	assert.ok(page.length <= 3000)
	const hits = page.split('\n').filter((line) => line.includes('term:retry'))
	assert.equal(hits.length, 20)
	for (const hit of hits) assert.match(hit, /changed since/)
})

test('an earlier answer can be found on a later search page when the current chat and the record also match', async () => {
	const { root } = buildRepository([{ message: 'Add worker', files: { 'work.ts': 'run()' } }])
	const home = readerHome()
	const previous = await scriptedModel(Array.from({ length: 21 }, (_, i) => ({ text: `Finding ${i}.` })))
	const old = await openKen(root, home, previous.baseUrl)
	const archived: string[] = []
	for (let i = 0; i < 21; i++) {
		const events = await ask(old, { question: `Investigate delay ${i}.` })
		archived.push(events.at(-1).view.entry.id)
	}
	await old.close()
	const record = await fileRecordStore(root, gitRepository(root)).append([
		{ kind: 'topic', name: 'Delay budget', quotes: [{ path: 'work.ts', commit: 'HEAD', text: 'run()' }] },
	])
	assert.equal(record.kind, 'appended')
	const model = await scriptedModel([
		{ text: 'One new finding.' },
		{ tool: 'ken__memory_search', args: { words: 'delay' } },
		{ tool: 'ken__memory_search', args: { words: 'delay', page: 2 } },
		{ tool: 'ken__memory_known', args: { about: archived[0] } },
		{ text: 'Found the first investigation.' },
	])
	const server = await openKen(root, home, model.baseUrl)
	await ask(server, { question: 'Investigate delay today.' })
	await ask(server, { question: 'Where did those investigations start?' })
	const pageOne = toolResults(model.requests[2]).at(-1) ?? ''
	const pageTwo = toolResults(model.requests[3]).at(-1) ?? ''
	assert.match(pageOne, /Ask for page 2/)
	assert.match(pageOne, /answer chat:1/)
	for (const page of [pageOne, pageTwo]) assert.ok(page.length <= 3000)
	const ids = [...`${pageOne}\n${pageTwo}`.matchAll(/^answer (\S+): /gm)].map((match) => match[1])
	assert.deepEqual(ids, ['chat:1', ...archived.toReversed()])
	assert.match(pageOne, /Investigate delay 20/)
	assert.match(pageTwo, /Investigate delay 0/)
	assert.match(pageTwo, /Delay budget/)
	assert.doesNotMatch(pageTwo, /Ask for page 3/)
	assert.match(toolResults(model.requests[4]).at(-1) ?? '', /Finding 0\./)
})
