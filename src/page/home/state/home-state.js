// The home's state: one level of the project at a time, the way in the reader took, the detail they chose, and what
// they picked in the picture. The names of the three ways in and the three details are kept here, once.
import { partClass } from '../../project/part-colours.js'

export const WAYS = { learn: 'Learn the project', 'catch-up': 'Catch up', review: 'Review a change' }
export const DETAILS = { big: 'Big picture', how: 'How it works', code: 'In the code' }
export const FIRST_DETAIL = { learn: 'big', 'catch-up': 'big', review: 'how' }
export const WHOLE = { name: 'Whole project', within: [] }

// stored reads a value this browser kept: the reader's way in, and the detail they last chose for each way in.
// ui holds the quotes and decisions open in the cards the home shows, as a thread's does.
export function freshHome(stored, ui) {
	const wayIn = Object.keys(WAYS).find((way) => way === stored('ken-way-in')) ?? null
	return {
		// The reader's pick, else the way in ken suggests. picked says the reader chose it themselves.
		wayIn: wayIn ?? 'learn',
		picked: wayIn !== null,
		detail: 'big',
		// The level on screen is the last of the boxes the reader opened to get here.
		trail: [WHOLE],
		// The text that asks the server for the change laid over the parts: "none" for no change, and "" for the
		// reader's own work. at is another commit to look at, as typed.
		change: 'none',
		at: '',
		look: null,
		changes: [],
		suggestion: null,
		problem: null,
		notes: [],
		// The pictures of the level, and the id of the drawn one on screen: null while the parts are.
		pictures: [{ kind: 'parts' }],
		shown: null,
		// What the reader picked: a part, a step of a walkthrough, or a numbered element of a drawn picture.
		selected: null,
		content: { kind: 'folders' },
		// The saved questions the content names, by id, once read.
		replies: new Map(),
		// text is the box of "Show it another way", asked the request the model is working on, problem why it was not sent.
		redraw: { text: '', asked: '', problem: null },
		redrawOpen: false,
		backProblem: null,
		// ken's reply to the last request to show a level another way, and a run that ended with nothing to show.
		said: null,
		ended: null,
		stepsOpen: false,
		storyOpen: false,
		formOpen: false,
		openArrows: new Set(),
		// The parts the reader knows whose words they asked to see anyway.
		unfolded: new Set(),
		askOpen: false,
		askText: '',
		askWhole: false,
		ui,
	}
}

export function levelName(home) {
	return home.trail.length === 1 ? 'The whole project' : home.trail.at(-1).name
}

// Inside a part, every box takes the colour of the top-level part it sits in.
export function colourOf(home) {
	return home.trail.length === 1 ? partClass : () => partClass(home.trail[1].name)
}
