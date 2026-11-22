// A brief is what ken tells its reader about one concept: one line, three to five things to know, its terms and a few
// questions worth asking. A thing to know is a claim said three ways, with a small drawing beside it, and it rests on
// quoted lines as every claim does. The drawings are a fixed set: the model picks a kind, the page draws it, and no
// model draws anything.

export const DRAWING_KINDS = [
	'steps',
	'gate',
	'swap',
	'log',
	'once',
	'fanout',
	'fanin',
	'loop',
	'queue',
	'store',
	'wall',
	'clock',
	'cut',
	'eye',
	'fork',
	'link',
	'dot',
] as const
export type DrawingKind = (typeof DRAWING_KINDS)[number]

// What each kind shows, in the words the model reads when it picks one.
export const DRAWINGS: Record<DrawingKind, string> = {
	steps: 'a row of count steps, with step lit filled',
	gate: 'a thing that passes a check, or is stopped at it',
	swap: 'one thing taken out and another put in its place',
	log: 'lines added to the end of a list',
	once: 'a thing checked one time and trusted after',
	fanout: 'one thing going to several',
	fanin: 'several things coming to one',
	loop: 'the same thing done again, count times',
	queue: 'things waiting in a line for later',
	store: 'a thing kept in a store',
	wall: 'two sides with a wall between them',
	clock: 'a limit on time',
	cut: 'a thing cut short at a limit',
	eye: 'something that watches and changes nothing',
	fork: 'a choice between two paths',
	link: 'two things tied to each other',
	dot: 'none of the above',
}

// count is how many steps or rounds the drawing shows, lit the step that is filled, and label a word under it.
export type Drawing = { kind: DrawingKind; count?: number; lit?: number; label?: string }

// What a thing to know adds to its claim. The claim's own text is the one sentence that says it in full. line says
// it in at most BRIEF_BOUNDS.lineWords words, and long in two or three sentences for a reader who wants words.
export type Point = { line: string; long: string; drawing: Drawing }

export const BRIEF_BOUNDS = {
	lineWords: 10,
	long: 600,
	points: 5,
	fewestPoints: 3,
	terms: 6,
	meansWords: 20,
	questions: 4,
	fewestQuestions: 3,
	question: 160,
	counts: [2, 8],
	label: 12,
} as const

export function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length
}
