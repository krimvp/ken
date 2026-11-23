// The reader's understanding map on the page: the line under an answer that says which topics its buttons update, the
// line that says ken hid the cards of a topic the reader knows. ken works out each topic's state from the map
// file and the code at HEAD; the page only shows it.
import { partClass } from '../project/part-colours.js'
import { day, esc, list, RUN_COST, WHO } from './format.js'

// A map line holds a day and no time: "on 16 Nov", or "earlier today". Its twin is onDay in src/follow-up/when.ts.
export function onDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : `on ${said}`
}

function sinceDay(date) {
	const said = day(date)
	return said === 'today' ? 'earlier today' : said
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
function askedForDetail(q) {
	return q.question?.startsWith('Go one level deeper on ')
}

export function foldedTopics(q, ui) {
	if (askedForDetail(q)) return new Set()
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
		if (t.kind === 'unchanged' && named.has(t.topic) && !askedForDetail(q)) {
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
	'too-much': (names) => `Saved. You asked for shorter replies on ${list(names)}.`,
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
		<p>How should ken explain ${named} to you?</p>
		<p class="map-buttons-line">${button('know', 'I know it', 'Later replies hide its cards until its code changes.')} <span aria-hidden="true">·</span> ${button('too-much', 'Too much detail', 'The next reply on it is shorter.')} <span aria-hidden="true">·</span> ${button('deeper', 'Go deeper', `Asks for more detail. ${RUN_COST}`, running)}</p>
		${said}
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
		<p class="small muted lens-note">Each of these is ${RUN_COST.replace(/^One/, 'one')}</p>
	</div>`
}
