import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { json, openKen, readerHome } from '../fixtures/ken-server.ts'

for (const working of [false, true]) {
	test(`Home remembers a completed ${working ? 'working-tree' : 'branch'} review until the change moves`, async () => {
		const files = ['orders/save.ts', 'receipts/send.ts']
		const { root } = buildRepository([
			{ message: 'First version', files: Object.fromEntries(files.map((name) => [name, 'first\n'])) },
		])
		const git = (...args: string[]) => execFileSync('git', args, { cwd: root })
		if (!working) git('switch', '-qc', 'delivery')
		for (const file of files) writeFileSync(path.join(root, file), 'second\n')
		if (!working) git('commit', '-qam', 'Update delivery')
		const home = readerHome()
		const server = await openKen(root, home)
		const review = async (at = server) => {
			const { look } = await json(at, '/api/layout')
			return { range: look.change.range, item: look.next.items.find((row: { kind: string }) => row.kind === 'review') }
		}
		const { item, range } = await review()
		assert.equal(item.size.files, 2)
		await json(server, '/api/seen', { did: 'change', change: range, paths: ['orders/save.ts'] })
		const remaining = (await review()).item
		assert.equal(remaining?.size.files, 1)
		assert.equal(remaining?.go.part, 'receipts')
		await json(server, '/api/seen', { did: 'change', change: range, paths: ['receipts/send.ts'] })
		await server.close()
		const reopened = await openKen(root, home)
		assert.equal((await review(reopened)).item, undefined)
		assert.notEqual((await json(reopened, '/api/layout')).wayIn.suggested, 'review')
		writeFileSync(path.join(root, 'receipts/send.ts'), 'third\n')
		if (!working) git('commit', '-qam', 'Revise receipts')
		assert.ok((await review(reopened)).item)
	})
}
