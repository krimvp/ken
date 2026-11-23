import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, toolResults } from '../fixtures/scripted-model.ts'

// Two commits on the main line, one on a side branch, and the merge that brings it in: commit n lands on day n + 1 of
// January 2026.
const { root, hashes } = buildRepository([
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

test('a question about open lines keeps their file, commit and range when reopened', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'First pickup time', files: { 'Pickup.js': 'export function pickup() {\n  return 12\n}\n' } },
		{ message: 'Later pickup time', files: { 'Pickup.js': 'export function pickup() {\n  return 18\n}\n' } },
	])
	const invented = 'Pickup was at midnight.'
	const model = await scriptedModel([{ text: invented }, { text: 'I will read it again.' }])
	const home = readerHome()
	const server = await openKen(root, home, model.baseUrl)
	const focus = { path: 'Pickup.js', commit: hashes[0], start: 2, end: 3 }
	const question = 'What time does this return?'
	const lines = await ask(server, { question, focus })
	const entry = lines.find((line) => line.kind === 'saved')?.view.entry
	assert.ok(entry)
	const reopened = await json(server, `/api/questions/${entry.id}`)
	assert.equal(reopened.entry.question, question)
	assert.deepEqual(reopened.entry.focus, focus)
	assert.equal(lines.find((line) => line.kind === 'done')?.outcome, 'unverified')
	assert.equal(reopened.entry.outcome, 'unverified')
	const prompt = String(model.requests[0]?.messages.at(-1)?.content)
	assert.ok(prompt.includes(focus.path) && prompt.includes(hashes[0] ?? 'missing'))
	assert.match(prompt, /lines 2 to 3/)
	assert.ok(prompt.includes('return 12') && !prompt.includes('return 18'))
	assert.ok(JSON.stringify(reopened.entry.reply).includes(invented), 'the reader can still open the original answer')
	const source = `Pickup.js:2-3@${hashes[0]}`
	await ask(server, { question: 'What did we just look at?' })
	const recent = String(model.requests[1]?.messages.at(-1)?.content)
	assert.ok(recent.includes(source) && !recent.includes(invented))
	await server.close()
	const next = await scriptedModel([
		{ tool: 'ken__memory_known', args: { about: entry.id } },
		{ text: 'I found the lines.' },
	])
	const later = await openKen(root, home, next.baseUrl)
	await ask(later, { question: 'Do you remember that source?' })
	const recalled = JSON.stringify(next.requests[1]?.messages.find((msg) => msg.role === 'tool')?.content)
	assert.ok(recalled.includes(source) && !recalled.includes(invented))
	const follow = await scriptedModel([{ text: 'Here is the same source.' }])
	const reopenedServer = await openKen(root, home, follow.baseUrl)
	const saved = (await ask(reopenedServer, { question: 'Which line was that?', after: entry.id })).find(
		(line) => line.kind === 'saved',
	)?.view.entry
	assert.deepEqual(saved?.focus, focus)
	const followPrompt = String(follow.requests[0]?.messages.at(-1)?.content)
	assert.ok(
		followPrompt.includes('return 12') &&
			followPrompt.includes('no checked source') &&
			!followPrompt.includes(invented),
	)
})

test('a follow-up resumes the saved reply across visits and a new subject starts without either thread', async () => {
	const home = readerHome()
	const first = await scriptedModel([{ text: 'The receipt has a blue code.' }])
	const old = await openKen(root, home, first.baseUrl)
	const original = (await ask(old, { question: 'What does the receipt show?' })).find((row) => row.kind === 'saved')
		?.view.entry
	assert.ok(original)
	await old.close()

	const next = await scriptedModel([
		{ text: 'The sorter has green bins.' },
		{ text: 'It identifies a parcel.' },
		{ text: 'More details.' },
		{ tool: 'ken__memory_known', args: { about: original.id } },
		{ text: 'The original was blue.' },
		{ text: 'A new subject.' },
	])
	const later = await openKen(root, home, next.baseUrl)
	await ask(later, { question: 'Explain the sorter.' })
	const follow = (await ask(later, { question: 'What does it mean?', after: original.id })).find(
		(row) => row.kind === 'saved',
	)?.view.entry
	assert.ok(follow)
	assert.equal(follow.thread, original.thread)
	assert.equal(follow.after, original.id)
	const example = (await ask(later, { question: 'Give an example.', after: follow.id })).find(
		(row) => row.kind === 'saved',
	)?.view.entry
	assert.ok(example)
	await ask(later, { question: 'What did you say in the first answer?', after: example.id })
	const fresh = (await ask(later, { question: 'Start over.', after: null })).find((row) => row.kind === 'saved')?.view
		.entry
	assert.ok(fresh)
	assert.notEqual(fresh.thread, original.thread)
	const [, second, third, fourth, , freshPrompt] = next.requests.map((request) =>
		String(request.messages.at(-1)?.content),
	)
	assert.match(second ?? '', /receipt has a blue code/)
	assert.doesNotMatch(second ?? '', /sorter has green bins/)
	assert.match(third ?? '', /receipt has a blue code/)
	assert.match(third ?? '', /identifies a parcel/)
	assert.doesNotMatch(fourth ?? '', /blue code|green bins/)
	assert.ok(fourth?.includes(original.id), 'the oldest excerpt points back to the preceding reply')
	assert.match(toolResults(next.requests[4]).at(-1) ?? '', /receipt has a blue code/)
	assert.doesNotMatch(freshPrompt ?? '', /blue code|green bins|identifies a parcel/)
	assert.equal(fresh.after, null)
	const firstCommit = hashes[0]
	assert.ok(firstCommit)
	const history = path.join(home, 'projects', firstCommit, 'history.jsonl')
	const empty = {
		id: 'stopped',
		question: 'An interrupted question',
		askedAt: original.askedAt,
		outcome: 'stopped',
		steps: [],
	}
	const note = { ...original, id: 'note', about: { kind: 'commits', base: firstCommit, head: original.head } }
	appendFileSync(history, [empty, note].map((row) => `${JSON.stringify(row)}\n`).join(''))
	for (const after of [42, '', 'missing-id', empty.id, note.id]) {
		assert.equal((await call(later, '/api/questions', { question: 'And that?', after })).status, 400)
	}
	assert.equal(
		(await call(later, '/api/questions', { question: 'Which one?', after: original.id, focus: {} })).status,
		400,
	)
	const foreign = await openKen(root, readerHome(), next.baseUrl)
	assert.equal((await call(foreign, '/api/questions', { question: 'And this?', after: original.id })).status, 400)
	assert.equal(next.requests.length, 6)
})

test('a saved question about a drawing reopens the same view and links after a restart', async () => {
	const home = readerHome()
	const model = await scriptedModel([{ text: 'The worker receives a parcel.' }, { text: 'Start with that link.' }])
	const focus = { view: 'runtime', commit: hashes[0], concepts: ['crossing:pickup'], earlier: true }
	const first = await openKen(root, home, model.baseUrl)
	const saved = (await ask(first, { question: 'What does this link do?', focus })).find((line) => line.kind === 'saved')
		?.view.entry
	assert.ok(saved)
	await first.close()
	const later = await openKen(root, home, model.baseUrl)
	const follow = (await ask(later, { question: 'What happens next?', after: saved.id })).find(
		(line) => line.kind === 'saved',
	)?.view.entry
	assert.deepEqual(follow?.focus, focus)
	const prompt = String(model.requests[1]?.messages.at(-1)?.content)
	assert.ok(
		prompt.includes('crossing:pickup') &&
			prompt.includes(focus.commit ?? 'missing') &&
			prompt.includes('worker receives a parcel'),
	)
})
