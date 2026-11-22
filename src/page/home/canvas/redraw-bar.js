// "Show it another way": the reader tells ken, in their own words, how they want to see the level on screen. ken's
// model then redraws the picture, or keeps a note about the reader when the request is about them. The notes ken
// keeps sit under the box, each with a way to remove it. On a narrow screen the bar folds to one line.
import { esc, runButton } from '../../views/format.js'

// Requests ken's model can do: draw the parts again, draw a flow as a diagram, or leave parts out.
const EXAMPLES = [
	'Fewer, bigger parts',
	'Group by feature',
	'Follow one request through the code',
	'Leave out tests and tooling',
]

// off is the reason no run of ken's model can start now, or null.
export function redrawBarHtml(home, off) {
	const { look } = home
	const why =
		off ??
		(!look
			? 'ken is reading the project.'
			: look.at !== look.head
				? "ken's model draws the code that is checked out, not an older commit."
				: !look.named
					? "ken's model has not named these parts yet. Ask it to name them first."
					: null)
	const chips = EXAMPLES.map(
		(text) =>
			`<button type="button" class="chip redraw-chip" data-act="redraw-example" data-key="ex-${esc(text)}">${text}</button>`,
	)
	const notes =
		home.notes.length === 0
			? ''
			: `<p class="redraw-row"><span class="redraw-said">ken keeps in mind:</span>${home.notes
					.map(
						(note) =>
							`<span class="note-chip"><span class="note-text">${esc(note.text)}</span> <button type="button" class="link" data-act="note-remove" data-id="${esc(note.id)}" data-key="note-${esc(note.id)}" aria-label="Remove the note: ${esc(note.text)}">Remove</button></span>`,
					)
					.join('')}</p>`
	const problem = home.redraw.problem ? `<p class="home-error" role="alert">${esc(home.redraw.problem)}</p>` : ''
	return `<form class="redraw-form${home.redrawOpen ? ' is-open' : ''}" id="redraw-form" autocomplete="off">
		<div class="redraw-top">
			<label class="redraw-label" for="redraw-text">Show it another way</label>
			<button type="button" class="link redraw-fold" data-act="redraw-open" data-key="redraw-open" aria-expanded="${home.redrawOpen}">${home.redrawOpen ? 'Fold' : 'Tell ken how'}</button>
		</div>
		<div class="redraw-body">
			<div class="redraw-ask">
				<input id="redraw-text" name="text" data-key="redraw-text" maxlength="300" placeholder="Say how you want to see it" />
				${runButton({ key: 'run-redraw', text: 'Redraw the picture' }, why)}
			</div>
			${problem}
			<p class="redraw-row"><span class="redraw-said">For example:</span>${chips.join('')}</p>
			${notes}
		</div>
	</form>`
}
