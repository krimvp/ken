import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'

test('the brief checker distinguishes checked quotes, unfinished runs and replies it cannot score', (t) => {
	const { root, hashes } = buildRepository([
		{ message: 'Add the cutoff', files: { 'cutoff.js': 'const cutoff = 15\n' } },
	])
	const runs = mkdtempSync(path.join(tmpdir(), 'ken-brief-check-'))
	t.after(() => rmSync(runs, { recursive: true, force: true }))
	const save = (name: string, entry?: object) => {
		const file = path.join(runs, name)
		writeFileSync(file, entry ? JSON.stringify({ kind: 'saved', view: { entry } }) : '')
		return file
	}
	const run = (...files: string[]) =>
		spawnSync(process.execPath, ['scripts/bench/check-reply.ts', '--repo', root, ...files], { encoding: 'utf8' })
	const words = { items: [{ kind: 'words', text: 'The cutoff is after 15:00.' }] }
	const quote = { path: 'cutoff.js', commit: hashes[0], startLine: 1, endLine: 1, text: 'const cutoff = 15' }
	const card = { kind: 'card', card: { kind: 'claim', claim: { quotes: [quote] } } }
	const good = save('good', { outcome: 'answered', reply: { items: [card] } })
	assert.equal(run(good).status, 0)
	const batch = run(
		good,
		save('empty'),
		save('miss', { outcome: 'unverified', reply: words }),
		save('prose', { outcome: 'answered', reply: words }),
	)
	assert.equal(batch.status, 1)
	assert.match(batch.stdout, /No saved reply/)
	assert.match(batch.stdout, /unverified/)
	assert.match(batch.stdout, /No claim or topic quotes/)
})
