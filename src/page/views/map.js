// The reader's understanding map on the page: the line under an answer that says which topics its buttons update, the
// line that says ken hid the cards of a topic the reader knows, and the "Your map" view. ken works out each topic's state from the map
// file and the code at HEAD; the page only shows it.
import { partClass } from '../project/part-colours.js'
import { day, esc, list, WHO, withCost } from './format.js'

// A map line holds a day and no time: "on 16 Nov", or "earlier today". Its twin is onDay in src/follow-up/when.ts.
export function onDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : `on ${said}`
}

function sinceDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : said
}

const DEPTH = {
	'heard-of': 'You have heard of it.',
	'can-follow': 'You can follow it.',
	'could-change': 'You could change it.',
}
const EVIDENCE = {
	asked: 'You asked about it',
	read: 'You said an answer was too much',
	said: 'You said you know this',
	wrote: 'You wrote it by hand',
	forgot: 'You said you do not know it any more',
	toured: 'You met it on a tour of the project',
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

// The one way the page says a topic the reader knew has changed, under an answer and in its out-of-date notice.
export function changedLine(t) {
	return `${esc(t.topic)} changed since you understood it ${onDay(t.entry.date)}: ${linesText(t.changed)}.`
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
				`<p class="known">${open ? 'Showing' : 'Hiding'} the cards on ${esc(t.topic)}. You know it, and its code has not changed since ${sinceDay(t.entry.date)}. <button class="link" data-act="unfold" data-topic="${esc(t.topic)}" data-key="unfold-${esc(t.topic)}" aria-expanded="${open}">${open ? 'Hide them' : 'Show them'}</button></p>`,
			]
		}
		if ((t.kind === 'changed' || t.kind === 'long-ago') && t.changed.length > 0) {
			if (moved) return []
			return [`<p class="known changed">${changedLine(t)}</p>`]
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
		`Saved to your map. Later replies hide the cards on ${list(names)} until ${names.length === 1 ? 'its' : 'their'} code changes.`,
	'too-much': (names) => `Saved. The next reply on ${list(names)} will be shorter.`,
}

// The three buttons under a reply, on one quiet line, which act on the topics it names. t is the reply's turn in the thread.
export function mapBarHtml(q, t, ui, running) {
	const names = q.reply.topics ?? []
	const named = list(names.map((name) => `<strong class="part-name ${partClass(name)}">${esc(name)}</strong>`))
	const saved = ui.mapSaid?.turn === t ? ui.mapSaid.signal : null
	const said = saved ? `<p class="map-said" role="status">${SAID[saved](names.map(esc))}</p>` : ''
	const button = (act, text, means, off = false) =>
		`<button class="link" data-act="map-${act}" data-turn="${t}" data-key="map-${act}-${t}" title="${means}"${off ? ' disabled' : ''}>${text}</button>`
	return `<section class="map-bar small" aria-label="Your map">
		<p>Tell ken how well you know ${named} now.</p>
		<p class="map-buttons-line">${button('know', 'I know it', 'Later replies hide its cards until its code changes.')} <span aria-hidden="true">·</span> ${button('too-much', 'Too much detail', 'The next reply on it is shorter.')} <span aria-hidden="true">·</span> ${button('deeper', 'Go deeper', 'Asks for more detail. One model run.', running)}</p>
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

// Each topic has the buttons that fit its state: a changed one those of "Waiting on you", an understood one a way to
// say the reader no longer knows it, and one not understood yet "I know this".
function topicHtml(t, canAsk) {
	const how =
		t.kind === 'never-met' ? '' : `${DEPTH[t.entry.depth]} ${EVIDENCE[t.entry.evidence]} ${onDay(t.entry.date)}.`
	const changed = t.changed?.length > 0
	const lines = changed ? `<p class="t-lines">Changed: ${linesText(t.changed)}</p>` : ''
	const topic = esc(t.topic)
	const button = (act, text) =>
		`<button class="quiet-button" data-act="${act}" data-topic="${topic}" data-key="${act}-${topic}">${text}</button>`
	const understood = t.kind === 'unchanged' || t.kind === 'changed' || t.kind === 'long-ago'
	// The button that runs ken's model comes last, so its cost ends the row.
	const buttons = [
		...(changed ? [button('map-topic-know', 'I know this change')] : []),
		...(understood ? [button('map-topic-forgot', 'I do not know this any more')] : []),
		...(understood ? [] : [button('map-topic-know', 'I know this')]),
		...(changed && canAsk ? [withCost(button('explain-topic', 'Explain what changed'))] : []),
	]
	return `<li class="t-row t-${t.kind}">
		<p class="t-head"><span class="t-name part-name ${partClass(t.topic)}">${topic}</span> <span class="t-state">${STATE[t.kind]}</span></p>
		<p class="t-how small">${how}</p>
		${lines}
		<div class="map-buttons">${buttons.join('')}</div>
	</li>`
}

// The "Your map" view: every topic the reader has met, the newest first, then the ones they have not, and the file.
// said is the line that says what the last button saved.
export function mapViewHtml(map, canAsk, said) {
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
		${said ? `<p class="map-said" role="status">${esc(said)}</p>` : ''}
		${met.length === 0 ? '<p class="t-empty">You have not met any topic yet. Ask how a part of the project works, then press "I know this" under the answer.</p>' : `<ul class="t-list">${met.map((t) => topicHtml(t, canAsk)).join('')}</ul>`}
		${unmet.length === 0 ? '' : `<p class="t-unmet"><strong>Not met yet:</strong> ${list(unmet.map((t) => esc(t.topic)))}.</p>`}
		${problems}
		<p class="map-foot small muted">The map is a plain file on this computer, outside the project: <code>${esc(map.file)}</code>. Each button adds a line to it, and you can add one by hand: ken reads the newest line for each topic. Run <code>ken map</code> in a terminal to see each topic's id and an example line.</p>
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
		? `<div class="catch-up"><p class="lens-label">Topics you know</p><button class="quiet-button" data-act="catch-up" data-key="catch-up-${where}"${off}>What changed in the topics I know?</button></div>`
		: ''
	return `<div class="lenses lenses-${where}">
		${catchUp}
		<form class="area-form" data-area="${where}" autocomplete="off">
			<label for="area-${where}">I'm about to work in</label>
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
