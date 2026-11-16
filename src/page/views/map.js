// The reader's understanding map on the page: the line under an answer that says which topics its buttons update, the
// one line a topic the reader knows folds to, and the "Your map" view. ken works out each topic's state from the map
// file and the code at HEAD; the page only shows it.
import { day, esc, list, WHO } from './format.js'

// A map line holds a day and no time: "on 16 Nov", or "earlier today". Its twin is onDay in src/follow-up/when.ts.
export function onDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : `on ${said}`
}

function sinceDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : said
}

const DEPTH = { 'heard-of': 'Has heard of it', 'can-follow': 'Can follow it', 'could-change': 'Could change it' }
const EVIDENCE = {
	asked: 'You asked about it',
	read: 'You said an answer was too much',
	said: 'You said "I know this"',
	wrote: 'You wrote it by hand',
}

export function linesText(lines) {
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

// The topics of this answer whose code changed since the reader understood them, each as "topic: the lines".
export function changedTopics(q) {
	return (q.topics ?? []).filter((t) => (t.kind === 'changed' || t.kind === 'long-ago') && t.changed.length > 0)
}

// One line per topic the reader knows, for each that has an entry in this answer, and one per topic whose code changed
// since the reader knew it, unless the answer is older than HEAD: its notice says so then.
export function knownHtml(q, ui, named, moved) {
	const lines = (q.topics ?? []).flatMap((t) => {
		if (t.kind === 'unchanged' && named.has(t.topic)) {
			const open = ui.unfolded.has(t.topic)
			return [
				`<p class="known">You know ${esc(t.topic)}. ken compared the quoted lines with git: unchanged since ${sinceDay(t.entry.date)}. <button class="link" data-act="unfold" data-topic="${esc(t.topic)}" data-key="unfold-${esc(t.topic)}" aria-expanded="${open}">${open ? 'Fold it again' : 'Show it anyway'}</button></p>`,
			]
		}
		if ((t.kind === 'changed' || t.kind === 'long-ago') && t.changed.length > 0) {
			if (moved) return []
			return [
				`<p class="known changed">${esc(t.topic)} changed since you understood it ${onDay(t.entry.date)}: ${linesText(t.changed)}.</p>`,
			]
		}
		if (t.kind === 'long-ago') {
			return [
				`<p class="known">You understood ${esc(t.topic)} ${onDay(t.entry.date)}, a while ago. Unchanged since.</p>`,
			]
		}
		return []
	})
	return lines.length === 0 ? '' : `<div class="knowns">${lines.join('')}</div>`
}

const SAID = {
	know: (names) =>
		`Saved. Your map says you know ${names}, as the code is now. Later answers show what you know as one line.`,
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
	const deeper = `<button class="quiet-button" data-act="map-deeper" data-key="map-deeper"${running ? ' disabled' : ''}>Go deeper</button>`
	return `<section class="map-bar" aria-label="Your map">
		<p class="small">Tell ken how well you know ${named}:</p>
		<ul class="map-buttons">
			<li><button class="quiet-button" data-act="map-know" data-key="map-know">I know this</button><span>Later answers show it as one line.</span></li>
			<li><button class="quiet-button" data-act="map-too-much" data-key="map-too-much">Too much</button><span>The next answer on it is shorter.</span></li>
			<li>${deeper}<span>ken asks for more detail.</span></li>
		</ul>
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
		t.kind === 'never-met' ? '' : `${DEPTH[t.entry.depth]} · ${EVIDENCE[t.entry.evidence]} ${onDay(t.entry.date)}`
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
			<p class="muted">To correct it, add a line to the file. ken reads the newest line for each topic. To see each topic's hash and an example line, run <code>ken map</code> in a terminal.</p>
		</div>
		<p class="actions"><button class="quiet-button" data-act="map-close" data-key="map-close">Back</button></p>
	</section>`
}

// The lenses, each a button or a small form that asks a question ken writes without a model. The last one looks at
// what changed by one person, or by everyone, in a span of time. pick holds the authors of recent commits, the person
// and the span the reader chose, and whether they have asked a question yet.
export function lensHtml(where, pick) {
	const spans = [
		...(pick.asked ? [['question', 'since your last question']] : []),
		['7d', 'in the last 7 days'],
		['14d', 'in the last 14 days'],
		['30d', 'in the last 30 days'],
	]
	const since = spans.some(([value]) => value === pick.since) ? pick.since : spans[0][0]
	const option = (value, text, chosen) =>
		`<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(text)}</option>`
	const people = pick.authors.map((a) =>
		option(a.email, `${a.name}, ${a.by.map((by) => WHO[by] ?? by).join(' or ')}`, pick.author),
	)
	const off = pick.running ? ' disabled' : ''
	const catchUp = pick.changed
		? `<button class="quiet-button" data-act="catch-up" data-key="catch-up-${where}"${off}>What changed in the topics I know?</button>`
		: ''
	return `<div class="lenses lenses-${where}">
		${catchUp}
		<form class="area-form" data-area="${where}" autocomplete="off">
			<label for="area-${where}">Work in an area today</label>
			<span class="area-row"><input id="area-${where}" name="path" placeholder="for example src/server" spellcheck="false" /><button class="quiet-button" type="submit"${off}>What do I need to know?</button></span>
		</form>
		<form class="change-form" autocomplete="off">
			<label for="who-${where}">What changed</label>
			<span class="area-row"><select id="who-${where}" name="author">${option('', 'by everyone', pick.author)}${people.join('')}</select><select name="since" aria-label="When">${spans.map(([value, text]) => option(value, text, since)).join('')}</select><button class="quiet-button" type="submit"${off}>Explain</button></span>
		</form>
		${pick.author ? '<p class="small muted lens-note">For one person, ken lists only the topics you know that their commits touched.</p>' : ''}
		<p class="small muted lens-note">Each of these is one run of ken's model.</p>
	</div>`
}
