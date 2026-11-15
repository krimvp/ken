// Turns values into text for the page. Everything the agent or git wrote is escaped here before it becomes HTML.

export function esc(value) {
	return String(value).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	)
}

// The agent writes `code` in backticks, and the step sentences do too.
export function prose(text) {
	return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>')
}

export function short(hash) {
	return hash.slice(0, 7)
}

export function count(n, one, many) {
	return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

export function list(items) {
	return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

export function duration(seconds) {
	if (seconds < 60) return `${Math.round(seconds)} s`
	return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "today at 12:31", "yesterday at 09:05", "3 Nov at 17:40", in the reader's own time zone.
export function when(iso, now = new Date()) {
	const at = new Date(iso)
	const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
	const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
	const daysAgo = Math.round((day(now) - day(at)) / 86_400_000)
	if (daysAgo === 0) return `today at ${time}`
	if (daysAgo === 1) return `yesterday at ${time}`
	const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`
	return `${at.getDate()} ${MONTHS[at.getMonth()]}${year} at ${time}`
}

// A git date, which is UTC, as "10 Nov 00:19".
export function gitDay(iso) {
	const d = new Date(iso)
	const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${time}`
}

export function lineSpan(start, end) {
	return start === end ? `line ${start}` : `lines ${start} to ${end}`
}

// Code with a gutter of line numbers. kinds marks diff lines: "add", "del" or "".
export function codeLines(lines, numbers, kinds = []) {
	return lines
		.map((line, i) => {
			const kind = kinds[i] ? ` ${kinds[i]}` : ''
			return `<span class="ln">${numbers[i] ?? ''}</span><span class="lc${kind}">${esc(line) || ' '}</span>`
		})
		.join('')
}

// The lines of a quote, under a line that names the commit ken found them at.
export function quoteBody(quote, where = '') {
	const lines = quote.text.split('\n')
	const numbers = lines.map((_, k) => quote.startLine + k)
	return `<p class="q-source">${where}At commit <code>${short(quote.commit)}</code></p>
		<pre class="code"><code>${codeLines(lines, numbers)}</code></pre>`
}

export const LABELS = {
	inferred: {
		name: 'Inferred',
		means: 'The agent worked this out from the code or the diff. Nobody wrote it down when the work was done.',
	},
	'found-by-search': {
		name: 'Found by search',
		means:
			'A link between pieces of code, such as "this calls that", that the agent found by searching and did not prove.',
	},
}

export function label(name) {
	return `<span class="label">${esc(LABELS[name]?.name ?? name)}</span>`
}
