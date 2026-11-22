import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

// Two commits on the main line, one on a side branch, and the merge that brings it in: commit n lands on day n + 1 of
// January 2026.
const { root } = buildRepository([
	{ message: 'feat: start', files: { 'src/a.ts': 'a()\n' } },
	{ message: 'feat: more of a', files: { 'src/a.ts': 'a()\na()\n' } },
	{ message: 'feat: b, on a branch', files: { 'src/b.ts': 'b()\n' }, parent: 0 },
	{ message: 'Merge the branch', files: {}, parent: 1, merge: 2 },
	{ message: 'feat: after the merge', files: { 'src/c.ts': 'c()\n' } },
])

test('the timeline has one entry for each day with a commit, oldest first, the first commit among them, and counts a merge apart from the commits it brings', async () => {
	const server = await openKen(root, readerHome())
	const timeline = await json(server, '/api/timeline?days=3650')
	assert.deepEqual(timeline.days, [
		{ day: '2026-01-01', commits: 1, merges: 0 },
		{ day: '2026-01-02', commits: 1, merges: 0 },
		{ day: '2026-01-03', commits: 1, merges: 0 },
		{ day: '2026-01-04', commits: 0, merges: 1 },
		{ day: '2026-01-05', commits: 1, merges: 0 },
	])
	assert.equal(timeline.lastVisit, null, 'this reader has not looked at the project yet')
	const { status } = await call(server, '/api/timeline?days=soon')
	assert.equal(status, 400, 'days is a whole number')
})

test("the reader's choice of how much text is kept in their own files, and ken tells its model the choice in every run", async () => {
	const home = readerHome()
	const model = await scriptedModel([{ text: 'Pictures first.' }, { text: 'More words.' }])
	const server = await openKen(root, home, model.baseUrl)
	assert.deepEqual(await json(server, '/api/prefs'), { text: 'pictures' }, 'ken starts a reader on pictures first')
	await ask(server, { question: 'What is this?' })

	const refused = await call(server, '/api/prefs', { text: 'loud' })
	assert.equal(refused.status, 400, refused.text)
	assert.deepEqual(await json(server, '/api/prefs', { text: 'words' }), { text: 'words' })
	await ask(server, { question: 'And this?' })
	await server.close()

	const told = model.requests.map((request) => String(request.messages.at(-1)?.content))
	assert.match(told[0] ?? '', /How much text the reader chose: .*pictures first/)
	assert.match(told[1] ?? '', /How much text the reader chose: .*more words/)
	const later = await openKen(root, home)
	assert.deepEqual(await json(later, '/api/prefs'), { text: 'words' }, 'the choice outlives the server')
})
