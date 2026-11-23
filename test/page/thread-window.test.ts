import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

type Row = { id: string; after?: string | null }
const {
	openingRows,
	threadGaps,
}: {
	openingRows(rows: Row[], selected?: string): Row[]
	threadGaps(rows: Row[], shown: Row[]): Map<number, Row[]>
} = await import(path.join(import.meta.dirname, '../../src/page/ask/thread-window.js'))

test('an old thread opens three replies and pages toward either end without reading a reply twice', () => {
	const rows = Array.from({ length: 32 }, (_, index) => ({ id: String(index + 1) }))
	const shown = openingRows(rows, '18')
	assert.deepEqual(shown, rows.slice(15, 18))
	assert.deepEqual(openingRows(rows), rows.slice(-3))
	for (;;) {
		const [gap] = threadGaps(rows, shown)
		if (!gap) break
		const [pos, page] = gap
		assert.ok(page.length > 0 && page.length <= 3)
		assert.ok(page.every((row) => !shown.includes(row)))
		shown.splice(pos, 0, ...page)
	}
	assert.deepEqual(shown, rows)
})

test('reopening a branch shows its own parent and leaves skipped siblings behind a page control', () => {
	const rows: Row[] = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1) }))
	const old = { id: 'early' }
	const fresh = { id: 'new', after: old.id }
	const branched = [old, ...rows, fresh]
	assert.deepEqual(openingRows(branched, fresh.id), [old, fresh])
	assert.deepEqual(threadGaps(branched, [old, fresh]).get(1), rows.slice(0, 3))
	assert.deepEqual(openingRows([...branched, { id: 'alone', after: null }], 'alone'), [{ id: 'alone', after: null }])
})
