// What the home reads from the server: the level on screen, ken's notes about the reader, and the saved replies the
// level's content names. The server reads the level from git on every move.
import { learnParts } from '../../project/part-colours.js'
import { contentOf, picturesOf, repliesOf, shownDetail } from './content.js'
import { DETAILS, FIRST_DETAIL } from './home-state.js'

const same = (a, b) => a.length === b.length && a.every((each, i) => each === b[i])

// The server gives the diff of this many files at a time.
const DIFF_PATHS = 10

// The key the home keeps the diff of one part's changed files under.
export function diffKey(change, box) {
	return `${change.range.base}..${change.range.head}\n${box.name}`
}

// app is the page: its state, render, read, which asks the server and gives back { ok, body } for any answer it
// sends, fromView, which turns a saved question into the page's own shape, and stored, which reads a value this
// browser kept.
export function homeLoads({ state, render, read, post, fromView, stored }) {
	// The number of the newest request for a level. An answer to an older one is dropped: the reader has moved on.
	let asked = 0
	// A request the server never answered is an answer too: one that is not ok, with the reason.
	const ask = (url) => read(url).catch((error) => ({ ok: false, body: { message: error.message } }))

	// A level as the server sent it becomes the level on screen.
	function showLevel({ look, changes, wayIn }) {
		const home = state.home
		if (look.within.length === 0 && look.at === look.head) learnParts(look.boxes)
		Object.assign(home, { look, changes, problem: null, change: look.change?.asked ?? 'none' })
		// A field keeps what the reader typed in it only while the level on screen is the one it asked for.
		if (look.at === look.head) home.typed.at = ''
		if (!look.change?.asked.startsWith('since:')) home.typed.since = ''
		if (wayIn) home.suggestion = wayIn
	}

	// One level from the server, for where the reader is now. A level the server refuses takes the last one off the
	// screen and shows the reason in its place. While the server reads, the home says so: reading is "level" when the
	// level on screen is another one, and "overlay" when it is the same level with another change or commit to come.
	// False means a newer request took this one's place.
	async function loadLayout() {
		const home = state.home
		const { within } = home.trail.at(-1)
		const query = new URLSearchParams()
		if (home.at.trim() !== '') query.set('at', home.at.trim())
		for (const path of within) query.append('within', path)
		if (home.change !== '') query.set('change', home.change)
		const mine = ++asked
		home.reading = home.look && same(home.look.within, within) ? 'overlay' : 'level'
		render()
		const answer = await ask(`/api/layout?${query}`)
		if (mine !== asked) return false
		home.reading = null
		if (answer.ok) showLevel(answer.body)
		else refuse(answer.body)
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

	// The diff of the files a change touched in the part the reader picked, read from git once for each change and
	// part, when the reader looks at it "In the code".
	async function loadDiff() {
		const home = state.home
		const { look, selected } = home
		if (!look?.change || home.content.kind !== 'change' || selected?.kind !== 'part') return
		const box = look.boxes.find((each) => each.name === selected.name)
		if (!box?.touched || shownDetail(home) !== 'code' || home.diffs.has(diffKey(look.change, box))) return
		const key = diffKey(look.change, box)
		home.diffs.set(key, null)
		const paths = box.touched.paths.slice(0, DIFF_PATHS).map((file) => file.path)
		const query = new URLSearchParams([['change', look.change.asked], ...paths.map((file) => ['path', file])])
		const answer = await ask(`/api/change/diff?${query}`)
		const left = box.touched.files - paths.length
		home.diffs.set(key, answer.ok ? { ...answer.body, left } : { problem: answer.body.message })
		render()
	}

	// ken's notes about the reader. A server that keeps none answers 404, and the home then shows none.
	async function loadNotes() {
		const answer = await ask('/api/notes')
		state.home.notes = answer.ok ? answer.body.notes : []
	}

	// What ken has to say about the level on screen, from the saved questions, and the replies it names once read.
	async function settle() {
		const home = state.home
		if (!home.look) return
		const find = () => {
			home.pictures = picturesOf(home.look, state.rows, home.replies)
			home.content = contentOf(home.look, state.rows, home.replies, home.shown)
		}
		find()
		// A drawn picture this level does not have gives its place to the parts, and a pick the screen does not hold
		// is let go.
		if (home.content.kind !== 'drawn') home.shown = null
		const { selected } = home
		const held = {
			part: () => home.content.kind !== 'drawn' && home.look.boxes.some((box) => box.name === selected.name),
			step: () => home.content.kind === 'change',
			element: () => home.content.kind === 'drawn',
		}
		if (selected && !held[selected.kind]()) home.selected = null
		render()
		void loadDiff()
		// shortcut: a tab names its picture by the diagram's title, which only the reply holds, so the reply of every
		// drawn picture of the level is read. Send the title with the row when a level has more than a few dozen.
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

	// Lays over the parts what a way in shows first: nothing to learn the project, what landed last to catch up, and
	// to review a change the reader's own work, or the newest merge when they have none.
	async function enter(wayIn) {
		const home = state.home
		const kept = stored(`ken-detail-${wayIn}`)
		const before = home.detail
		Object.assign(home, { wayIn, at: '', shown: null, selected: null, change: wayIn === 'review' ? '' : 'none' })
		if (wayIn === 'catch-up') home.change = home.changes.find((choice) => choice.kind === 'since')?.change ?? 'none'
		if (!(await loadLayout())) return
		// The detail of the way in comes with its level, so the panel does not show the old level at the new detail
		// while the server reads. A detail the reader picked meanwhile stays.
		if (home.detail === before)
			home.detail = Object.keys(DETAILS).find((detail) => detail === kept) ?? FIRST_DETAIL[wayIn]
		if (wayIn === 'review' && !home.problem && !home.look.change) {
			const newest = home.changes.find((choice) => choice.kind === 'merge' || choice.kind === 'commit')
			if (newest) {
				home.change = newest.change
				await loadLayout()
			}
		}
	}

	// The first load reads the level with no change, which also says which way in ken suggests and what there is to
	// catch up on. Then the way in decides what is laid over it. placed says the home already holds where the reader
	// is, from the page's address: then that one level is read, and nothing else decides.
	async function start(placed) {
		const home = state.home
		await Promise.all([loadLayout(), loadNotes()])
		if (!placed) {
			if (!home.picked && home.suggestion) home.wayIn = home.suggestion.suggested
			await enter(home.wayIn)
		}
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

	return { loadLayout, loadNotes, loadDiff, settle, refresh, enter, start, back }
}
