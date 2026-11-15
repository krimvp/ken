// What ken checked for one answer, all of it read from git and none of it from the model: the quotes, the changed
// hunks no quote covers, and the commits. On a wide screen it fills the panel; on a narrow one it follows the answer.
import { codeLines, count, esc, gitDay, LABELS, label, lineSpan, list, prose, quoteBody, short } from './format.js'

const MAX_DIFF_LINES = 60

function elementsOf(q) {
	return q.answer.diagrams.flatMap((diagram) => diagram.elements)
}

function quotesOf(q) {
	return [...elementsOf(q), ...q.answer.statements, ...decisionsOf(q)].flatMap((item) => item.quotes)
}

function limit(q) {
	const what =
		q.answer.diagrams.length > 0 ? 'the sentences, the summary or the arrows' : 'the sentences or the summary'
	return `ken checks that each quote is in its file at its commit. It does not check ${what}.`
}

function decisionsOf(q) {
	return q.recorded.filter((entry) => entry.kind === 'decision')
}

function sentBack(q) {
	return q.steps.filter((step) => step.kind === 'rejected').length
}

function changedLines(hunk) {
	return hunk.lines.filter((line) => line.startsWith('+') || line.startsWith('-')).length
}

// One line for when the full check is out of view: beside an opened quote, and under the summary on a narrow screen.
export function checkStrip(q) {
	const unchecked = q.answer.diagrams.length > 0 ? 'sentences and arrows not checked' : 'sentences not checked'
	const parts = [`${count(quotesOf(q).length, 'quote', 'quotes')} found`, unchecked]
	const change = q.answer.change
	if (change) {
		const total = change.covered.length + change.uncovered.length
		parts.push(`${change.covered.length} of ${count(total, 'changed hunk', 'changed hunks')} quoted`)
	}
	return parts.join(' · ')
}

export function checksHtml(q, ui) {
	const quotes = quotesOf(q)
	const commits = [...new Set(quotes.map((quote) => short(quote.commit)))]
	const at = commits.length === 1 ? `at <code>${commits[0]}</code>` : `at the ${commits.length} commits they name`
	const back = sentBack(q)
	const backLine =
		back === 0
			? ''
			: `<p class="muted">The quote check sent back ${count(back, 'earlier answer', 'earlier answers')} first.</p>`
	return `<div class="panel-head"><h2>What ken checked</h2></div>
		<p class="panel-limit">${limit(q)}</p>
		<section class="check" id="check-quotes">
			<h3>Quotes</h3>
			<p>${quotes.length} of ${count(quotes.length, 'quote', 'quotes')} found ${at}.</p>
			${whereQuotes(q)}
			${backLine}
			${notChecked(q)}
			<p><button class="link small" data-act="key" data-key="key" aria-expanded="${ui.keyOpen}">${ui.keyOpen ? 'Hide what the labels mean' : 'What the labels mean'}</button></p>
			${ui.keyOpen ? labelKey() : ''}
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
		[sum(q.answer.statements), 'the statements'],
		[sum(decisions), decisions.length === 1 ? 'the decision' : 'the decisions'],
	].filter(([n]) => n > 0)
	if (places.length < 2) return ''
	return `<p class="muted small">${list(places.map(([n, where]) => `${n} in ${where}`))}.</p>`
}

function notChecked(q) {
	if (q.answer.diagrams.length === 0) return '<p class="muted">Not checked: the sentences and the summary.</p>'
	return `<p class="muted">Not checked: the sentences, the summary and the arrows.</p>
		<p class="muted small">An arrow in a diagram is a claim, like a sentence. ken found the lines it quotes. It did not check that the arrow is true.</p>`
}

function labelKey() {
	return `<dl class="label-key">${Object.keys(LABELS)
		.map((name) => `<div><dt>${label(name)}</dt><dd>${esc(LABELS[name].means)}</dd></div>`)
		.join('')}</dl>`
}

function coverageSection(q, ui) {
	const change = q.answer.change
	if (!change) {
		return `<section class="check"><h3>Changed code</h3><p class="muted">None for this answer. It is about the code as it is now, not about a set of commits.</p></section>`
	}
	const total = change.covered.length + change.uncovered.length
	const share = total === 0 ? 0 : change.covered.length / total
	const uncovered = change.uncovered.length
	const button =
		uncovered === 0
			? ''
			: `<p><button class="quiet-button" data-act="coverage" data-key="coverage" aria-expanded="${ui.coverageOpen}">${ui.coverageOpen ? 'Hide the changed code with no quote' : `Show the other ${count(uncovered, 'hunk', 'hunks')} as diffs`}</button></p>`
	const binary =
		change.binary.length === 0
			? ''
			: `<p class="muted small">Binary files, which no quote can cover: ${list(change.binary.map((path) => `<code>${esc(path)}</code>`))}.</p>`
	return `<section class="check" id="check-coverage">
		<h3>Changed code</h3>
		<p class="big"><strong>${change.covered.length} of ${total}</strong> changed hunks quoted</p>
		<div class="bar" role="img" aria-label="${change.covered.length} of ${total} changed hunks quoted"><span data-share="${share}"></span></div>
		<p class="muted small">A hunk is one block of changed lines. The answer shows no code from a hunk it does not quote, so you cannot judge here what it says about that hunk.</p>
		${button}
		${binary}
		${ui.coverageOpen ? uncoveredHtml(change, ui) : ''}
	</section>`
}

// The hunks no quote covers, by file, the files with the most uncovered lines first. A file's diff is drawn only once
// the reader opens it, because one hunk of a lock file can hold thousands of lines.
function uncoveredHtml(change, ui) {
	const files = new Map()
	for (const changed of change.uncovered) {
		const path = changed.hunk.newLength === 0 ? changed.oldPath : changed.path
		const file = files.get(path) ?? { path, hunks: [], lines: 0 }
		file.hunks.push(changed.hunk)
		file.lines += changedLines(changed.hunk)
		files.set(path, file)
	}
	const sorted = [...files.values()].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
	const lines = sorted.reduce((n, file) => n + file.lines, 0)
	return `<p class="small" id="coverage-list">${count(lines, 'changed line', 'changed lines')} in ${count(sorted.length, 'file', 'files')} have no quote. Open a file to see its changes.</p>
		<div class="files">${sorted
			.map((file) => {
				const open = ui.openFiles.has(file.path)
				return `<details class="file" data-file="${esc(file.path)}"${open ? ' open' : ''}>
					<summary><code>${esc(file.path)}</code><span class="count">${count(file.hunks.length, 'hunk', 'hunks')}, ${count(file.lines, 'line', 'lines')}</span></summary>
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
	const authors = new Map()
	for (const commit of change.commits) authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1)
	const by = [...authors].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} by ${esc(name)}`)
	return `<section class="check" id="check-commits">
		<h3>${count(change.commits.length, 'commit', 'commits')}, <code>${short(change.base)}</code> to <code>${short(change.head)}</code></h3>
		<p class="muted small">These facts come straight from git, not from the model.${by.length > 0 ? ` ${list(by)}.` : ''}</p>
		<ol class="commits">${change.commits
			.map(
				(commit) =>
					`<li><code>${short(commit.hash)}</code><span>${esc(commit.subject)}<span class="who muted">${esc(commit.author)}, ${gitDay(commit.date)} UTC</span></span></li>`,
			)
			.join('')}</ol>
	</section>`
}

// The panel when the reader opened a quote: the statement or decision it belongs to, all its quotes in full, and one
// line that keeps the rest of the check in view.
export function quoteCardHtml(q, ui, items) {
	const at = items.findIndex(({ key }) => key === ui.chosen.key)
	const { kind, item, n } = items[at]
	const title = {
		element: `Number ${item.number} in the diagram`,
		decision: 'Decision',
		statement: `Statement ${n} of ${q.answer.statements.length}`,
	}[kind]
	const text = {
		element: prose(item.text),
		decision: `<strong>${prose(item.question)}</strong> Chosen: ${prose(item.chosen)}`,
		statement: prose(item.text),
	}[kind]
	// A box only shows where a part is defined, so it has no label; an arrow is a claim and has one.
	const means = kind === 'element' && item.label === null ? null : item.label
	return `<div class="panel-head"><h2>${title}</h2>
			<div class="panel-nav">
				<button class="quiet-button" data-act="step" data-by="-1" data-key="prev"${at === 0 ? ' disabled' : ''}>Previous</button>
				<button class="quiet-button" data-act="step" data-by="1" data-key="next"${at === items.length - 1 ? ' disabled' : ''}>Next</button>
				<button class="quiet-button" data-act="close" data-key="close">Close</button>
			</div></div>
		<p class="strip">${checkStrip(q)}</p>
		<p class="card-text">${text}</p>
		${means === null ? '' : `<p class="label-means">${label(means)}<span>${esc(LABELS[means]?.means ?? '')}</span></p>`}
		${item.quotes
			.map((quote, j) => {
				const chosen = j === ui.chosen.quote ? ' chosen' : ''
				const where = `<code>${esc(quote.path)}</code>, ${lineSpan(quote.startLine, quote.endLine)}. `
				return `<div class="q${chosen}" id="panel-q${j}">${quoteBody(quote, where)}</div>`
			})
			.join('')}`
}
