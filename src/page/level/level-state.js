// The state of the level the pages show: one level of the project at a time, with the change laid over it, what ken
// said of it before, the runs of ken's model about it, and what ken recorded of the reader. The order of the five
// levels of what ken thinks the reader knows is kept here, once.
import { partClass } from '../project/part-colours.js'

export const WHOLE = { name: 'Whole project', within: [] }
// Weakest first, as the server orders them. The server sends the words for each.
export const KNOWN = ['new', 'seen', 'read', 'code', 'said']

export function freshHome() {
	return {
		// The project's name, as the header says it: the first step of the trail.
		project: null,
		// How the reader came to the level: "learn" on the Architecture page, "review" on the Changes page.
		wayIn: 'learn',
		// The words for the five levels, as the server sends them: [{ level, label }].
		levels: [],
		// What ken recorded of the reader, as GET /api/reader sends it.
		reader: null,
		// The level on screen is the last of the parts the reader went into to get here.
		trail: [WHOLE],
		// The text that asks the server for the change laid over the parts: "none" for no change. at is another commit
		// to look at. typed holds what the reader asked for and had refused.
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
		selected: null,
		content: { kind: 'folders' },
		// The saved questions the content names, by id, once read.
		replies: new Map(),
		// text is the box of "Draw it another way", asked the request the model is working on, problem why it was not sent.
		redraw: { text: '', asked: '', problem: null },
		// Why ken could not remove a note, until the reader's next act on the notes.
		noteProblem: null,
		backProblem: null,
		// ken's reply to the last request to draw a level another way.
		said: null,
		// A run that ended and needs a word: { kind: 'nothing', outcome, error, id } when it made nothing to show, and
		// { kind: 'elsewhere', run, level, started } when it made it for a level or change the reader has left.
		ended: null,
		// Something the server could not do that leaves the picture as it is: { said, message, again }.
		trouble: null,
	}
}

// The project is called by its folder's name everywhere, once the server has said it.
export function projectName(home) {
	return home.project ?? 'The whole project'
}

// The words the server sends for a level of what ken thinks the reader knows.
export function levelLabel(home, level) {
	return home.levels.find((each) => each.level === level)?.label ?? ''
}

// Inside a part, every box takes the colour of the top-level part it sits in.
export function colourOf(home) {
	return home.trail.length === 1 ? partClass : () => partClass(home.trail[1].name)
}
