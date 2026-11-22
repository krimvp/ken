// What the home reads from the server: the level on screen, ken's notes about the reader, and the saved replies the
// level's content names. The server reads the level from git on every move.
import { learnParts } from '../project/part-colours.js'
import { contentOf, picturesOf, repliesOf, sameList } from './content.js'

// app is the page: its state, render, read, which asks the server and gives back { ok, body } for any answer it
// sends, post, and fromView, which turns a saved question into the page's own shape.
export function homeLoads({ state, render, read, post, fromView }) {
	// The number of the newest request for a level. An answer to an older one is dropped: the reader has moved on.
	let asked = 0
	// A request the server never answered is an answer too: one that is not ok, with the reason.
	const ask = (url) =>
		read(url).catch((error) => ({
			ok: false,
			body: { message: error.name === 'TimeoutError' ? 'ken took too long to answer.' : error.message },
		}))

	// What ken has to say about the level on screen, found among the saved questions.
	function find() {
		const home = state.home
		home.pictures = picturesOf(home.look, state.rows, home.replies)
		home.content = contentOf(home.look, state.rows, home.replies, home.shown)
	}

	// A level as the server sent it becomes the level on screen. Its content is found at once, so the page never draws
	// one level beside what ken said of another.
	function showLevel({ look, changes, wayIn, levels }) {
		const home = state.home
		if (look.within.length === 0 && look.at === look.head) learnParts(look.boxes)
		Object.assign(home, { look, changes, problem: null, change: look.change?.asked ?? 'none' })
		if (levels) home.levels = levels
		find()
		// A field keeps what the reader typed in it only while the level on screen is the one it asked for.
		if (look.at === look.head) home.typed.at = ''
		if (!look.change?.asked.startsWith('since:')) home.typed.since = ''
		if (look.change?.asked !== home.typed.another.trim()) home.typed.another = ''
		if (wayIn) home.suggestion = wayIn
	}

	// One level from the server, for where the reader is now. A level the server refuses takes the last one off the
	// screen and shows the reason in its place. While the server reads, the home says so: reading is "level" when the
	// level on screen is another one, and "overlay" when it is the same level with another change or commit to come.
	// False means a newer request took this one's place. again says the same level is read again with nothing else asked
	// of it, so what is on screen stays in use meanwhile, and stays when the server cannot answer: the reader asked
	// for nothing.
	async function loadLayout(again = false) {
		const home = state.home
		const { within } = home.trail.at(-1)
		const query = new URLSearchParams()
		if (home.at.trim() !== '') query.set('at', home.at.trim())
		for (const path of within) query.append('within', path)
		if (home.change !== '') query.set('change', home.change)
		const mine = ++asked
		home.reading = again ? null : home.look && sameList(home.look.within, within) ? 'overlay' : 'level'
		render()
		const answer = await ask(`/api/layout?${query}`)
		if (mine !== asked) return false
		home.reading = null
		if (answer.ok) showLevel(answer.body)
		else if (!again) refuse(answer.body)
		return true
	}

	// A commit or a change the server refused leaves the level on screen as it was, with the reason under the field the
	// reader filled: keeps says so. Any other refusal takes the level off the screen.
	function refuse({ message, field = null }) {
		const home = state.home
		const keeps = Boolean(home.look) && (field === 'at' || field === 'change')
		home.problem = { message, field, keeps }
		if (keeps) {
			const { look } = home
			Object.assign(home, { at: look.at === look.head ? '' : look.at, change: look.change?.asked ?? 'none' })
		}
	}

	// ken's notes about the reader. A server that keeps none answers 404, and the home then shows none.
	async function loadNotes() {
		const answer = await ask('/api/notes')
		state.home.notes = answer.ok ? answer.body.notes : []
	}

	// What ken recorded of the reader. Until the server has said, the board is without that panel, and an answer it
	// cannot give later leaves the lines the board has.
	async function loadReader() {
		const answer = await ask('/api/reader')
		if (answer.ok) state.home.reader = answer.body
	}

	// What ken has to say about the level on screen, from the saved questions, and the replies it names once read.
	async function settle() {
		const home = state.home
		if (!home.look) return
		find()
		// A drawn picture this level does not have gives its place to the parts.
		if (home.content.kind !== 'drawn') home.shown = null
		render()
		// The canvas's Processes layer draws each drawn picture from its diagram, which only the reply holds.
		const named = [...repliesOf(home.content), ...home.pictures.slice(1)].map((each) => each.id)
		const unread = [...new Set(named)].filter((id) => !home.replies.has(id))
		if (unread.length === 0) return
		await Promise.all(
			unread.map(async (id) => {
				const answer = await ask(`/api/questions/${encodeURIComponent(id)}`)
				if (answer.ok) home.replies.set(id, fromView(answer.body))
				else home.trouble = { said: 'ken could not read a reply it saved.', message: answer.body.message, again: true }
			}),
		)
		find()
		render()
	}

	async function refresh() {
		await loadLayout()
		await settle()
	}

	// The server brings back the picture before, and the home then reads the level as it reads any other, with the
	// change and the commit the reader is on.
	async function back() {
		const home = state.home
		try {
			await post('/api/layout/back', { within: home.trail.at(-1).within })
		} catch (error) {
			home.backProblem = error.message
			return render()
		}
		Object.assign(home, { backProblem: null, said: null })
		await refresh()
	}

	return { loadLayout, loadNotes, loadReader, settle, refresh, back }
}
