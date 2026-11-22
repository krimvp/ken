import assert from 'node:assert/strict'
import { test } from 'node:test'

// A zone far from UTC, so a time or a day read in UTC shows here. Node reads TZ again when it changes.
process.env.TZ = 'Asia/Kolkata'
const { at, day, onDay, when } = await import('../../src/follow-up/index.ts')

test('the terminal writes a moment in the reader time zone, as the page does', () => {
	const now = new Date('2026-11-16T12:00:00Z')
	const cases: [string, string, string][] = [
		['2026-11-16T01:06:00Z', '06:36', 'at 06:36'],
		['2026-11-15T20:00:00Z', '01:30', 'at 01:30'],
		['2026-11-15T01:06:00Z', '15 Nov 06:36', 'on 15 Nov 06:36'],
		['2025-11-16T01:06:00Z', '16 Nov 2025 06:36', 'on 16 Nov 2025 06:36'],
	]
	for (const [iso, said, inSentence] of cases) {
		assert.equal(when(iso, now), said, iso)
		assert.equal(at(iso, now), inSentence, iso)
	}
	assert.equal(onDay('2026-11-16', now), 'earlier today')
	assert.equal(onDay('2026-11-02', now), 'on 2 Nov')
	assert.equal(onDay('2025-11-16', now), 'on 16 Nov 2025')
	assert.equal(day('2026-11-15T20:00:00Z', now), 'today', "the day is the reader's, and there it is already the 16th")
	assert.equal(day('2026-11-02T01:06:00Z', now), '2 Nov')
	assert.equal(day('2025-11-16T01:06:00Z', now), '16 Nov 2025')
})
