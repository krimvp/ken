// Open the chosen reply with two preceding answers. Read another three only when the reader asks.
const PAGE = 3

export const threadId = (row) => row.thread ?? row.id

export function openingRows(rows, selected) {
	const indexes = new Map(rows.map((row, index) => [row.id, index]))
	let at = selected ? (indexes.get(selected) ?? -1) : rows.length - 1
	const opened = []
	while (at >= 0 && opened.length < PAGE) {
		const row = rows[at]
		opened.unshift(row)
		// Before ken saved the parent of a reply, its previous turn was the preceding row.
		const prior = row.after === undefined ? at - 1 : indexes.get(row.after)
		if (prior === undefined || prior >= at) break
		at = prior
	}
	return opened
}

// Gaps before, after, or between visible replies. A follow-up on an older answer can skip later replies in its thread.
export function threadGaps(rows, shown) {
	const indexes = new Map(rows.map((row, index) => [row.id, index]))
	const gaps = new Map()
	let next = 0
	for (let pos = 0; pos <= shown.length; pos++) {
		const end = indexes.get(shown[pos]?.id) ?? rows.length
		if (end > next) {
			const start = pos === 0 ? Math.max(next, end - PAGE) : next
			gaps.set(pos, rows.slice(start, Math.min(end, start + PAGE)))
		}
		next = end + 1
	}
	return gaps
}
