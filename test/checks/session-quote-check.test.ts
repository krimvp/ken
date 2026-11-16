import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSessionQuote } from '../../src/checks/index.ts'
import { claudeCodeTranscripts } from '../../src/transcripts/index.ts'
import { answered, asked, call, claudeProjects, result, writeSession } from '../fixtures/claude-sessions.ts'

const ROOT = '/home/dev/shop'
const projects = claudeProjects()
writeSession(projects, ROOT, 'retry', [
	asked(ROOT, '2026-03-01T10:00:00.000Z', 'Keep the wait fixed.\nNo backoff for now.'),
	answered(ROOT, '2026-03-01T10:00:05.000Z', [call('t1', 'Read', { file_path: `${ROOT}/retry.ts` })]),
	result(ROOT, '2026-03-01T10:00:06.000Z', 't1', 'export const WAIT_MS = 100'),
	answered(ROOT, '2026-03-01T10:02:00.000Z', [
		{ type: 'text', text: 'I kept one fixed wait.\n  Backoff can come later,\n  when a caller needs it.' },
	]),
])
const transcripts = claudeCodeTranscripts(ROOT, { KEN_CLAUDE_PROJECTS: projects })

test('a true quote of a session is found in its message, with who wrote it and when', async () => {
	const agent = await checkSessionQuote(transcripts, {
		session: 'retry',
		text: '  Backoff can come later,\n  when a caller needs it.  ',
	})
	const user = await checkSessionQuote(transcripts, { session: 'retry', text: 'No backoff for now.' })

	assert.deepEqual(agent, {
		kind: 'verified',
		quote: {
			tool: 'Claude Code',
			session: 'retry',
			message: 2,
			by: 'agent',
			at: '2026-03-01T10:02:00.000Z',
			startLine: 2,
			endLine: 3,
			text: '  Backoff can come later,\n  when a caller needs it.',
		},
	})
	assert.deepEqual(
		user.kind === 'verified' && [user.quote.message, user.quote.by, user.quote.at, user.quote.startLine],
		[1, 'user', '2026-03-01T10:00:00.000Z', 2],
	)
})

test('a false quote, half a line, a line without its start, tool output and an unknown session are refused', async () => {
	const cases = [
		{ text: 'I kept two fixed waits.', kind: 'not-found' },
		{ text: 'one fixed wait', kind: 'not-found' },
		{ text: 'Backoff can come later,', kind: 'not-found' },
		{ text: 'export const WAIT_MS = 100', kind: 'not-found' },
		{ text: '   ', kind: 'empty' },
	]
	for (const { text, kind } of cases) {
		const check = await checkSessionQuote(transcripts, { session: 'retry', text })
		assert.equal(check.kind, kind, text)
	}
	const missing = await checkSessionQuote(transcripts, { session: 'gone', text: 'No backoff for now.' })
	assert.deepEqual(missing, { kind: 'no-session', session: 'gone' })
})
