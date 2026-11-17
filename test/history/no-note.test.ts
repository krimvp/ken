import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatEvent } from '../../src/agent/index.ts'
import { entryFrom, whyNoNote } from '../../src/history/index.ts'

const asked = {
	id: 'n1',
	question: 'Explain the last commit.',
	askedAt: '2026-11-16T06:40:00.000Z',
	head: null,
	thread: 't1',
}

test('a live note with no reply says why, with its own sentence for each way it can end', () => {
	const ends: [string, ChatEvent[], boolean][] = [
		['no-answer', [{ kind: 'done', outcome: 'no-answer' }], false],
		['out-of-turns', [{ kind: 'done', outcome: 'out-of-turns' }], false],
		['stopped', [{ kind: 'error', message: 'aborted' }], true],
		['error', [{ kind: 'error', message: 'Invalid API key.' }], false],
	]
	const said = ends.map(([outcome, events, stopped]) => {
		const entry = entryFrom(asked, events, stopped)
		assert.equal(entry.outcome, outcome)
		return whyNoNote(entry) ?? ''
	})

	assert.equal(new Set(said).size, ends.length, `two endings share a sentence: ${said.join(' | ')}`)
	assert.match(said[3] ?? '', /Invalid API key\./)
	assert.ok(!said.some((sentence) => /checked/.test(sentence)), 'a note with no reply is not called checked')
})
