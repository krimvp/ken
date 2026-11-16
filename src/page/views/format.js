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

// The project by its folder name, with the full path in the title.
export function folderHtml(project) {
	return `<code title="${esc(project)}">${esc(project.split('/').at(-1))}</code>`
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
	const whole = Math.round(seconds)
	if (whole < 60) return `${whole} s`
	return `${Math.floor(whole / 60)} min ${whole % 60} s`
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

// A quote of a session names when the session ran and who wrote the lines, and no file or commit. A quote with no path
// is from the message of its commit, so it names the commit and no file.
export function quoteSource(quote) {
	if (isSession(quote)) {
		const who = quote.by === 'user' ? 'what you asked' : 'what the agent said'
		return `From the session of ${gitDay(quote.at)} UTC, ${who}`
	}
	return quote.path === null ? `Commit message of <code>${short(quote.commit)}</code>` : esc(quote.path)
}

export function isSession(quote) {
	return 'session' in quote
}

// A decision's quotes in the order the page shows them: those of its reason, then those that show what was chosen. A
// decision written before ken asked for a reason has none.
export function decisionQuotes(decision) {
	return [...(decision.reason?.quotes ?? []), ...decision.quotes]
}

// The lines of a quote, under a line that names the commit ken found them at, unless its row names it already.
export function quoteBody(quote, where = '', named = false) {
	const lines = quote.text.split('\n')
	const numbers = lines.map((_, k) => quote.startLine + k)
	const at = isSession(quote) || quote.path === null ? '' : `At commit <code>${short(quote.commit)}</code>`
	const source = named || where + at === '' ? '' : `<p class="q-source">${where}${at}</p>`
	return `${source}<pre class="code"><code>${codeLines(lines, numbers)}</code></pre>`
}

// At rest a quote is one row: the file, the lines, and the first quoted line, with the commit when the answer quotes
// more than one. Opened, it shows all its lines: in place, or in the panel on a wide screen, where only the row whose
// quote the panel shows reads as open.
export function quoteRows(quotes, key, { ui, commits }) {
	return `<ul class="quotes">${quotes
		.map((quote, j) => {
			const id = `${key}-q${j}`
			const chosen = ui.wide && ui.panel.kind === 'quote' && ui.panel.key === key && ui.panel.quote === j
			const open = !ui.wide && ui.openQuotes.has(id)
			const first = quote.text.split('\n').find((line) => line.trim() !== '') ?? ''
			const at =
				commits && !isSession(quote) && quote.path !== null
					? `<span class="q-commit">at <code>${short(quote.commit)}</code></span>`
					: ''
			return `<li class="q${chosen ? ' chosen' : ''}">
				<button class="q-row" data-act="quote" data-item="${key}" data-quote="${j}" data-key="${id}" aria-expanded="${ui.wide ? chosen : open}"${ui.wide ? ' aria-controls="panel"' : ''}>
					<span class="q-path">${quoteSource(quote)}</span><span class="q-lines"><span class="nowrap">${lineSpan(quote.startLine, quote.endLine)}</span>${at}</span><span class="q-first">${esc(first.trim())}</span>
				</button>
				${open ? quoteBody(quote, '', commits) : ''}
			</li>`
		})
		.join('')}</ul>`
}

export const LABELS = {
	recorded: {
		name: 'Recorded',
		means:
			'Written down when the work was done: logged with ken decide as the decision was made, or quoted from a commit message.',
	},
	'from-the-session': {
		name: 'From the session',
		means:
			'Read afterwards from a saved session of the coding agent, and quoted. ken found the lines there. It did not check that they give the true reason.',
	},
	inferred: {
		name: 'Inferred',
		means: 'The agent worked this out from the code or the diff. No commit message or note says so.',
	},
	'found-by-search': {
		name: 'Found by search',
		means:
			'A link between pieces of code, such as "this calls that", that the agent found by searching and did not prove.',
	},
}

export function label(name) {
	return `<span class="label label-${esc(name)}">${esc(LABELS[name]?.name ?? name)}</span>`
}
