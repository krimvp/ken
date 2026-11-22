// The home's state: one level of the project at a time, the way in the reader took, the detail in use, what they
// picked in the picture, and what ken recorded of them. The names of the three ways in, the three details and the
// order of the five levels of what ken thinks the reader knows are kept here, once.
import { partClass } from '../project/part-colours.js'

export const WAYS = { learn: 'Learn the project', 'catch-up': 'Catch up', review: 'Review a change' }
export const DETAILS = { big: 'Big picture', how: 'How it works', code: 'In the code' }
export const FIRST_DETAIL = { learn: 'big', 'catch-up': 'big', review: 'how' }
export const WHOLE = { name: 'Whole project', within: [] }
// Weakest first, as the server orders them. The server sends the words for each.
export const KNOWN = ['new', 'seen', 'read', 'code', 'said']

// stored reads a value this browser kept: the reader's way in, and the detail they pinned for every part.
// ui holds the quotes and decisions open in the cards the home shows, as a thread's does.
export function freshHome(stored, ui) {
	const wayIn = Object.keys(WAYS).find((way) => way === stored('ken-way-in')) ?? null
	const pinned = Object.keys(DETAILS).find((detail) => detail === stored('ken-detail')) ?? null
	return {
		// The project's name, as the header says it: the first step of the trail.
		project: null,
		// The reader's pick, else the way in ken suggests. picked says the reader chose it themselves.
		wayIn: wayIn ?? 'learn',
		picked: wayIn !== null,
		// The detail in use. pinned is the one the reader picked for every part, and null while ken picks: each part
		// then opens at the detail the server says.
		detail: pinned ?? 'big',
		pinned,
		// The reader opened what ken says of the whole level or change, so the panel shows it in place of the board.
		// why is the one line on why ken opened what is in the panel the way it did.
		opened: false,
		why: null,
		// The words for the five levels, as the server sends them: [{ level, label }].
		levels: [],
		// What ken recorded of the reader, as GET /api/reader sends it, and whether every line of it shows.
		reader: null,
		recordedOpen: false,
		// The box the readout line is about while none is picked: the one last pointed at or moved to. fixing is the
		// box whose level the reader is correcting.
		pointed: null,
		fixing: null,
		// The level on screen is the last of the boxes the reader opened to get here.
		trail: [WHOLE],
		// The text that asks the server for the change laid over the parts: "none" for no change, and "" for the
		// reader's own work. at is another commit to look at. typed holds what the reader wrote in the picker's
		// fields and has not sent yet, or sent and had refused.
		change: 'none',
		at: '',
		typed: { at: '', since: '', another: '' },
		look: null,
		// While the server reads a level: "level" when the one on screen is another, "overlay" when it is the same one
		// with another change or commit to come.
		reading: null,
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
		// The diff of the files a change touched in one part, by diffKey: null while the server reads it.
		diffs: new Map(),
		// text is the box of "Show it another way", asked the request the model is working on, problem why it was not sent.
		redraw: { text: '', asked: '', problem: null },
		redrawOpen: false,
		// Why ken could not remove a note, until the reader's next act on the notes.
		noteProblem: null,
		backProblem: null,
		// ken's reply to the last request to show a level another way.
		said: null,
		// A run that ended and needs a word: { kind: 'nothing', outcome, error, id } when it made nothing to show, and
		// { kind: 'elsewhere', run, level, started } when it made it for a level or change the reader has left.
		ended: null,
		// Something the server could not do that leaves the picture as it is: { said, message, again }.
		trouble: null,
		stepsOpen: false,
		storyOpen: false,

		openArrows: new Set(),
		// The parts the reader knows whose words they asked to see anyway.
		unfolded: new Set(),
		askOpen: false,
		askText: '',
		askWhole: false,
		ui,
	}
}

// The project is called by its folder's name everywhere, once the server has said it.
export function projectName(home) {
	return home.project ?? 'The whole project'
}

export function levelName(home) {
	return home.trail.length === 1 ? projectName(home) : home.trail.at(-1).name
}

// The words the server sends for a level of what ken thinks the reader knows.
export function levelLabel(home, level) {
	return home.levels.find((each) => each.level === level)?.label ?? ''
}

// Inside a part, every box takes the colour of the top-level part it sits in.
export function colourOf(home) {
	return home.trail.length === 1 ? partClass : () => partClass(home.trail[1].name)
}
