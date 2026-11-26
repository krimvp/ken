// The "Ask ken" drawer: a free question, for when no picture or brief answers it. It offers the questions of the
// briefs the reader opened last, then the box, and the reader's earlier answers behind one press. A question sent
// here opens as a thread with the cards ken checked, as every question does. A question of the reader's that is still
// running shows under the box.
import { icon } from '../shell/icons.js'
import { esc, prose, RUN_COST, when } from '../views/format.js'
import { lensHtml } from '../views/map.js'

const SUGGESTED = 4

// The questions of the briefs opened last, newest first: [{ text, about, concept, id, answered }]. briefOf gives a brief the
// page has read, or null.
export function suggestions(recent, briefOf) {
	const found = []
	for (const id of recent) {
		const brief = briefOf(id)
		for (const question of brief?.questions ?? []) {
			if (found.some((each) => each.id === question.id)) continue
			found.push({ text: question.text, about: brief.name, concept: id, id: question.id, answered: question.answered })
		}
	}
	return found.slice(0, SUGGESTED)
}

// The earlier answers, newest first: what the reader asked and the brief questions ken answered by itself. Runs that
// named, explained or drew parts are left out, as the queue lists them.
export function earlierAnswers(rows) {
	return rows.filter((row) => row.answer !== false).reverse()
}

// ask is the drawer's state: { text, earlier, recent }. env holds the reader's saved questions (rows), the model's
// setting, off, the reason no run can start now, and what the lenses need.
export function askDrawerHtml(ask, env, briefOf) {
	const offered = suggestions(ask.recent, briefOf).map(
		(each) =>
			`<li><button class="k-ask-sug" data-act="${each.answered ? 'brief-open' : 'ask-suggest'}" data-concept="${esc(each.id)}" data-about="${esc(each.concept)}" data-key="ask-sug-${esc(each.id)}">${icon('question')}<span><b>${prose(each.text)}</b><span>${each.answered ? 'Answered. Open the answer' : `About ${esc(each.about)}`}</span></span></button></li>`,
	)
	const suggested =
		offered.length === 0
			? '<p class="k-muted">Open a brief, and the questions worth asking about it show here.</p>'
			: `<ul class="k-ask-sugs">${offered.join('')}</ul>`
	const rows = earlierAnswers(env.rows)
	const earlier =
		rows.length === 0
			? ''
			: `<button class="k-link k-ask-earlier" data-act="ask-earlier" data-key="ask-earlier" aria-expanded="${ask.earlier}">${ask.earlier ? 'Hide earlier answers' : `Earlier answers (${rows.length})`}</button>
				${
					ask.earlier
						? `<ul class="k-ask-rows">${rows
								.map(
									(row) =>
										`<li><button class="k-ask-row" data-act="open" data-id="${esc(row.id)}" data-key="ask-row-${esc(row.id)}"><b>${esc(row.question.split('\n')[0])}</b><span>${row.background ? 'Prepared by ken · ' : ''}${row.outcome === 'unverified' ? 'Unverified source answer · ' : row.outcome === 'tool-proposal' ? 'No answer · ' : ''}${when(row.askedAt)}</span></button></li>`,
								)
								.join('')}</ul>`
						: ''
				}`
	// The reader's own question still running, so they can go back to it from any page.
	const running =
		env.running && !env.running.onHome
			? `<ul class="k-ask-rows"><li><button class="k-ask-row" data-act="open-running" data-key="ask-running"><b>${esc(env.running.q.question.split('\n')[0])}</b><span>Running now</span></button></li></ul>`
			: ''
	const model =
		env.model?.kind === 'ok'
			? `<p class="k-muted">The code ken reads for a reply goes to its model, <code>${esc(env.model.name)}</code>.</p>`
			: ''
	const lenses =
		env.model?.kind === 'ok'
			? `<div class="k-ask-lenses"><button class="k-link" data-act="lenses" data-key="lenses" aria-expanded="${env.lenses.open}">${env.lenses.open ? 'Hide question ideas' : 'Show question ideas'}</button>${env.lenses.open ? lensHtml('drawer', env.lenses.pick) : ''}</div>`
			: ''
	return `<div class="k-brief-head"><h2 class="k-ask-title" id="ask-title" tabindex="-1">Ask ken</h2><button class="k-icon-btn" data-act="ask-close" data-key="ask-close" aria-label="Close Ask ken">${icon('close')}</button></div>
		<div class="k-brief-body k-ask-body">
			${ask.about?.focus || ask.about?.after ? '' : `<h3 class="k-eyebrow">Worth asking</h3>${suggested}`}
			<form class="k-ask-form" id="ask-form" autocomplete="off">
				<label class="${ask.about?.focus || ask.about?.after ? 'k-source-question' : 'k-eyebrow'}" for="ask-text">${ask.about?.after ? `Follow up on "${esc(ask.about.name)}"` : ask.about ? `Your question about ${esc(ask.about.name)}` : 'Your question'}</label>
				${ask.about ? '<button class="k-link k-ask-earlier" type="button" data-act="ask-anything" data-key="ask-anything">Ask about something else</button>' : ''}
				<textarea id="ask-text" name="text" maxlength="4000" data-key="ask-text" rows="3" placeholder="Ask what changed, why, or how a part works">${esc(ask.text)}</textarea>
				<button class="k-btn is-big k-run-btn" type="submit" data-key="ask-send"${env.off ? ' disabled' : ''}><span>Send the question</span><small>${RUN_COST}</small></button>
				${env.off ? `<p class="k-muted">${esc(env.off)}</p>` : ''}
				${model}
			</form>
			${running}
			${earlier}
			${lenses}
		</div>`
}
