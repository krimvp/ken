// "Draw it another way": the reader tells ken, in their own words, how they want to see the level on the canvas.
// ken's model then draws the parts again, or draws a process, or keeps a note about the reader when the request is
// about them. The tool holds the box, what a run costs or why none can start, a few examples, and the notes ken
// keeps. The form and its fields keep the names the home's actions know them by.
import { esc, RUN_COST } from '../views/format.js'

const EXAMPLES = [
	'Fewer, bigger parts',
	'Group by feature',
	'Follow one request through the code',
	'Leave out tests and tooling',
]

// off is the reason no run of ken's model can start now, or null.
export function drawToolHtml(home, off) {
	const { look } = home
	const why =
		off ??
		(look.at !== look.head
			? "ken's model draws the code that is checked out, not an older commit."
			: !look.named
				? "ken's model has not named these parts yet. Ask it to name them first."
				: null)
	const flows = look.named?.flows ?? []
	const chips = [...flows, ...EXAMPLES.filter((text) => !flows.includes(text))].map(
		(text) =>
			`<button type="button" class="k-chip" data-act="redraw-example" data-key="ex-${esc(text)}">${esc(text)}</button>`,
	)
	const notes =
		home.notes.length === 0
			? ''
			: `<h3 class="k-eyebrow">Notes ken keeps about you</h3><ul class="k-draw-notes">${home.notes
					.map(
						(note) =>
							`<li><span>${esc(note.text)}</span> <button type="button" class="k-link" data-act="note-remove" data-id="${esc(note.id)}" data-key="note-${esc(note.id)}" aria-label="Remove the note: ${esc(note.text)}">Remove</button></li>`,
					)
					.join(
						'',
					)}</ul>${home.noteProblem ? `<p class="k-draw-problem" role="alert">ken could not remove the note. ${esc(home.noteProblem)}</p>` : ''}`
	return `<form class="k-float k-draw" id="redraw-form" autocomplete="off" aria-label="Draw it another way">
		<div class="k-draw-head"><label class="k-draw-label" for="redraw-text">Draw it another way</label><button type="button" class="k-icon-btn" data-act="arch-draw" data-key="draw-close" aria-label="Close this tool">${'<svg class="k-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'}</button></div>
		<div class="k-draw-ask">
			<input id="redraw-text" name="text" data-key="redraw-text" maxlength="300" placeholder="Say how you want to see it" />
			<button class="k-btn" type="submit" data-key="run-redraw"${why ? ' disabled' : ''}>Draw it</button>
		</div>
		<p class="k-draw-cost">${why ? esc(why) : RUN_COST}</p>
		${home.redraw.problem ? `<p class="k-draw-problem" role="alert">${esc(home.redraw.problem)}</p>` : ''}
		<h3 class="k-eyebrow">For example</h3>
		<div class="k-draw-chips">${chips.join('')}</div>
		${notes}
	</form>`
}
