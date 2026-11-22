// What ken checked for one reply, all of it read from git and none of it from the model: where it found the quotes of
// the cards, the changed code no quote shows, and the commits. On a wide screen it fills the panel; on a narrow one it
// follows the reply. The panel also shows the quotes the reader opened, one item at a time or all of them.
import {
	codeLines,
	copiesOf,
	count,
	esc,
	isSession,
	LABELS,
	label,
	lineSpan,
	list,
	prose,
	quoteBody,
	quoteSource,
	quoteTags,
	short,
	tagHtml,
	when,
} from './format.js'
import { itemsOf } from './reply.js'

const MAX_DIFF_LINES = 60
const FILES_NAMED = 3

function quotesOf(q) {
	return itemsOf([q]).flatMap(({ item }) => item.quotes)
}

function sentBack(q) {
	return q.steps.filter((step) => step.kind === 'sent-back').length
}

function changedLines(hunk) {
	return hunk.lines.filter((line) => line.startsWith('+') || line.startsWith('-')).length
}

function blocks(n) {
	return count(n, 'changed block', 'changed blocks')
}

// asked: when the question was asked, or null when the panel's reply is the last one in the thread, which needs no name.
// The panel leads with what ken found and what no quote shows; the rest waits behind Details.
export function checksHtml(q, ui, asked = null) {
	const which = asked === null ? '' : `<p class="panel-for">For the question you asked at ${asked}.</p>`
	const details = detailsHtml(q)
	return `<div class="panel-head"><h2>What ken checked</h2></div>
		${which}
		<div class="verdict">${verdictHtml(q)}${coverageHtml(q, ui)}${elsewhereHtml(q)}</div>
		${
			details === ''
				? ''
				: `<p class="details-toggle"><button class="link small" data-act="details" data-key="details" aria-expanded="${ui.detailsOpen}">${ui.detailsOpen ? 'Hide details' : 'Details'}</button></p>
		${ui.detailsOpen ? details : ''}`
		}`
}

// Where ken found the quotes, said once.
function verdictHtml(q) {
	const all = quotesOf(q)
	if (all.length === 0) return ''
	const quotes = all.filter((quote) => !isSession(quote))
	const copies = copiesOf(q)
	const inGit = quotes.filter((quote) => !copies.has(quote.commit)).length
	const places = [
		[inGit, 'in git'],
		[quotes.length - inGit, "in ken's copy of your uncommitted work"],
		[all.length - quotes.length, 'in a saved session of your coding agent'],
	].filter(([n]) => n > 0)
	const what = all.length === 1 ? 'the quote' : all.length === 2 ? 'both quotes' : `all ${all.length} quotes`
	const found =
		places.length === 1
			? `ken found ${what} ${places[0][1]}.`
			: `ken found ${what}: ${list(places.map(([n, where]) => `${n} ${where}`))}.`
	return `<p class="verdict-line">${found}</p>`
}

// Behind Details: where the quotes are, the commits, and what ken found complete.
function detailsHtml(q) {
	const all = quotesOf(q)
	const quotes = all.filter((quote) => !isSession(quote))
	const copies = copiesOf(q)
	// A reply about a change names its commits and their messages below, so the quotes need no word on them here.
	const change = q.reply.change
	const commits = [...new Set(quotes.filter((quote) => !copies.has(quote.commit)).map((quote) => short(quote.commit)))]
	const at =
		change || commits.length === 0
			? ''
			: commits.length === 1
				? `<p>The git quotes are at commit <code>${commits[0]}</code>.</p>`
				: `<p>The git quotes are at ${commits.length} commits.</p>`
	const fromMessages = quotes.filter((quote) => quote.path === null).length
	const messages =
		change || fromMessages === 0
			? ''
			: fromMessages === quotes.length
				? `<p>${quotes.length === 1 ? 'The quote is from a commit message' : `All ${quotes.length} quotes are from commit messages`}.</p>`
				: `<p>${fromMessages} of the ${quotes.length} git quotes ${fromMessages === 1 ? 'is from a commit message' : 'are from commit messages'}.</p>`
	const sessions =
		all.length === quotes.length
			? ''
			: '<p>ken found the session quotes in the saved session. It did not check that they give the true reason.</p>'
	const back = sentBack(q)
	const refused =
		back === 0
			? ''
			: `<p>ken's checks refused ${count(back, 'card', 'cards')}, so you do not see ${back === 1 ? 'it' : 'them'}. The steps say why.</p>`
	const quoteFacts = `${at}${messages}${sessions}${refused}`
	return [
		quoteFacts === '' ? '' : `<section class="check" id="check-quotes"><h3>Cards</h3>${quoteFacts}</section>`,
		coveredSection(q),
		followedSection(q),
		commitsSection(q),
	].join('')
}

// The names the change touched that other code uses, where no quote of the reply goes, in one line. Details names them.
function elsewhereHtml(q) {
	const missed = q.reply.change?.usedElsewhere?.notFollowed ?? []
	if (missed.length === 0) return ''
	const [first] = missed
	if (missed.length === 1) {
		return `<p class="gap"><code>${esc(first.name)}</code> is used in ${count(first.places, 'other place', 'other places')}. No quote shows ${first.places === 1 ? 'it' : 'them'}.</p>`
	}
	const places = missed.reduce((sum, name) => sum + name.places, 0)
	return `<p class="gap">The change touched ${missed.length} names that other code uses, in ${places} places. No quote shows them. Details names them.</p>`
}

// Behind Details: the names the change touched that other code uses, whether a quote follows them or not.
function followedSection(q) {
	const used = q.reply.change?.usedElsewhere
	if (!used || (used.followed.length === 0 && used.notFollowed.length === 0)) return ''
	const n = used.followed.length
	const followed =
		n === 0
			? ''
			: `<p>${n === 1 ? 'The change touched one name that other code uses, and a quote shows where.' : `The change touched ${n} names that other code uses, and for each a quote shows where.`}</p>`
	const missed =
		used.notFollowed.length < 2
			? ''
			: `<p>No quote shows where these are used:</p><ul class="used-list">${used.notFollowed
					.map(
						(name) =>
							`<li><code>${esc(name.name)}</code>, in ${count(name.places, 'other place', 'other places')}</li>`,
					)
					.join('')}</ul>`
	return `<section class="check" id="check-elsewhere"><h3>Used elsewhere</h3>${followed}${missed}</section>`
}

// Each label in use, with one plain line of what it means.
export function labelKey(names) {
	return `<dl class="label-key">${names
		.map((name) => `<div><dt>${label(name)}</dt><dd>${prose(LABELS[name].means)}</dd></div>`)
		.join('')}</dl>`
}

// The changed blocks no quote covers, by file, the files with the most uncovered lines first.
function uncoveredFiles(change) {
	const files = new Map()
	for (const changed of change.uncovered) {
		const path = changed.hunk.newLength === 0 ? changed.oldPath : changed.path
		const file = files.get(path) ?? { path, hunks: [], lines: 0 }
		file.hunks.push(changed.hunk)
		file.lines += changedLines(changed.hunk)
		files.set(path, file)
	}
	return [...files.values()].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
}

// The changed blocks no quote covers, with the button that shows them. The reply may quote these files elsewhere, so
// this names the blocks, not the files, as unquoted.
function coverageHtml(q, ui) {
	const change = q.reply.change
	const uncovered = change?.uncovered.length ?? 0
	if (uncovered === 0) return ''
	const total = change.covered.length + uncovered
	const files = uncoveredFiles(change)
	const named = files.slice(0, FILES_NAMED).map((file) => `<code>${esc(file.path)}</code>`)
	const more = files.length > FILES_NAMED ? [count(files.length - FILES_NAMED, 'more file', 'more files')] : []
	const said =
		uncovered === total
			? `No quote shows the ${blocks(total)}, in ${list([...named, ...more])}.`
			: uncovered === 1
				? `${change.covered.length} of the ${blocks(total)} have a quote. The one in ${named[0]} has none.`
				: `${change.covered.length} of the ${blocks(total)} have a quote. The ${uncovered} without one are in ${list([...named, ...more])}.`
	const button = ui.coverageOpen
		? ''
		: ` <button class="link" data-act="coverage" data-key="coverage" aria-expanded="false">Show ${uncovered === 1 ? 'it' : 'them'}</button>`
	return `<div id="check-coverage"><p class="gap">${said}${button}</p>${ui.coverageOpen ? uncoveredHtml(change, files, ui) : ''}</div>`
}

// Behind Details when every changed block has a quote, and the binary files no quote can cover.
function coveredSection(q) {
	const change = q.reply.change
	if (!change) return ''
	const binary =
		change.binary.length === 0
			? ''
			: `<p>No quote can show a binary file: ${list(change.binary.map((path) => `<code>${esc(path)}</code>`))}.</p>`
	const all =
		change.uncovered.length > 0
			? ''
			: `<p>${change.covered.length === 1 ? 'The one changed block has a quote.' : `All ${blocks(change.covered.length)} have a quote.`}</p>`
	return all === '' && binary === '' ? '' : `<section class="check"><h3>Changed code</h3>${all}${binary}</section>`
}

// A file's diff is drawn only once the reader opens it, because one block of a lock file can hold thousands of lines.
// The head of the list stays in view while its diffs scroll, so the reader can always close it.
function uncoveredHtml(change, files, ui) {
	const lines = files.reduce((n, file) => n + file.lines, 0)
	return `<div class="coverage-head" id="coverage-list">
			<p class="small">${count(lines, 'changed line', 'changed lines')} in ${count(files.length, 'file', 'files')} have no quote.</p>
			<button class="quiet-button" data-act="coverage" data-key="coverage" aria-expanded="true">Hide</button>
		</div>
		<div class="files">${files
			.map((file) => {
				const open = ui.openFiles.has(file.path)
				return `<details class="file" data-file="${esc(file.path)}"${open ? ' open' : ''}>
					<summary><code>${esc(file.path)}</code><span class="count">${count(file.hunks.length, 'block', 'blocks')}, ${count(file.lines, 'line', 'lines')}</span></summary>
					${open ? file.hunks.map((hunk) => hunkHtml(hunk, change, file.path)).join('') : ''}
				</details>`
			})
			.join('')}</div>`
}

function hunkHtml(hunk, change, path) {
	const what =
		hunk.oldLength === 0
			? `Adds ${lineSpan(hunk.newStart, hunk.newStart + hunk.newLength - 1)}`
			: hunk.newLength === 0
				? `Removes ${lineSpan(hunk.oldStart, hunk.oldStart + hunk.oldLength - 1)}`
				: `Changes ${lineSpan(hunk.newStart, hunk.newStart + hunk.newLength - 1)}`
	const shown = hunk.lines.slice(0, MAX_DIFF_LINES)
	let oldLine = hunk.oldStart
	let newLine = hunk.newStart
	const numbers = shown.map((line) => (line.startsWith('-') ? oldLine++ : line.startsWith('+') ? newLine++ : ''))
	const kinds = shown.map((line) => (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''))
	const more =
		hunk.lines.length > shown.length
			? `<span class="more">and ${count(hunk.lines.length - shown.length, 'more line', 'more lines')}. See them with git diff ${short(change.base)} ${short(change.head)} -- ${esc(path)}</span>`
			: ''
	return `<div class="hunk"><p class="hunk-head">${what}</p><pre class="code"><code>${codeLines(shown, numbers, kinds)}${more}</code></pre></div>`
}

function commitsSection(q) {
	const change = q.reply.change
	if (!change) return ''
	const copied = copiesOf(q)
	const commits = change.commits.filter((commit) => !copied.has(commit.hash))
	const copies = change.commits.filter((commit) => copied.has(commit.hash))
	const copy =
		copies.length === 0
			? ''
			: `<p>${commits.length === 0 ? 'This reply covers uncommitted work. ' : 'It also covers uncommitted work. '}ken quoted it from its own copy, ${list(copies.map((c) => `<code>${short(c.hash)}</code>`))}, kept on this machine. That copy is not a commit in the repository.</p>`
	if (commits.length === 0)
		return `<section class="check" id="check-commits"><h3>Uncommitted work</h3>${copy}</section>`
	const authors = new Map()
	for (const commit of commits) authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1)
	const names = [...authors].sort((a, b) => b[1] - a[1])
	const by =
		names.length === 1
			? ` Author: ${esc(names[0][0])}.`
			: ` Authors: ${list(names.map(([name, n]) => `${esc(name)} (${n})`))}.`
	const own = new Set(commits.map((commit) => commit.hash))
	const unquoted = new Set((change.messages?.unquoted ?? []).filter((hash) => own.has(hash)))
	const marked = commits.length > 1
	return `<section class="check" id="check-commits">
		<h3>${commits.length === 1 ? 'The commit this reply covers' : `The ${commits.length} commits this reply covers`}</h3>
		<p class="muted small">From git, not from ken's model.${by}</p>
		${messagesLine(change, own)}
		<ol class="commits">${commits
			.map(
				(commit) =>
					`<li><code>${short(commit.hash)}</code><span><q class="subject">${esc(commit.subject)}</q><span class="who muted">${esc(commit.author)}, ${when(commit.date)}${marked && unquoted.has(commit.hash) ? '. Message not quoted' : ''}</span></span></li>`,
			)
			.join('')}</ol>
		${copy}
	</section>`
}

// A merge is not counted: the tool that merged wrote its message. A reply saved before ken counted says nothing.
function messagesLine(change, own) {
	const { messages } = change
	if (!messages) return ''
	const quoted = messages.quoted.filter((hash) => own.has(hash)).length
	const total = quoted + messages.unquoted.filter((hash) => own.has(hash)).length
	if (total === 0) return ''
	const merges = own.size > total ? ' Merges are not counted.' : ''
	const said =
		total === 1
			? quoted === 1
				? 'The cards quote the commit message.'
				: 'The cards do not quote the commit message.'
			: quoted === total
				? `The cards quote all ${total} commit messages.`
				: `The cards quote ${quoted} of the ${total} commit messages.`
	return `<p>${said}${merges}</p>`
}

const TITLES = {
	claim: 'A claim',
	risk: 'A risk',
	decision: 'A decision',
	topic: 'A topic',
	withdrawn: 'A withdrawn risk',
	arrow: 'An arrow between parts',
}

function titleOf({ kind, item }) {
	return kind === 'element' ? `Part ${item.number} of the diagram` : TITLES[kind]
}

function quoteHtml(quote, j, chosen, copies, tag) {
	const source = isSession(quote) || quote.path === null ? quoteSource(quote) : `<code>${esc(quote.path)}</code>`
	const where = `${tagHtml(tag)}${source}, ${lineSpan(quote.startLine, quote.endLine)}. `
	return `<div class="q${chosen ? ' chosen' : ''}" id="panel-q${j}">${quoteBody(quote, where, false, copies)}</div>`
}

// An item's quotes in full, each with the tag its row carries. opened is the one the reader opened, or -1.
function quotesHtml(q, quotes, prefix, opened) {
	const copies = copiesOf(q)
	const tags = quoteTags(quotes, { head: q.head, copies, change: q.reply.change })
	return quotes.map((quote, j) => quoteHtml(quote, `${prefix}${j}`, j === opened, copies, tags[j])).join('')
}

// The panel when the reader opened a quote: its quotes in full come first, then what the label means. The item's own
// text is beside it in the thread, marked as chosen.
export function quoteCardHtml(ui, items) {
	const at = items.findIndex(({ key }) => key === ui.panel.key)
	const shown = items[at]
	if (!shown) return ''
	const { item, q } = shown
	// A box only shows where a part is defined, so it has no label, and neither has a withdrawn risk's proof; an arrow is
	// a claim and has one.
	const means = item.label ?? null
	return `<div class="panel-head"><h2>${titleOf(shown)}</h2>
			<div class="panel-nav">
				<button class="quiet-button" data-act="step" data-by="-1" data-key="prev"${at === 0 ? ' disabled' : ''}>Previous</button>
				<button class="quiet-button" data-act="step" data-by="1" data-key="next"${at === items.length - 1 ? ' disabled' : ''}>Next</button>
				<button class="quiet-button" data-act="close" data-key="close">Close</button>
			</div></div>
		${quotesHtml(q, item.quotes, '', ui.panel.quote)}
		${means === null ? '' : `<p class="label-means">${label(means)}<span>${prose(LABELS[means]?.means ?? '')}</span></p>`}`
}
