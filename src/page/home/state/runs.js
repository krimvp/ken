// The runs of ken's model that the home starts. Each stays on the home: the page holds the run, and this module decides
// what the home shows when it ends.
import { besideCanvas, firstUnseen, pathOf, picturesOf } from './content.js'

// app is the page: its state, render, and send, which asks ken's model a question. loads reads the home again, and
// stepTo opens a stop of the reading path.
export function homeRuns({ state, render, send }, loads, stepTo) {
	// A run of ken's model that stays on the home. The page calls ended when it is over.
	function run(kind, lens) {
		Object.assign(state.home, { ended: null, stepsOpen: false })
		return send({ lens }, kind)
	}

	// A run the home started is over. The home reads the level, the questions and the notes again. What the run made
	// shows in its place, and a run that made nothing the home can show says so, with the way to its full reply.
	async function ended(kind, q) {
		const home = state.home
		// A diagram ken drew for the request opens on the canvas in place of the parts. A request that left only a note,
		// or failed, changes no picture. Every other run is about the parts.
		const drew = kind === 'redraw' && picturesOf(home.look, state.rows).some((picture) => picture.id === q.id)
		const aboutParts = kind !== 'redraw' || state.rows.find((row) => row.id === q.id)?.view?.drew === 'parts'
		const next = drew ? q.id : aboutParts ? null : home.shown
		if (home.shown !== next) Object.assign(home, { shown: next, selected: null })
		await Promise.all([loads.loadLayout(), loads.loadNotes()])
		await loads.settle()
		const { content } = home
		const made =
			q.outcome === 'answered' &&
			q.reply &&
			{
				name: () => q.reply.items.some((item) => item.kind === 'card' && item.card.kind === 'layout'),
				tour: () => content.tour?.id === q.id,
				story: () => content.story?.id === q.id,
				walk: () => content.walk?.id === q.id,
				redraw: () => true,
			}[kind]()
		if (!made) home.ended = { outcome: q.outcome, error: q.error, id: q.id }
		else if (kind === 'redraw') home.said = { asked: home.redraw.asked, q: besideCanvas(q, drew) }
		else if (kind === 'tour' && home.detail === 'big') {
			home.detail = 'how'
			await stepTo(firstUnseen(home.look, pathOf(home.look, content)))
		}
		render()
	}

	return { run, ended }
}
