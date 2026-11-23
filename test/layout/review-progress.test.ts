import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lookAtLayout, readLayoutAsk } from '../../src/layout/index.ts'
import type { CommitHash, RepoPath } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { sourcesFor } from '../fixtures/layout-sources.ts'

test('the next merge review resumes at the unread paths of that exact change', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'First version', files: { 'delivery/send.ts': 'send', 'receipts/save.ts': 'save' } },
		{
			message: 'Change how notices are sent and recorded',
			files: { 'delivery/send.ts': 'retry', 'receipts/save.ts': 'retain' },
		},
		{ message: 'Merge pull request #42 from example/notices', parent: 0, merge: 1, files: {} },
	])
	const [base = '', side = '', merge = ''] = hashes
	const sources = await sourcesFor(root)
	const ask = await readLayoutAsk(sources, { change: 'none' }, new Date())
	if (ask.kind !== 'ok') assert.fail(ask.message)
	const next = async () =>
		(await lookAtLayout(sources, ask.ask, new Date())).next.items.find((item) => item.kind === 'review')
	const opened = async (from: string, place: string) =>
		sources.seen.add(
			{ did: 'change', change: { base: from, head: merge }, paths: [place as RepoPath] },
			merge as CommitHash,
			new Date(),
		)

	await opened(side, 'receipts')
	const whole = await next()
	assert.deepEqual([whole?.title, whole?.size?.files], ['Review the merge of pull request #42', 2])
	await opened(base, 'delivery')
	const remaining = await next()
	assert.equal(remaining?.title, 'Continue reviewing the merge of pull request #42', 'the title says it is a merge')
	assert.deepEqual(remaining?.parts, ['receipts'])
	assert.equal(remaining?.go.part, 'receipts')
	assert.equal(remaining?.size?.files, 1)
	await opened(base, 'receipts/save.ts')
	assert.equal(await next(), undefined)
})

test('Home counts a renamed file once and recognizes a review of its old name', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'First version', files: { 'orders/save.ts': 'save the order' } },
		{ message: 'Move saving', files: { 'orders/save.ts': null, 'delivery/save.ts': 'save the order' } },
		{ message: 'Merge delivery', parent: 0, merge: 1, files: {} },
	])
	const sources = await sourcesFor(root)
	const ask = await readLayoutAsk(sources, { change: 'none' }, new Date())
	if (ask.kind !== 'ok') assert.fail(ask.message)
	const next = async () =>
		(await lookAtLayout(sources, ask.ask, new Date())).next.items.find((item) => item.kind === 'review')
	assert.equal((await next())?.size?.files, 1)
	const [base = '', , head = ''] = hashes
	await sources.seen.add(
		{ did: 'change', change: { base, head }, paths: ['orders/save.ts' as RepoPath] },
		head as CommitHash,
		new Date(),
	)
	assert.equal(await next(), undefined)
})
