import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatEvent } from '../../src/agent/index.ts'
import { entryFrom, whyNoNote } from '../../src/history/index.ts'

const asked = { id: 'n1', question: 'Explain the last commit.', askedAt: '2026-11-16T06:40:00.000Z', head: null }
const rejected = (attempt: number): ChatEvent => ({
	kind: 'rejected',
	attempt,
	problems: ['A quote is not in src/a.ts.'],
})

test('a live note with no answer says why, with its own sentence for each way it can end', () => {
	const ends: [string, ChatEvent[], boolean][] = [
		['rejected', [rejected(1), rejected(2), rejected(3), { kind: 'done', outcome: 'rejected' }], false],
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
	assert.match(said[0] ?? '', /could not find one of its quotes/)
	assert.match(said[4] ?? '', /Invalid API key\./)
	assert.ok(!said.some((sentence) => /checked/.test(sentence)), 'a note with no answer is not called checked')
})
