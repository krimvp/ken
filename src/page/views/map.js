// The reader's understanding map on the page: the line under an answer that says which topics its buttons update, the
// one line a topic the reader knows folds to, and the "Your map" view. ken works out each topic's state from the map
// file and the code at HEAD; the page only shows it.
import { esc, list } from './format.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A map line's day, such as 2026-11-16, as "16 Nov", with the year when it is not this year.
export function mapDay(date) {
	const [year, month, day] = date.split('-').map(Number)
	const thisYear = new Date().getFullYear() === year ? '' : ` ${year}`
	return `${day} ${MONTHS[month - 1]}${thisYear}`
}

const DEPTH = { 'heard-of': 'Has heard of it', 'can-follow': 'Can follow it', 'could-change': 'Could change it' }
const EVIDENCE = {
	asked: 'You asked about it',
	read: 'You said an answer was too much',
	said: 'You said "I know this"',
	wrote: 'You wrote it by hand',
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

// The topics of this answer whose entries fold: the reader knows them and their code is unchanged. A topic the reader
// asked to see anyway stays open.
export function foldedTopics(q, ui) {
	return new Set(
		(q.topics ?? []).filter((t) => t.kind === 'unchanged' && !ui.unfolded.has(t.topic)).map((t) => t.topic),
	)
}

// One line per topic the reader knows, for each that has an entry in this answer, and one per topic whose code changed
// since the reader knew it.
export function knownHtml(q, ui, named) {
	const lines = (q.topics ?? []).flatMap((t) => {
		if (t.kind === 'unchanged' && named.has(t.topic)) {
			const open = ui.unfolded.has(t.topic)
			return [
				`<p class="known">You know ${esc(t.topic)}. Unchanged since ${mapDay(t.entry.date)}. <button class="link" data-act="unfold" data-topic="${esc(t.topic)}" data-key="unfold-${esc(t.topic)}" aria-expanded="${open}">${open ? 'Fold it again' : 'Show it anyway'}</button></p>`,
			]
		}
		if ((t.kind === 'changed' || t.kind === 'long-ago') && t.changed.length > 0) {
			return [
				`<p class="known changed">${esc(t.topic)} changed since you understood it on ${mapDay(t.entry.date)}: ${linesText(t.changed)}.</p>`,
			]
		}
		if (t.kind === 'long-ago') {
			return [
				`<p class="known">You understood ${esc(t.topic)} on ${mapDay(t.entry.date)}, a while ago. Unchanged since.</p>`,
			]
		}
		return []
	})
	return lines.length === 0 ? '' : `<div class="knowns">${lines.join('')}</div>`
}

const SAID = {
	know: (names) => `Saved. Your map says you know ${names}, as the code is now.`,
	'too-much': (names) => `Saved. The next answer on ${names} will be shorter.`,
}

// The three buttons under an answer, which act on the topics it names. An answer that names none has no buttons.
export function mapBarHtml(q, ui, running) {
	const names = q.answer.topics ?? []
	if (names.length === 0) {
		return '<p class="map-bar muted small">This answer names no topic, so it does not change your map.</p>'
	}
	const named = list(names.map((name) => `<strong>${esc(name)}</strong>`))
	const said = ui.mapSaid ? `<p class="map-said" role="status">${SAID[ui.mapSaid](list(names.map(esc)))}</p>` : ''
	const deeper = running
		? '<button class="quiet-button" disabled>Go deeper</button>'
		: '<button class="quiet-button" data-act="map-deeper" data-key="map-deeper">Go deeper</button>'
	return `<section class="map-bar" aria-label="Your map">
		<p class="small">This updates your map for: ${named}.</p>
		<div class="map-buttons">
			<button class="quiet-button" data-act="map-know" data-key="map-know">I know this</button>
			<button class="quiet-button" data-act="map-too-much" data-key="map-too-much">Too much</button>
			${deeper}
		</div>
		${said}
	</section>`
}

const STATE = {
	'never-met': 'Not met yet',
	met: 'Not understood yet',
	unchanged: 'Unchanged since you understood it',
	changed: 'Changed since you understood it',
	'long-ago': 'Understood a while ago',
}

function topicHtml(t) {
	const how =
		t.kind === 'never-met' ? '' : `${DEPTH[t.entry.depth]} · ${EVIDENCE[t.entry.evidence]} · ${mapDay(t.entry.date)}`
	const lines = t.changed?.length > 0 ? `<p class="t-lines">Changed: ${linesText(t.changed)}</p>` : ''
	return `<li class="t-row t-${t.kind}">
		<p class="t-head"><span class="t-name">${esc(t.topic)}</span> <span class="t-state">${STATE[t.kind]}</span></p>
		<p class="t-how small">${how}</p>
		${lines}
	</li>`
}

// The "Your map" view: every topic the reader has met, the newest first, then the ones they have not, and the file.
export function mapViewHtml(map) {
	if (!map) return '<section class="map-view"><h1>Your map</h1><p class="muted">Reading your map.</p></section>'
	const met = map.states.filter((t) => t.kind !== 'never-met')
	met.sort((a, b) => (a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : 0))
	const unmet = map.states.filter((t) => t.kind === 'never-met')
	const problems =
		map.problems.length === 0
			? ''
			: `<div class="notice" role="status"><h3>ken skipped ${map.problems.length === 1 ? 'a line' : `${map.problems.length} lines`}</h3><ul>${map.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
	return `<section class="map-view">
		<h1>Your map</h1>
		<p class="lead">What ken thinks you understand in this project, topic by topic. When a topic's code changes, ken says so here, whoever changed it.</p>
		${met.length === 0 ? '<p class="t-empty">You have not met any topic yet. Ask how a part of the project works, then press "I know this" under the answer.</p>' : `<ul class="t-list">${met.map(topicHtml).join('')}</ul>`}
		${unmet.length === 0 ? '' : `<p class="t-unmet"><strong>Not met yet:</strong> ${list(unmet.map((t) => esc(t.topic)))}.</p>`}
		${problems}
		<div class="limit">
			<p>The map is a plain file on this computer, outside the project:</p>
			<p><code>${esc(map.file)}</code></p>
			<p class="muted">To correct it, add a line to the file. ken reads the newest line for each topic. <code>ken map</code> in a terminal prints an example line with each topic's hash.</p>
		</div>
		<p class="actions"><button class="quiet-button" data-act="map-close" data-key="map-close">Back</button></p>
	</section>`
}

// The two lenses, each a button or a small form that asks a question ken writes from the map.
export function lensHtml(where) {
	return `<div class="lenses lenses-${where}">
		<button class="quiet-button" data-act="catch-up" data-key="catch-up-${where}">Catch up on what changed since you understood it</button>
		<form class="area-form" data-area="${where}" autocomplete="off">
			<label for="area-${where}">Work in an area today</label>
			<span class="area-row"><input id="area-${where}" name="path" placeholder="src/server" spellcheck="false" /><button class="quiet-button" type="submit">What do I need to know?</button></span>
		</form>
	</div>`
}
