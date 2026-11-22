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
	assert.equal((await next())?.size?.files, 2)
	await opened(base, 'delivery')
	const remaining = await next()
	assert.deepEqual(remaining?.parts, ['receipts'])
	assert.equal(remaining?.go.part, 'receipts')
	assert.equal(remaining?.size?.files, 1)
	await opened(base, 'receipts/save.ts')
	assert.equal(await next(), undefined)
})
