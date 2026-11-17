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
	return `${Math.floor(whole / 60)} min${whole % 60 === 0 ? '' : ` ${whole % 60} s`}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

// The page's one way to write a moment, in the reader's own time zone: "06:36" today, "16 Nov 06:36" on another day,
// "16 Nov 2025 06:36" in another year. Git dates carry their offset, so they read the same way. The terminal's twin of
// when and at is src/follow-up/when.ts: change both together.
export function when(iso, now = new Date()) {
	const at = new Date(iso)
	const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
	if (at.toDateString() === now.toDateString()) return time
	const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`
	return `${at.getDate()} ${MONTHS[at.getMonth()]}${year} ${time}`
}

// The same moment in a sentence: "at 06:36", "on 16 Nov 06:36".
export function at(iso) {
	const said = when(iso)
	return said.includes(' ') ? `on ${said}` : `at ${said}`
}

// A day with no time, such as a map line's 2026-11-16: "today", "16 Nov", "16 Nov 2025".
export function day(date, now = new Date()) {
	const [year, month, d] = date.split('-').map(Number)
	if (year === now.getFullYear() && month === now.getMonth() + 1 && d === now.getDate()) return 'today'
	return `${d} ${MONTHS[month - 1]}${year === now.getFullYear() ? '' : ` ${year}`}`
}

// A button that runs ken's model, with what that costs beside it.
export function withCost(button, cost = 'One model run.') {
	return `<span class="with-cost">${button}<span class="small muted">${cost}</span></span>`
}

export function lineSpan(start, end) {
	return start === end ? `line ${start}` : `lines ${start} to ${end}`
}

// A session quote counts its lines within the one message it quotes.
function quoteLines(quote) {
	return `${lineSpan(quote.startLine, quote.endLine)}${isSession(quote) ? ' of the message' : ''}`
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
		const who = quote.by === 'user' ? 'what you asked' : 'what your coding agent said'
		return `Session ${when(quote.at)}, ${who}`
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

const NONE = new Set()

// ken's copy of uncommitted work is a commit only in ken's own store, written as "ken" with no message (see the live
// module). These are the hashes of the copies a reply's change holds.
export function copiesOf(q) {
	const commits = q.reply?.change?.commits ?? []
	return new Set(commits.filter((commit) => commit.email === 'ken@localhost').map((commit) => commit.hash))
}

// The lines of a quote, under a line that names the commit ken found them at, or ken's copy of uncommitted work,
// unless its row names it already.
export function quoteBody(quote, where = '', named = false, copies = NONE) {
	const lines = quote.text.split('\n')
	const numbers = lines.map((_, k) => quote.startLine + k)
	const at =
		isSession(quote) || quote.path === null
			? ''
			: copies.has(quote.commit)
				? "In ken's copy of your uncommitted work"
				: `At commit <code>${short(quote.commit)}</code>`
	const source = named || where + at === '' ? '' : `<p class="q-source">${where}${at}</p>`
	return `${source}<pre class="code"><code>${codeLines(lines, numbers)}</code></pre>`
}

// When an item quotes one file at more than one commit, each quote of it gets a tag, so the rows of a changed line tell
// apart. ken's copy of uncommitted work sits on top of HEAD, so a quote of it is "now"; failing that, a quote at the HEAD
// the question was asked at is "now". Every other quote of that file is older: "before". With neither, the commits of
// the change the reply explains give the order, newest first and then the commit it starts from: the newest is
// "after", since later commits may have changed it again. A file whose commits ken cannot place gets no tag.
export function quoteTags(quotes, { head = null, copies = NONE, change = null }) {
	const order = change ? [...change.commits.map((commit) => commit.hash), change.base] : []
	return quotes.map((quote) => {
		if (isSession(quote) || quote.path === null) return null
		const commits = new Set(
			quotes.filter((other) => !isSession(other) && other.path === quote.path).map((other) => other.commit),
		)
		if (commits.size < 2) return null
		const newest = [...commits].some((commit) => copies.has(commit)) ? copies : new Set([head])
		if ([...commits].some((commit) => newest.has(commit))) return newest.has(quote.commit) ? 'now' : 'before'
		if (![...commits].every((commit) => order.includes(commit))) return null
		const first = Math.min(...[...commits].map((commit) => order.indexOf(commit)))
		return order.indexOf(quote.commit) === first ? 'after' : 'before'
	})
}

const TAG_MEANS = {
	now: 'now: this file as it is now, at the newest commit or in your uncommitted work',
	before: 'before: an older version of this file',
	after: 'after: this file just after the change; a later commit may have changed it again',
}

export function tagHtml(tag) {
	return tag ? `<span class="q-then" title="${TAG_MEANS[tag]}">${tag}</span>` : ''
}

// At rest a quote is one row: the file, the lines, and the first quoted line, with the commit when the reply quotes
// more than one. Opened, it shows all its lines: in place, or in the panel on a wide screen, where only the row whose
// quote the panel shows reads as open.
export function quoteRows(quotes, key, { ui, commits, head = null, copies = NONE, change = null }) {
	const tags = quoteTags(quotes, { head, copies, change })
	return `<ul class="quotes">${quotes
		.map((quote, j) => {
			const then = tagHtml(tags[j])
			const id = `${key}-q${j}`
			const chosen = ui.wide && ui.panel.kind === 'quote' && ui.panel.key === key && ui.panel.quote === j
			const open = !ui.wide && ui.openQuotes.has(id)
			const first = quote.text.split('\n').find((line) => line.trim() !== '') ?? ''
			const at =
				commits && !isSession(quote) && quote.path !== null
					? `<span class="q-commit">${copies.has(quote.commit) ? "in ken's copy" : `at <code>${short(quote.commit)}</code>`}</span>`
					: ''
			return `<li class="q${chosen ? ' chosen' : ''}">
				<button class="q-row" data-act="quote" data-item="${key}" data-quote="${j}" data-key="${id}" aria-expanded="${ui.wide ? chosen : open}"${ui.wide ? ' aria-controls="panel"' : ''}>
					<span class="q-path">${quoteSource(quote)}</span><span class="q-lines">${then}<span class="nowrap">${quoteLines(quote)}</span>${at}</span>${first ? `<span class="q-first">${esc(first.trim())}</span>` : ''}
				</button>
				${open ? quoteBody(quote, '', commits, copies) : ''}
			</li>`
		})
		.join('')}</ul>`
}

export const LABELS = {
	recorded: {
		name: 'Recorded',
		means:
			'Written down when the work was done: quoted from a commit message, or logged by your coding agent with `ken decide` as it worked. ken did not check the reason.',
	},
	'from-the-session': {
		name: 'From the session',
		means:
			"The reason is quoted from your coding agent's saved session. ken found the lines there. It did not check that they give the true reason.",
	},
	inferred: {
		name: 'Inferred',
		means: "Worked out by ken's model from the code or the diff. No commit message or session says so.",
	},
	'found-by-search': {
		name: 'Found by search',
		means:
			'A link between pieces of code, such as "this calls that", that ken\'s model found by searching and did not prove.',
	},
}

// ken's own marks on a risk of a change, which it sets from git, and what each means. The label key
// and each mark's tooltip say the meaning, so the note under the risks stays short.
export const RISK_MARKS = {
	outside: 'Quotes code outside the change',
	outsideMeans:
		'A quote of the risk lies wholly outside the lines the change touched, at its last commit. ken checks where the quote is, not whether the risk is true.',
	inside: 'Quotes only the changed lines',
	insideMeans:
		'Every quote of a file in the risk holds a line the change touched. A risk that quotes no file, only commit messages, has neither mark.',
	fixed: 'Fixed since, in',
	fixedMeans:
		'The risk quotes the message of a commit made after the change, the one named, which says what was wrong. ken shows these risks after the open ones.',
}

// The weight ken's model gives a risk, and what each means. ken does not judge it.
export const WEIGHT_MEANS = {
	serious:
		"ken's model weighs it serious: someone who uses the code in the normal way loses work, gets a wrong result or a failure, or finds refused what worked before. ken does not judge the weight.",
	minor: "ken's model weighs it minor: it needs a rare case or costs little. ken does not judge the weight.",
}

export function label(name) {
	return `<span class="label label-${esc(name)}">${esc(LABELS[name]?.name ?? name)}</span>`
}

// The owner's answer to a decision, said back to them. An answer saved before ken asked for an outcome has none.
const OUTCOME = { keep: 'You kept what was chosen', change: 'You asked for a change', null: 'You decided' }

export function answeredHtml(answer) {
	const note = answer.note ? ` Your note: ${prose(answer.note)}` : ''
	return `<strong>${OUTCOME[answer.outcome ?? 'null']} ${at(answer.at)}.</strong>${note}`
}

// The record's "who did it" for a commit, said to the reader.
export const WHO = {
	owner: 'you',
	'owner-agent': 'your coding agent',
	collaborator: 'a collaborator',
	unknown: 'git cannot tell who',
}
