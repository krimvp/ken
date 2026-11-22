// The "Ask ken" drawer: a free question, for when the picture does not answer it. It opens over the panel, and its
// reply opens as a thread, as every question does. With a part selected the question is about that part, unless the
// reader drops it. Behind one line are the questions ken writes itself from a folder, a person or a span of time.
// Over the box are the reader's newest replies, each a way back to its thread.
import { esc, runButton, when } from '../../views/format.js'
import { lensHtml } from '../../views/map.js'
import { colourOf } from '../state/home-state.js'

const SHOWN_QUESTIONS = 5

// The part a question from the drawer is about: the one selected, unless the reader dropped it.
function askedPart(home) {
	if (home.askWhole || home.selected?.kind !== 'part') return null
	return home.look?.boxes.find((box) => box.name === home.selected.name) ?? null
}

// What the drawer sends: the reader's words, and before them the part they are about.
export function askedQuestion(home, text) {
	const part = askedPart(home)
	return part ? `About the part ${part.name} (${part.paths.join(', ')}): ${text}` : text
}

// env holds the reader's saved questions (rows), the model's setting, off, the reason no run can start now, and what
// the lenses need: whether they are open, and the person and span the reader picked in them.
export function askDrawerHtml(home, env) {
	const part = askedPart(home)
	const about = part
		? `<p class="ask-about">About <strong class="part-name ${colourOf(home)(part.name)}">${esc(part.name)}</strong> <button type="button" class="link" data-act="ask-whole" data-key="ask-whole">Ask about the whole project</button></p>`
		: ''
	const newest = [...env.rows].reverse().slice(0, SHOWN_QUESTIONS)
	const rows = newest.map(
		(row) =>
			`<li><button class="row" data-act="open" data-id="${esc(row.id)}" data-key="ask-row-${esc(row.id)}"><span class="row-q">${esc(row.question.split('\n')[0])}</span><span class="row-meta">${when(row.askedAt)}</span></button></li>`,
	)
	const asked =
		rows.length === 0
			? ''
			: `<h3 class="insp-sub">Your newest replies</h3><ul class="ask-rows">${rows.join('')}</ul>
				${env.rows.length > newest.length ? '<p class="small muted">The rest are under Earlier replies, at the top.</p>' : ''}`
	const model =
		env.model?.kind === 'ok'
			? `<p class="small muted">The code ken reads for a reply goes to its model, <code>${esc(env.model.name)}</code>.</p>`
			: ''
	return `<div class="ask-head"><h2 class="ask-title" id="ask-title">Ask ken</h2><button class="quiet-button" data-act="ask-close" data-key="ask-close">Close</button></div>
		<div class="ask-scroll">
			<p class="small muted">A free question, for when the picture does not answer it. The reply opens as a thread, with the cards ken checked.</p>
			${asked}
		</div>
		<form class="ask-form" id="ask-form" autocomplete="off">
			${about}
			<label class="ask-label" for="ask-text">Your question</label>
			<textarea id="ask-text" name="text" data-key="ask-text" rows="3" placeholder="${part ? `Ask a question about ${esc(part.name)}` : 'Ask what changed, why, or how a part works'}"></textarea>
			${runButton({ key: 'ask-send', text: 'Ask ken', primary: true }, env.off)}
			${model}
		</form>
		${
			env.model?.kind === 'ok'
				? `<div class="ask-lenses"><button class="link" data-act="lenses" data-key="lenses" aria-expanded="${env.lenses.open}">Or let ken write the question</button>${env.lenses.open ? lensHtml('drawer', env.lenses.pick) : ''}</div>`
				: ''
		}`
}
