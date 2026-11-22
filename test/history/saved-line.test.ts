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

test('damaged saved briefs leave the next question readable and an old unchecked answer can be retried', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'retry.ts': 'export const max = 3\n' } },
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(root)
	const opened = await openHistory(home, repo, fileRecordStore(root, repo))
	if (opened.kind !== 'ok') assert.fail('no repository')
	const base = {
		question: 'What is the limit?',
		askedAt: new Date().toISOString(),
		steps: [],
		outcome: 'answered',
		recorded: [],
	}
	const answers = { concept: 'part::Retry', text: base.question }
	const quote = { path: 'retry.ts', commit: hashes[0], startLine: 1, endLine: 1, text: 'export const max = 3' }
	const step = { kind: 'step', number: 1, text: 'Three retries.' }
	const claim = (q: unknown) => ({
		kind: 'card',
		step: 1,
		card: { kind: 'claim', claim: { text: 'Three retries.', label: 'inferred', quotes: [q] } },
	})
	const reply = { topics: [], change: null, answers, items: [step, claim(quote)] }
	const rows = [
		{ ...reply, items: null },
		{ ...reply, tour: {} },
		{ ...reply, tour: { within: [], stops: [null] } },
		{ ...reply, items: [null] },
		{ ...reply, items: [step, { kind: 'card' }] },
		{ ...reply, items: [step, claim(null)] },
		{ ...reply, items: [{ kind: 'words', text: 'Proposed tool call' }] },
		reply,
	]
	mkdirSync(path.dirname(opened.history.file), { recursive: true })
	const saved = rows.map((reply, id) => JSON.stringify({ ...base, id: String(id), reply }))
	const focus = { path: 'retry.ts', start: 1, end: 1, commit: hashes[0] }
	const prose = { topics: [], change: null, items: [{ kind: 'words', text: 'The model guessed.' }] }
	saved.push(JSON.stringify({ ...base, id: '8', focus, reply: prose }))
	writeFileSync(opened.history.file, saved.join('\n'))
	const entries = await opened.history.list()
	assert.deepEqual(
		entries.map((each) => each.outcome),
		['incomplete', 'answered', 'unverified'],
	)
	assert.deepEqual(
		(await opened.history.readSaved()).map((each) => each.id),
		['7', '8'],
	)
})
