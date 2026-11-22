// What is open, on the page: the decisions that need the reader's call, each kept or sent for a change with a note, the
// parts that changed since the reader looked, and the topics whose code changed since the reader understood them, with the commits that changed them and who made each. ken
// works the list out from the record, the map and git; the page only shows it.

import { partClass } from '../project/part-colours.js'
import { answeredHtml, esc, prose, short, WHO, when, withCost } from './format.js'
import { linesText, onDay } from './map.js'
import { decisionHtml } from './reply.js'

// The parts of a level that changed since the reader last looked at them, by the server's one rule for it. Home,
// You and this view all count these.
export const changedParts = (look) => look?.boxes.filter((box) => box.knows.stale) ?? []

// parts are the parts of the top level that changed since the reader looked.
export function openCount(open, parts) {
	return (open ? open.decisions.length + open.topics.length : 0) + parts.length
}

function partItem(box) {
	const { since } = box.knows
	return `<li class="t-row o-topic">
		<p class="t-head"><span class="t-name part-name ${partClass(box.name)}">${esc(box.name)}</span> <span class="t-state">${since === 1 ? '1 commit' : `${since} commits`} touched it after the commit you last looked at</span></p>
		<p class="t-lines">${esc(box.knows.why)}</p>
		<div class="map-buttons"><button class="quiet-button" data-act="part-changed" data-name="${esc(box.name)}" data-key="changed-${esc(box.name)}">Show what changed</button></div>
	</li>`
}

function decisionItem(d, i, ui) {
	const key = `o${i}`
	return `<li class="o-decision">
		<ul class="o-card">${decisionHtml(d, key, { ui, commits: true, waiting: true }, new Set(['recorded', 'inferred']))}</ul>
		<form class="decide-form" data-id="${esc(d.id)}" autocomplete="off">
			<label for="note-${key}">Your note: why you keep it, or what you want instead</label>
			<textarea id="note-${key}" name="note" rows="2" maxlength="1200" required></textarea>
			<p class="small muted">ken saves your answer and note. No code changes. "I want it changed" does nothing more by itself: you or your coding agent act on your note.</p>
			<div class="decide-buttons">
				<button class="primary" type="submit" name="outcome" value="keep" formnovalidate>Keep what was chosen</button>
				<button class="primary" type="submit" name="outcome" value="change">I want it changed</button>
			</div>
		</form>
	</li>`
}

function commitsHtml(commits) {
	if (commits.length === 0) return '<p class="o-commits muted small">ken found no commit to these files since then.</p>'
	return `<ul class="o-commits">${commits
		.map(
			(c) =>
				`<li><code>${short(c.hash)}</code> <q class="subject">${esc(c.subject)}</q><span class="o-by">${esc(c.author)}, ${WHO[c.by] ?? esc(c.by)}, ${when(c.date)}</span></li>`,
		)
		.join('')}</ul>`
}

function topicItem({ state, commits }, canAsk) {
	const topic = esc(state.topic)
	const explain = canAsk
		? withCost(
				`<button class="quiet-button" data-act="explain-topic" data-topic="${topic}" data-key="explain-${topic}">Explain what changed</button>`,
			)
		: ''
	return `<li class="t-row o-topic">
		<p class="t-head"><span class="t-name part-name ${partClass(state.topic)}">${topic}</span> <span class="t-state">You understood it ${onDay(state.entry.date)}</span></p>
		<p class="t-lines">Changed since: ${linesText(state.changed)}</p>
		${commitsHtml(commits)}
		<div class="map-buttons"><button class="quiet-button" data-act="know-topic" data-topic="${topic}" data-key="know-${topic}">I know this change</button>${explain}</div>
	</li>`
}

// decided holds the decisions the reader answered on this visit, so each leaves a line with a link to it. parts are
// the parts of the top level that changed since the reader looked.
export function openViewHtml(open, ui, canAsk, said, decided, parts) {
	if (!open)
		return '<section class="map-view"><h1>Waiting on you</h1><p class="muted">Reading what is open.</p></section>'
	const { decisions, topics } = open
	const empty =
		decisions.length + topics.length + decided.length + parts.length === 0
			? '<p class="t-empty">Nothing is open. A decision that needs your call, a part that changed since you looked at it, or a topic whose code changed since you understood it, shows here.</p>'
			: ''
	const partList =
		parts.length === 0
			? ''
			: `<h2 class="o-head">Changed since you looked (${parts.length})</h2>
			<p class="small muted">From git: the commits that touched each part's files after the newest commit you looked at it.</p>
			<ul class="t-list">${parts.map(partItem).join('')}</ul>`
	const traces = decided
		.map(
			(d) =>
				`<li class="o-decided"><p class="d-q">${prose(d.question)}</p><p>${answeredHtml(d.answer)}</p><p class="small">Saved in the project record. <button class="link" data-act="decision-show" data-id="${esc(d.id)}" data-key="show-${esc(d.id)}">See it in Decisions</button></p></li>`,
		)
		.join('')
	const decisionList =
		decisions.length + decided.length === 0
			? ''
			: `<h2 class="o-head">${decisions.length === 0 ? 'Decisions you answered' : `Decisions that need your call (${decisions.length})`}</h2>
			${decisions.length === 0 ? '' : `<p class="small muted">ken's model or your coding agent wrote each of these and marked it as yours to decide. ken checked their quotes, not their sentences.</p>`}
			<ul class="o-list">${traces}${decisions.map((d, i) => decisionItem(d, i, ui)).join('')}</ul>`
	const topicList =
		topics.length === 0
			? ''
			: `<h2 class="o-head">Changed since you understood it (${topics.length})</h2>
			<p class="small muted">From git: the commits that touched each topic's files since you understood it, and who made them.</p>
			<ul class="t-list">${topics.map((t) => topicItem(t, canAsk)).join('')}</ul>`
	return `<section class="map-view open-view">
		<h1>Waiting on you</h1>
		<p class="lead">What waits on you in this project: decisions that need your call, parts that changed since you looked, and topics whose code changed since you understood them.</p>
		${said ? `<p class="map-said" role="status">${esc(said)}</p>` : ''}
		${empty}${decisionList}${partList}${topicList}
	</section>`
}
