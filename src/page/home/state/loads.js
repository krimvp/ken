// What the home reads from the server: the level on screen, ken's notes about the reader, and the saved replies the
// level's content names. The server reads the level from git on every move.
import { learnParts } from '../../project/part-colours.js'
import { contentOf, picturesOf, repliesOf } from './content.js'
import { DETAILS, FIRST_DETAIL } from './home-state.js'

// app is the page: its state, render, getJson, which reads from the server, fromView, which turns a saved question
// into the page's own shape, and stored, which reads a value this browser kept.
export function homeLoads({ state, render, getJson, fromView, stored }) {
	const level = () => state.home.trail.at(-1)

	// One level from the server, for where the reader is now. A level the server refuses takes the last one off the
	// screen and shows the reason in its place.
	async function loadLayout() {
		const home = state.home
		const query = new URLSearchParams()
		if (home.at.trim() !== '') query.set('at', home.at.trim())
		for (const path of level().within) query.append('within', path)
		if (home.change !== '') query.set('change', home.change)
		try {
			const response = await fetch(`/api/layout?${query}`)
			const body = await response.json()
			if (!response.ok) {
				home.problem = { message: body.message, field: body.field ?? null }
				return
			}
			const { look, changes, wayIn } = body
			if (home.trail.length === 1 && home.at.trim() === '') learnParts(look.boxes)
			Object.assign(home, { look, changes, problem: null, change: look.change?.asked ?? 'none' })
			if (wayIn) home.suggestion = wayIn
		} catch (error) {
			home.problem = { message: error.message, field: null }
		}
	}

	// ken's notes about the reader. A server that keeps none answers 404, and the home then shows none.
	async function loadNotes() {
		try {
			const response = await fetch('/api/notes')
			state.home.notes = response.ok ? (await response.json()).notes : []
		} catch {
			state.home.notes = []
		}
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
		// shortcut: a tab names its picture by the diagram's title, which only the reply holds, so the reply of every
		// drawn picture of the level is read. Send the title with the row when a level has more than a few dozen.
		const named = [...repliesOf(home.content), ...home.pictures.slice(1)].map((each) => each.id)
		const unread = [...new Set(named)].filter((id) => !home.replies.has(id))
		if (unread.length === 0) return
		await Promise.all(
			unread.map(async (id) => {
				try {
					home.replies.set(id, fromView(await getJson(`/api/questions/${encodeURIComponent(id)}`)))
				} catch (error) {
					home.problem = { message: error.message, field: null }
				}
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
		Object.assign(home, {
			wayIn,
			at: '',
			shown: null,
			selected: null,
			detail: Object.keys(DETAILS).find((detail) => detail === kept) ?? FIRST_DETAIL[wayIn],
			change: wayIn === 'review' ? '' : 'none',
		})
		if (wayIn === 'catch-up') home.change = home.changes.find((choice) => choice.kind === 'since')?.change ?? 'none'
		await loadLayout()
		if (wayIn === 'review' && !home.problem && !home.look.change) {
			const newest = home.changes.find((choice) => choice.kind === 'merge' || choice.kind === 'commit')
			if (newest) {
				home.change = newest.change
				await loadLayout()
			}
		}
	}

	// The first load reads the level with no change, which also says which way in ken suggests and what there is to
	// catch up on. Then the way in decides what is laid over it.
	async function start() {
		const home = state.home
		await Promise.all([loadLayout(), loadNotes()])
		if (!home.picked && home.suggestion) home.wayIn = home.suggestion.suggested
		await enter(home.wayIn)
		await settle()
	}

	return { loadLayout, loadNotes, settle, refresh, enter, start }
}
