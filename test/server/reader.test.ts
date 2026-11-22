import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { call, json, openKen, readerHome } from '../fixtures/ken-server.ts'

type Box = { name: string; knows: { level: string; since: number } }

async function levelOf(server: Parameters<typeof json>[0], name: string): Promise<string | undefined> {
	const { look } = await json(server, '/api/layout?change=none')
	return look.boxes.find((box: Box) => box.name === name)?.knows.level
}

test('what the page says the reader looked at is refused when ken cannot place it, written once when sent twice, shown on the part and in what ken recorded, and written again once the reader took it back', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n' } },
	])
	const server = await openKen(root, readerHome())
	const refused = [
		{ did: 'read', paths: ['../outside'] },
		{ did: 'read', paths: ['src/nowhere'] },
		{ did: 'skimmed', paths: ['src'] },
		{ did: 'read', paths: [] },
		{ did: 'read', paths: Array.from({ length: 201 }, () => 'src') },
		{ did: 'change', paths: ['src/a/x.ts'], change: { base: hashes[0], head: 'nope' } },
	]
	for (const body of refused) {
		assert.equal((await call(server, '/api/seen', body)).status, 400, JSON.stringify(body).slice(0, 80))
	}
	assert.equal(await levelOf(server, 'src'), 'new')

	const said = { did: 'said', paths: ['src'] }
	assert.deepEqual(await json(server, '/api/seen', said), { written: true })
	assert.deepEqual(await json(server, '/api/seen', said), { written: false })
	const reader = await json(server, '/api/reader')
	assert.deepEqual(
		reader.learned.map((each: { did: string; part: string }) => [each.did, each.part]),
		[['said', 'src']],
	)
	assert.equal(reader.lastVisit, null, 'a line written a moment ago is this visit')
	const [line, ...more] = readFileSync(reader.file, 'utf8').trim().split('\n')
	assert.deepEqual(more, [])
	assert.deepEqual([JSON.parse(line ?? '').head, JSON.parse(line ?? '').paths], [hashes[0], ['src']])

	const view = await json(server, '/api/layout?change=none')
	assert.equal(view.look.boxes[0].knows.level, 'said')
	assert.deepEqual(
		view.levels.map((each: { level: string }) => each.level),
		['new', 'seen', 'read', 'code', 'said'],
	)
	assert.ok(view.levels.every((each: { label: string }) => each.label.length > 0))

	assert.deepEqual(await json(server, '/api/seen', { did: 'forgot', paths: ['src'] }), { written: true })
	assert.equal(await levelOf(server, 'src'), 'seen')
	assert.deepEqual(await json(server, '/api/seen', said), { written: true }, 'said again after taking it back')
	assert.equal(await levelOf(server, 'src'), 'said')
})

test('a reader who comes back after a commit landed is offered what landed since they last looked, before any span of days', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } },
		{ message: 'fix: change a', files: { 'src/a/x.ts': 'x2\n' } },
	])
	const server = await openKen(root, readerHome())
	const fresh = await json(server, '/api/layout?change=none')
	assert.equal(fresh.wayIn.suggested, 'learn', 'ken has not met this reader')

	// The reader read the part on an earlier visit, when the project was at its first commit.
	const { file } = await json(server, '/api/reader')
	const at = '2026-01-01T12:00:00.000Z'
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, `${JSON.stringify({ at, did: 'read', paths: ['src'], head: hashes[0] })}\n`)

	const back = await json(server, '/api/layout?change=none')
	assert.equal(back.wayIn.suggested, 'catch-up')
	assert.equal(back.changes[0].change, `${hashes[0]}..${hashes[1]}`)
	assert.equal((await json(server, '/api/reader')).lastVisit, at)
})
