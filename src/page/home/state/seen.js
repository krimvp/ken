// What the page tells ken about what the reader looked at, so ken's idea of what they know grows by itself. A part
// picked is sent at once. An explanation counts as read after ten seconds on screen with the tab in view, and code or
// a step of a change after five. A send that fails is dropped without a word: it must never block or slow the page.
// A brief open in its drawer counts as read the same way, on any page. When ken wrote a line, the home reads the
// level and the record again, so the box's fill moves with no reload.
import { cardPaths, stopTopics } from '../../project/walk.js'
import { pathOf, placeOf, shownDetail, stepFiles, stoodOn } from './content.js'

const READ_MS = 10_000
const CODE_MS = 5_000

// What is on screen that ken records once it has stayed there: { did, paths, change, after, toured }, or null. after
// is how long it must stay, and toured the topics of a tour stop the reader's map has not met.
export function onScreen(home) {
	const { look, content, selected } = home
	if (!look || !selected || home.reading || content.kind === 'drawn' || content.kind === 'folders') return null
	const detail = shownDetail(home)
	const path = pathOf(look, content)
	const step = path[placeOf(path, selected)]
	const box = selected.kind === 'part' ? look.boxes.find((each) => each.name === selected.name) : null
	if (content.kind === 'change') {
		// A step shows its files at "How it works" and their diff at "In the code". A part shows its diff only there.
		const files = box
			? detail === 'code'
				? (box.touched?.paths ?? [])
				: []
			: step && detail !== 'big'
				? stepFiles(step)
				: []
		if (files.length === 0) return null
		const { base, head } = look.change.range
		return { did: 'change', paths: files.map((file) => file.path), change: { base, head }, after: CODE_MS }
	}
	if (!box) return null
	if (detail === 'how') {
		const topics = step && content.tour?.q ? stopTopics(step) : []
		const toured = stoodOn(box, topics) === 'new' ? topics : []
		return { did: 'read', paths: box.paths, after: READ_MS, toured }
	}
	const files = [...new Set((step?.cards ?? []).flatMap(({ card }) => cardPaths(card)).filter(Boolean))]
	return detail === 'code' && files.length > 0 ? { did: 'code', paths: files, after: CODE_MS } : null
}

// app is the page: its state, render and post, briefPaths, which gives the files of the brief that is open, or null,
// and reread, which reads again what the pages keep of the project. loads reads the home again.
export function homeSeen(app, loads) {
	const { state, render, post } = app
	// What the timer waits on, by what it would send: the same thing still on screen is not sent twice.
	let waiting = null

	// ken wrote something down: the level and the record are read again, unless a level is being read anyway.
	async function recorded() {
		if (state.home.reading) return
		await Promise.all([loads.loadLayout(true), loads.loadReader(), app.reread()])
		render()
	}

	async function tell({ did, paths, change, toured = [] }) {
		try {
			const sent = [post('/api/seen', { did, paths, ...(change ? { change } : {}) })]
			// A tour stop read is a line of the reader's map too, as it was before ken kept what they looked at.
			if (toured.length > 0) sent.push(post('/api/map', { signal: 'toured', topics: toured }))
			const [{ written }] = await Promise.all(sent)
			if (written || toured.length > 0) await recorded()
		} catch {}
	}

	const keyOf = (seen) => JSON.stringify([seen.did, seen.paths, seen.change ?? null])

	// Called after every draw of the home: starts the wait for what is on screen now, and drops the one before.
	function watch() {
		const home = state.home
		const inView = document.visibilityState === 'visible'
		const brief = inView ? app.briefPaths() : null
		const visible = state.view === 'home' && !home.askOpen && inView
		const seen = brief?.length > 0 ? { did: 'read', paths: brief, after: READ_MS } : visible ? onScreen(home) : null
		const key = seen ? keyOf(seen) : ''
		if (key === (waiting?.key ?? '')) return
		clearTimeout(waiting?.timer)
		waiting = seen ? { key, timer: setTimeout(() => void tell(seen), seen.after) } : null
	}

	// The reader did something that says it now: they pressed Next from a tour stop, or opened a diff or a quoted
	// line. only limits it to one kind of line.
	function now(only = null) {
		const seen = state.view === 'home' ? onScreen(state.home) : null
		if (!seen || (only !== null && seen.did !== only)) return
		clearTimeout(waiting?.timer)
		waiting = { key: keyOf(seen), timer: null }
		void tell(seen)
	}

	document.addEventListener('visibilitychange', watch)

	return { tell, watch, now, recorded }
}
