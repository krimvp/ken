import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { openHistory } from '../../src/history/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

test('an answer saved before ken replied in words shows the decision it stored in the record and the one it kept as a draft, the one that needs the owner first', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: { 'src/retry.ts': '\t\tsleep(100)\n' } }])
	const [first = ''] = hashes
	const repo = gitRepository(root)
	const record = fileRecordStore(root, repo)
	const quote = { path: 'src/retry.ts', commit: first, text: '\t\tsleep(100)' }
	const decision = {
		kind: 'decision' as const,
		question: 'How long does a retry wait?',
		chosen: 'A fixed 100 ms',
		reason: { text: 'Simple.', quotes: [] },
		rejected: [],
		undo: 'easy',
		needsOwner: false,
		quotes: [quote],
		work: null,
	}
	const appended = await record.append([decision])
	const stored = appended.kind === 'appended' ? appended.entries[0]?.entry : undefined
	assert.ok(stored?.kind === 'decision')
	const draft = { ...stored, id: 'draft-1', question: 'Should a retry wait at all?', needsOwner: true }
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const line = {
		id: 'old-1',
		question: 'What changed?',
		askedAt: '2026-11-01T10:00:00.000Z',
		steps: [],
		outcome: 'answered',
		answer: { summary: 'Retries wait.', statements: [], change: null },
		recorded: [stored.id],
		draft: [draft],
	}
	mkdirSync(path.join(home, 'projects', first), { recursive: true })
	writeFileSync(path.join(home, 'projects', first, 'history.jsonl'), `${JSON.stringify(line)}\n`)
	const opened = await openHistory(home, repo, record)
	assert.ok(opened.kind === 'ok')

	const [entry] = await opened.history.list()

	assert.ok(entry?.outcome === 'answered')
	const questions = entry.reply.items.flatMap((item) =>
		item.kind === 'card' && item.card.kind === 'decision' ? [item.card.decision.question] : [],
	)
	assert.deepEqual(questions, [draft.question, decision.question])
})
