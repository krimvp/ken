import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

const topic = 'retry policy'
const file = 'src/retry.ts'

async function project() {
	const { root } = buildRepository([{ message: 'Start retries', files: { [file]: 'retry(1)\n' } }])
	const record = fileRecordStore(root, gitRepository(root))
	const saved = await record.append(
		[{ kind: 'topic', name: topic, quotes: [{ path: file, commit: 'HEAD', text: 'retry(1)' }] }],
		'project',
	)
	assert.equal(saved.kind, 'appended')
	return { root, home: readerHome() }
}

test('asking twice for less detail tells the provider to shorten replies and leaves proficiency unknown', async () => {
	const { root, home } = await project()
	const model = await scriptedModel([{ text: 'One try.' }, { text: 'One call to retry.' }])
	const server = await openKen(root, home, model.baseUrl)
	const signal = (value: string) => json(server, '/api/map', { signal: value, topics: [topic] })
	await signal('too-much')
	const { file: mapFile } = await json(server, '/api/map')
	const once = readFileSync(mapFile, 'utf8')
	await signal('too-much')
	assert.equal(readFileSync(mapFile, 'utf8'), once, 'repeated clicks need one preference line')
	await ask(server, { question: 'Explain the retry policy.' })
	const opening = JSON.stringify(model.requests[0]?.messages)
	assert.doesNotMatch(opening, /could change it|can follow it/)
	assert.match(opening, /shorter repl/i)
	const { learned } = await json(server, '/api/reader')
	assert.ok(learned.some((line: { text: string }) => /shorter replies on retry policy/.test(line.text)))
	const known = (await signal('know')).states[0]
	assert.equal(known.entry.depth, 'can-follow')
	assert.equal(known.kind, 'unchanged')
	await ask(server, { lens: { kind: 'deeper', topics: [topic], question: 'Explain the retry policy.' } })
	const second = JSON.stringify(model.requests[1]?.messages)
	assert.match(second, /Go one level deeper on retry policy/)
	assert.doesNotMatch(second, /reader asked for shorter replies/i)
	const [after] = (await json(server, '/api/map')).states
	assert.equal(after.kind, 'unchanged')
	assert.deepEqual(after.entry, known.entry)
})

test('a returning author keeps the code they knew when an old read line or a new request for brevity follows a change', async () => {
	const { root, home } = await project()
	const first = await openKen(root, home)
	const snapshot = await json(first, '/api/map')
	await first.close()
	const legacy = {
		topic,
		hash: snapshot.states[0].hash,
		date: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
		depth: 'could-change',
	}
	mkdirSync(path.dirname(snapshot.file), { recursive: true })
	appendFileSync(
		snapshot.file,
		[JSON.stringify({ ...legacy, evidence: 'wrote' }), JSON.stringify({ ...legacy, evidence: 'read' }), ''].join('\n'),
	)
	writeFileSync(path.join(root, file), 'retry(2)\n')
	execFileSync('git', ['commit', '-qam', 'Allow two tries'], { cwd: root })
	const server = await openKen(root, home)
	const [old] = (await json(server, '/api/map')).states
	assert.equal(old.kind, 'changed')
	assert.equal(old.entry.evidence, 'wrote')
	const previouslyKnown = { ...legacy, evidence: 'wrote' }
	appendFileSync(snapshot.file, `${JSON.stringify({ ...legacy, evidence: 'asked' })}\n`)
	const [deeper] = (await json(server, '/api/map')).states
	assert.equal(deeper.shorterSince, undefined, 'old Go deeper entries clear their earlier shorter reply request')
	assert.deepEqual(deeper.entry, previouslyKnown)
	const saved = await json(server, '/api/map', { signal: 'too-much', topics: [topic] })
	assert.deepEqual(saved.states[0].entry, old.entry)
	assert.deepEqual(saved.states[0].changed, [{ path: file, startLine: 1, endLine: 1 }])
	const undone = await json(server, '/api/map', { signal: 'usual', topics: [topic] })
	assert.equal(undone.states[0].kind, 'changed')
	assert.deepEqual(undone.states[0].entry, old.entry)
})
