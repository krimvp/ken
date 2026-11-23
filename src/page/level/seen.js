// What the page tells ken about what the reader looked at, so ken's idea of what they know grows by itself. A brief
// ken has explained, open in its drawer, counts as read after ten seconds with the tab in view. A send that fails is
// dropped without a word: it must never block or slow the page. When ken wrote a line, the level and the record are
// read again, so a part's fill moves with no reload.

const READ_MS = 10_000

// app is the page: its state, render, post, briefPaths, which gives the files of the brief that is open, or null,
// and rereadKnows, which reads again what ken thinks the reader knows. loads reads the level again.
export function homeSeen(app, loads) {
	const { state, render, post } = app
	// What the timer waits on, by what it would send: the same thing still on screen is not sent twice.
	let waiting = null

	// ken wrote something down: the level, what ken recorded and every brief are read again. A level being read
	// anyway brings the change itself.
	async function recorded() {
		const inPartChange = state.shell?.page === 'changes' && state.chg.part
		await Promise.all([
			state.home.reading || inPartChange ? null : loads.loadLayout(true),
			loads.loadReader(),
			app.rereadKnows(),
		])
		render()
	}

	async function tell({ did, paths, change }) {
		try {
			const { written } = await post('/api/seen', { did, paths, ...(change ? { change } : {}) })
			if (written) await recorded()
		} catch {}
	}

	// Called after every draw: starts the wait for the brief on screen now, and drops the one before.
	function watch() {
		const inView = document.visibilityState === 'visible'
		const paths = inView ? app.briefPaths() : null
		const key = paths?.length > 0 ? JSON.stringify(paths) : ''
		if (key === (waiting?.key ?? '')) return
		clearTimeout(waiting?.timer)
		waiting = key ? { key, timer: setTimeout(() => void tell({ did: 'read', paths }), READ_MS) } : null
	}

	document.addEventListener('visibilitychange', watch)

	return { tell, watch, recorded }
}
