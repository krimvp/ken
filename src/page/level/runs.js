// The runs of ken's model that the home starts. Each stays on the home: the page holds the run, and this module decides
// what the home shows when it ends. A run remembers where it started, as { kind, trail, change, wayIn }, and is judged
// against that, since the reader may have moved on while it ran.
import { besideCanvas, picturesOf, sameList } from './content.js'

// A run by its kind: its title while it runs, and what ken's model is doing.
export const DOING = {
	name: ['Naming the parts', "ken's model is naming the parts"],
	explainAll: ['Explaining the parts', "ken's model is explaining each part in turn"],
	story: ['Reading the change', "ken's model is reading the change"],
	walk: ['Ordering the change into steps', "ken's model is ordering the change into steps"],
	redraw: ['Drawing it another way', "ken's model is working on your request"],
	explain: ['Explaining it', "ken's model is explaining it"],
	answer: ['Answering it', "ken's model is answering your question"],
	draw: ['Drawing a process', "ken's model is drawing the process"],
}

// Whether the reader is where a run started: on its level, and for a run about a change, with that change laid over.
export function isThere(started, home) {
	const onLevel =
		started.trail.length === home.trail.length &&
		started.trail.every((each, i) => sameList(each.within, home.trail[i].within))
	const aboutChange = started.kind === 'story' || started.kind === 'walk'
	return onLevel && (!aboutChange || started.change === home.change)
}

export function levelOf(started) {
	return started.trail.length === 1 ? 'the whole project' : started.trail.at(-1).name
}

// Whether the saved question holds what its run was started for. Plain code on the server marks a tour and what a
// run about a change was asked for, so this reads the reply and not the screen.
function made(started, q) {
	if (q.outcome !== 'answered' || !q.reply) return false
	const has = (kind) => q.reply.items.some((item) => item.kind === kind)
	return {
		name: () => q.reply.items.some((item) => item.kind === 'card' && item.card.kind === 'layout'),
		explainAll: () => Boolean(q.reply.tour),
		story: () => q.reply.want === 'story',
		walk: () => q.reply.want === 'walk' && has('step'),
		redraw: () => true,
	}[started.kind]()
}

// app is the page: its state, render, and send, which asks ken's model a question. loads reads the home again.
export function homeRuns({ state, render, send }, loads) {
	function run(kind, lens) {
		const home = state.home
		Object.assign(home, { ended: null, stepsOpen: false })
		return send({ lens }, { kind, trail: home.trail, change: home.change, wayIn: home.wayIn })
	}

	// A run the home started is over. The home reads the level, the questions and the notes again. What the run made
	// shows in its place. A run that made nothing says so, with the way to its full reply. When the reader has moved to
	// another level or change, the home says the run finished and where, and leaves them where they are.
	async function ended(started, q) {
		const home = state.home
		const ok = made(started, q)
		const there = isThere(started, home)
		// A diagram ken drew for a request opens on the canvas in place of the parts, and parts drawn again take the
		// place of a drawn picture. A request that left only a note changes no picture.
		const drew = ok && picturesOf(home.look, state.rows).some((picture) => picture.id === q.id)
		if (ok && there && started.kind === 'redraw') {
			const again = state.rows.find((row) => row.id === q.id)?.view?.drew === 'parts'
			const next = drew ? q.id : again ? null : home.shown
			if (home.shown !== next) Object.assign(home, { shown: next, selected: null })
		}
		await Promise.all([loads.loadLayout(), loads.loadNotes()])
		await loads.settle()
		if (!ok) {
			home.ended = { kind: 'nothing', outcome: q.outcome, error: q.error, id: q.id }
			// A request that made nothing goes back into its box, unless the reader has typed the next one.
			if (started.kind === 'redraw' && home.redraw.text === '') home.redraw.text = home.redraw.asked
		} else if (!there) home.ended = { kind: 'elsewhere', run: started.kind, level: levelOf(started), started }
		else if (started.kind === 'redraw') home.said = { asked: home.redraw.asked, q: besideCanvas(q, drew) }
		render()
	}

	return { run, ended }
}
