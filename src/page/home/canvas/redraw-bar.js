// "Show it another way": the reader tells ken, in their own words, how they want to see the level on screen. ken's
// model then draws the picture again, or keeps a note about the reader when the request is about them. The bar is one
// row under the canvas, so it takes no room from the picture: the label, the box and the button. The examples and the
// notes ken keeps open under the row while the reader types in the box, or when they ask for them. On a narrow screen
// the bar is one line that opens.
import { count, esc, runButton } from '../../views/format.js'

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
			: `<p class="redraw-row"><span class="redraw-said">Notes ken keeps about you:</span>${home.notes
					.map(
						(note) =>
							`<span class="note-chip"><span class="note-text">${esc(note.text)}</span> <button type="button" class="link" data-act="note-remove" data-id="${esc(note.id)}" data-key="note-${esc(note.id)}" aria-label="Remove the note: ${esc(note.text)}">Remove</button></span>`,
					)
					.join('')}</p>`
	const problem = home.redraw.problem ? `<p class="home-error" role="alert">${esc(home.redraw.problem)}</p>` : ''
	const more = home.notes.length === 0 ? 'Examples' : `Examples and ${count(home.notes.length, 'note', 'notes')}`
	const toggle = home.redrawOpen
		? 'Hide'
		: `<span class="redraw-how">Tell ken how</span><span class="redraw-count">${more}</span>`
	return `<form class="redraw-form${home.redrawOpen ? ' is-open' : ''}" id="redraw-form" autocomplete="off">
		<label class="redraw-label" for="redraw-text">Show it another way</label>
		<div class="redraw-ask">
			<input id="redraw-text" name="text" data-key="redraw-text" maxlength="300" placeholder="Say how you want to see it" />
			${runButton({ key: 'run-redraw', text: 'Show it another way' }, why)}
		</div>
		<button type="button" class="link redraw-toggle" data-act="redraw-open" data-key="redraw-open" aria-expanded="${home.redrawOpen}">${toggle}</button>
		${problem}
		<div class="redraw-more">
			<p class="redraw-row"><span class="redraw-said">For example:</span>${chips.join('')}</p>
			${notes}
		</div>
	</form>`
}
