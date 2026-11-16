// What is open, on the page: the decisions that need the reader's call, each with "I have decided" and a note, and the
// topics whose code changed since the reader understood them, with the commits that changed them and who made each. ken
// works the list out from the record, the map and git; the page only shows it.
import { decisionHtml } from './answer.js'
import { esc, gitDay, list, prose, short, WHO } from './format.js'
import { mapDay } from './map.js'

export function openCount(open) {
	return open ? open.decisions.length + open.topics.length : 0
}

function linesText(lines) {
	return list(
		lines.map(({ path, startLine, endLine }) =>
			startLine === endLine
				? `<code>${esc(path)}</code> line ${startLine}`
				: `<code>${esc(path)}</code> lines ${startLine} to ${endLine}`,
		),
	)
}

function decisionItem(d, i, ui) {
	const key = `o${i}`
	return `<li class="o-decision">
		<ul class="o-card">${decisionHtml(d, key, { ui, commits: true }, new Set(['recorded', 'inferred']))}</ul>
		<form class="decide-form" data-id="${esc(d.id)}" autocomplete="off">
			<label for="note-${key}">Your note, if you want to keep one</label>
			<textarea id="note-${key}" name="note" rows="2" maxlength="1200"></textarea>
			<button class="quiet-button" type="submit">I have decided</button>
		</form>
	</li>`
}

function commitsHtml(commits) {
	if (commits.length === 0) return '<p class="o-commits muted small">ken found no commit to these files since then.</p>'
	return `<ul class="o-commits">${commits
		.map(
			(c) =>
				`<li><code>${short(c.hash)}</code> ${prose(c.subject)}<span class="o-by">${esc(c.author)}, ${WHO[c.by] ?? esc(c.by)}, on ${gitDay(c.date)}</span></li>`,
		)
		.join('')}</ul>`
}

function topicItem({ state, commits }, canAsk) {
	const topic = esc(state.topic)
	const explain = canAsk
		? `<button class="quiet-button" data-act="explain-topic" data-topic="${topic}" data-key="explain-${topic}">Explain what changed</button>`
		: ''
	return `<li class="t-row o-topic">
		<p class="t-head"><span class="t-name">${topic}</span> <span class="t-state">You understood it on ${mapDay(state.entry.date)}</span></p>
		<p class="t-lines">Changed since: ${linesText(state.changed)}</p>
		${commitsHtml(commits)}
		<div class="map-buttons">${explain}<button class="quiet-button" data-act="know-topic" data-topic="${topic}" data-key="know-${topic}">I know this</button></div>
	</li>`
}

export function openViewHtml(open, ui, canAsk, said) {
	if (!open) return '<section class="map-view"><h1>Open</h1><p class="muted">Reading what is open.</p></section>'
	const { decisions, topics } = open
	const empty =
		decisions.length + topics.length === 0
			? '<p class="t-empty">Nothing is open. A decision that needs your call, or a topic whose code changed since you understood it, shows here.</p>'
			: ''
	const decisionList =
		decisions.length === 0
			? ''
			: `<h2 class="o-head">Decisions that need your call (${decisions.length})</h2>
			<p class="small muted">The agent wrote these and marked them as yours to decide. ken checked their quotes, not their sentences.</p>
			<ul class="o-list">${decisions.map((d, i) => decisionItem(d, i, ui)).join('')}</ul>`
	const topicList =
		topics.length === 0
			? ''
			: `<h2 class="o-head">Changed since you understood it (${topics.length})</h2>
			<p class="small muted">From git: the commits that touched each topic's files since you understood it, and who made them.</p>
			<ul class="t-list">${topics.map((t) => topicItem(t, canAsk)).join('')}</ul>`
	return `<section class="map-view open-view">
		<h1>Open</h1>
		<p class="lead">What waits on you in this project: decisions that need your call, and topics whose code changed since you understood them.</p>
		${said ? `<p class="map-said" role="status">${esc(said)}</p>` : ''}
		${empty}${decisionList}${topicList}
		<p class="actions"><button class="quiet-button" data-act="open-close" data-key="open-close">Back</button></p>
	</section>`
}
