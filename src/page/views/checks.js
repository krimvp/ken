// What ken checked for one answer, all of it read from git and none of it from the model: the quotes, the changed
// blocks no quote covers, and the commits. On a wide screen it fills the panel; on a narrow one it follows the answer.
// The panel also shows the quotes the reader opened, one item at a time or all of them.
import {
	codeLines,
	copiesOf,
	count,
	decisionQuotes,
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

const MAX_DIFF_LINES = 60
const FILES_NAMED = 3

function elementsOf(q) {
	return q.answer.diagrams.flatMap((diagram) => diagram.elements)
}

function quotesOf(q) {
	return [
		...[...elementsOf(q), ...q.answer.statements, ...(q.answer.risks ?? [])].flatMap((item) => item.quotes),
		...decisionsOf(q).flatMap(decisionQuotes),
	]
}

function limit(q) {
	const what =
		q.answer.diagrams.length > 0 ? 'the sentences, the summary or the arrows' : 'the sentences or the summary'
	const where = quotesOf(q).some(isSession) ? ', or in its saved session' : ''
	return `ken checks that each quote is in its file, or in its commit's message, at its commit${where}. It does not check ${what}.`
}

function decisionsOf(q) {
	return [...q.recorded.filter((entry) => entry.kind === 'decision'), ...(q.draft ?? [])]
}

function sentBack(q) {
	return q.steps.filter((step) => step.kind === 'rejected').length
}

function changedLines(hunk) {
	return hunk.lines.filter((line) => line.startsWith('+') || line.startsWith('-')).length
}

function blocks(n) {
	return count(n, 'changed block', 'changed blocks')
}

// One line for when the full check is out of view: beside an opened quote, and above the statements on a narrow screen.
export function checkStrip(q) {
	const unchecked = q.answer.diagrams.length > 0 ? 'sentences and arrows not checked' : 'sentences not checked'
	const parts = [`${count(quotesOf(q).length, 'quote', 'quotes')} found`, unchecked]
	const change = q.answer.change
	if (change) {
		const total = change.covered.length + change.uncovered.length
		parts.push(`${change.covered.length} of ${blocks(total)} quoted`)
	}
	return parts.join(' · ')
}

export function checksHtml(q, ui) {
	const all = quotesOf(q)
	const quotes = all.filter((quote) => !isSession(quote))
	const copies = copiesOf(q)
	const inGit = quotes.filter((quote) => !copies.has(quote.commit))
	const inCopy = quotes.length - inGit.length
	const commits = [...new Set(inGit.map((quote) => short(quote.commit)))]
	const at = commits.length === 1 ? `at <code>${commits[0]}</code>` : `across ${commits.length} commits`
	const fromSessions = all.length - quotes.length
	const places = [
		[inGit.length, `in git ${at}`],
		[inCopy, "in ken's copy of your uncommitted work"],
		[fromSessions, 'in a saved session of your coding agent'],
	].filter(([n]) => n > 0)
	const match =
		places.length > 1
			? `All ${all.length} quotes were found: ${list(places.map(([n, where]) => `${n} ${where}`))}.`
			: inGit.length === 0
				? `${inCopy === 1 ? 'The quote is' : `All ${inCopy} quotes are`} in ken's copy of your uncommitted work.`
				: inGit.length === 1
					? `The quote matches git, ${at}.`
					: inGit.length === 2
						? `Both quotes match git, ${at}.`
						: `All ${inGit.length} quotes match git, ${at}.`
	const gitLine = quotes.length === 0 ? '' : `<p>${match}</p>`
	const fromMessages = quotes.filter((quote) => quote.path === null).length
	const messageLine =
		fromMessages === 0
			? ''
			: `<p class="muted small">${fromMessages === quotes.length ? 'All' : fromMessages} of the git quotes ${fromMessages === 1 ? 'is' : 'are'} from commit messages.</p>`
	const sessionLine =
		fromSessions === 0
			? ''
			: `<p>${quotes.length === 0 ? `${fromSessions === 1 ? 'The quote is' : `All ${fromSessions} quotes are`} from a saved session of your coding agent. ` : ''}ken found the lines in the saved session. It did not check that they give the true reason.</p>`
	const back = sentBack(q)
	const backLine =
		back === 0
			? ''
			: `<p class="muted">ken rejected ${count(back, 'earlier draft', 'earlier drafts')} first, because a quote did not match.</p>`
	return `<div class="panel-head"><h2>What ken checked</h2></div>
		<p class="panel-limit">${limit(q)}</p>
		<section class="check" id="check-quotes">
			<h3>Quotes</h3>
			${gitLine}
			${messageLine}
			${sessionLine}
			${whereQuotes(q)}
			${backLine}
			<p><button class="link small" data-act="key" data-key="key" aria-expanded="${ui.keyOpen}">${ui.keyOpen ? 'Hide what the labels mean' : 'What the labels mean'}</button></p>
			${ui.keyOpen ? labelKey(labelsOf(q)) : ''}
		</section>
		${coverageSection(q, ui)}
		${commitsSection(q)}`
}

// The list of statements counts only their own quotes, so say where the others are.
function whereQuotes(q) {
	const decisions = decisionsOf(q)
	const sum = (items) => items.reduce((n, item) => n + item.quotes.length, 0)
	const places = [
		[sum(elementsOf(q)), q.answer.diagrams.length === 1 ? 'the diagram' : 'the diagrams'],
		[sum(q.answer.risks ?? []), q.answer.risks?.length === 1 ? 'the risk' : 'the risks'],
		[sum(q.answer.statements), 'the statements'],
		[decisions.flatMap(decisionQuotes).length, decisions.length === 1 ? 'the decision' : 'the decisions'],
	].filter(([n]) => n > 0)
	if (places.length < 2) return ''
	return `<p class="muted small">${list(places.map(([n, where]) => `${n} in ${where}`))}.</p>`
}

// The labels this answer uses, in the order of LABELS.
function labelsOf(q) {
	const items = [...elementsOf(q), ...q.answer.diagrams, ...q.answer.statements, ...(q.answer.risks ?? [])]
	const used = new Set([...items, ...decisionsOf(q)].map((item) => item.label))
	return Object.keys(LABELS).filter((name) => used.has(name))
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

function coverageSection(q, ui) {
	const change = q.answer.change
	if (!change) {
		return `<section class="check"><h3>Changed code</h3><p class="muted">Not checked. This answer is not about a set of commits, so there is no changed code to compare.</p></section>`
	}
	const total = change.covered.length + change.uncovered.length
	const uncovered = change.uncovered.length
	const binary =
		change.binary.length === 0
			? ''
			: `<p class="muted small">Binary files, which no quote can cover: ${list(change.binary.map((path) => `<code>${esc(path)}</code>`))}.</p>`
	if (uncovered === 0) {
		return `<section class="check" id="check-coverage"><h3>Changed code</h3><p>${change.covered.length} of ${blocks(total)} quoted.</p>${binary}</section>`
	}
	const files = uncoveredFiles(change)
	const named = files.slice(0, FILES_NAMED).map((file) => `<code>${esc(file.path)}</code>`)
	const more = files.length > FILES_NAMED ? [count(files.length - FILES_NAMED, 'more file', 'more files')] : []
	// The answer may quote these files elsewhere, so this names the blocks, not the files, as unquoted.
	const where =
		uncovered === 1
			? `One changed block in ${named[0]} is not quoted.`
			: `${blocks(uncovered)} are not quoted, in ${list([...named, ...more])}.`
	const button = ui.coverageOpen
		? ''
		: `<p><button class="quiet-button" data-act="coverage" data-key="coverage" aria-expanded="false">Show the ${uncovered === 1 ? 'unquoted block' : `${uncovered} unquoted blocks`}</button></p>`
	return `<section class="check" id="check-coverage">
		<h3>Changed code</h3>
		<p>${change.covered.length} of ${blocks(total)} quoted.</p>
		<p class="muted">${where}</p>
		${button}
		${binary}
		${ui.coverageOpen ? uncoveredHtml(change, files, ui) : ''}
	</section>`
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
	const change = q.answer.change
	if (!change) return ''
	const copied = copiesOf(q)
	const commits = change.commits.filter((commit) => !copied.has(commit.hash))
	const copies = change.commits.filter((commit) => copied.has(commit.hash))
	const copy =
		copies.length === 0
			? ''
			: `<p>${commits.length === 0 ? 'This answer covers uncommitted work. ' : 'It also covers uncommitted work. '}ken quoted it from its own copy, ${list(copies.map((c) => `<code>${short(c.hash)}</code>`))}, kept on this machine. That copy is not a commit in the repository.</p>`
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
		<h3>${commits.length === 1 ? 'The commit this answer covers' : `The ${commits.length} commits this answer covers`}</h3>
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

// A merge is not counted: the tool that merged wrote its message. An answer saved before ken counted says nothing.
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
				? 'The answer quotes the commit message.'
				: 'The answer does not quote the commit message.'
			: quoted === total
				? `The answer quotes all ${total} commit messages.`
				: `The answer quotes ${quoted} of the ${total} commit messages.`
	return `<p>${said}${merges}</p>`
}

// What a numbered part of a diagram is, as a node and as an edge.
const PART = {
	component: ['Box', 'Arrow'],
	sequence: ['Participant', 'Message'],
	'entity-relationship': ['Entity', 'Relation'],
}

function titleOf(q, { kind, item, n, diagram }) {
	if (kind === 'element')
		return `${PART[diagram.kind]?.[item.label === null ? 0 : 1] ?? 'Part'} ${item.number} of the diagram`
	if (kind === 'decision') return `Decision ${n} of ${decisionsOf(q).length}`
	if (kind === 'risk') return `Risk ${n} of ${q.answer.risks.length}`
	return `Statement ${n} of ${q.answer.statements.length}`
}

function textOf({ kind, item }) {
	if (kind === 'decision') return `${prose(item.question)} <span class="d-field">Chosen</span> ${prose(item.chosen)}`
	return prose(item.text)
}

function quoteHtml(quote, j, chosen, copies, tag) {
	const source = isSession(quote) || quote.path === null ? quoteSource(quote) : `<code>${esc(quote.path)}</code>`
	const where = `${tagHtml(tag)}${source}, ${lineSpan(quote.startLine, quote.endLine)}. `
	return `<div class="q${chosen ? ' chosen' : ''}" id="panel-q${j}">${quoteBody(quote, where, false, copies)}</div>`
}

// An item's quotes in full, each with the tag its row carries. opened is the one the reader opened, or -1.
function quotesHtml(q, quotes, prefix, opened) {
	const copies = copiesOf(q)
	const tags = quoteTags(quotes, { head: q.head, copies, change: q.answer.change })
	return quotes.map((quote, j) => quoteHtml(quote, `${prefix}${j}`, j === opened, copies, tags[j])).join('')
}

// The panel when the reader opened a quote: its quotes in full come first, then what the label means. The item's own
// text is beside it in the thread, marked as chosen.
export function quoteCardHtml(q, ui, items) {
	const at = items.findIndex(({ key }) => key === ui.panel.key)
	const shown = items[at]
	const { kind, item } = shown
	// A box only shows where a part is defined, so it has no label; an arrow is a claim and has one.
	const means = kind === 'element' && item.label === null ? null : item.label
	return `<div class="panel-head"><h2>${titleOf(q, shown)}</h2>
			<div class="panel-nav">
				<button class="quiet-button" data-act="step" data-by="-1" data-key="prev"${at === 0 ? ' disabled' : ''}>Previous</button>
				<button class="quiet-button" data-act="step" data-by="1" data-key="next"${at === items.length - 1 ? ' disabled' : ''}>Next</button>
				<button class="quiet-button" data-act="close" data-key="close">Close</button>
			</div></div>
		${quotesHtml(q, item.quotes, '', ui.panel.quote)}
		${means === null ? '' : `<p class="label-means">${label(means)}<span>${prose(LABELS[means]?.means ?? '')}</span></p>`}`
}

// The panel when the reader opened all quotes: every item that carries quotes, in the order of the answer.
export function allQuotesHtml(q, items) {
	return `<div class="panel-head"><h2>All quotes</h2>
			<div class="panel-nav"><button class="quiet-button" data-act="close" data-key="close">Close</button></div></div>
		${items
			.map(
				(shown) => `<section class="all-item">
					<h3>${titleOf(q, shown)}</h3>
					<p class="card-text">${textOf(shown)}</p>
					${quotesHtml(q, shown.item.quotes, `${shown.key}-`, -1)}
				</section>`,
			)
			.join('')}`
}
