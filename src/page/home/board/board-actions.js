// What the reader can do on the board: go where a card of "Next for you" or the readout's "Open" leads, correct what
// ken thinks they know of a part, and take back a line ken recorded. Pointing at a box, or moving to it, shows it in
// the readout line, and pointing at a card or a recorded line outlines its boxes in the picture.
import { showReadout } from '../home-view.js'
import { DETAILS, FIRST_DETAIL } from '../state/home-state.js'

// Why ken opens a part at the detail it does, by what it thinks the reader knows of it.
const BECAUSE = {
	new: 'it is new to you',
	seen: 'you have seen it and not read about it',
	read: 'you have read about it',
	code: 'you have read its code',
	said: 'you said you know it',
}

// app is the page: its state, render and post. loads reads the home again, and select picks a part or a step.
export function boardActions({ state, render, post }, loads, select) {
	const $ = (selector) => document.querySelector(selector)
	const boxNamed = (name) => state.home.look.boxes.find((box) => box.name === name)

	// The one line over the panel on why a part is open the way it is.
	function whyOf(box) {
		const home = state.home
		if (home.pinned !== null) return `Open at ${DETAILS[home.pinned]}, the detail you picked for every part.`
		const { knows } = box
		if (!home.look.named) return null
		return `ken opened ${box.name} at ${DETAILS[knows.go.detail]} because ${BECAUSE[knows.level]}.`
	}

	// Goes where the server says: a way in, the change to lay over the picture, a detail and a part. A detail the
	// reader pinned stays. why is the line the panel shows over what opens.
	async function go({ way, part, detail, change }, why) {
		const home = state.home
		Object.assign(home, { opened: true, why, fixing: null })
		if (change !== undefined) {
			Object.assign(home, { wayIn: way, change, at: '', shown: null, selected: null })
			if (!(await loads.loadLayout())) return
		} else if (home.wayIn !== way || home.at !== '' || (way === 'learn' && home.change !== 'none')) {
			await loads.enter(way)
		}
		home.detail = home.pinned ?? detail ?? FIRST_DETAIL[way]
		await loads.settle()
		const box = part ? boxNamed(part) : null
		if (box) await select({ kind: 'part', name: box.name })
		$('#insp-title')?.focus({ preventScroll: true })
	}

	// The level and the record again after the reader changed what ken holds of them.
	async function saved(change) {
		const home = state.home
		try {
			await change()
		} catch (error) {
			home.trouble = { said: 'ken could not save that.', message: error.message, again: false }
		}
		await Promise.all([loads.loadLayout(true), loads.loadReader()])
		render()
	}

	const actions = {
		'home-go'(el) {
			const item = state.home.look.next.items[Number(el.dataset.index)]
			const at = DETAILS[state.home.pinned ?? item.go.detail]
			return go(item.go, `ken opened this at ${at}. ${item.why}`)
		},
		'home-go-box'(el) {
			const box = boxNamed(el.dataset.name)
			const { knows } = box
			const why = knows.stale
				? `ken opened ${box.name} at what changed because ${knows.since === 1 ? '1 commit' : `${knows.since} commits`} landed there since you looked.`
				: whyOf(box)
			return go({ ...knows.go, part: box.name }, why)
		},
		// "Not right" opens the five levels for one box, and Cancel closes them.
		'home-fix'(el) {
			const home = state.home
			home.fixing = el.dataset.name ?? null
			render()
			$(home.fixing ? '#home-readout [aria-pressed="true"]' : '[data-key="fix-open"]')?.focus()
		},
		async 'home-set'(el) {
			const home = state.home
			const box = boxNamed(home.fixing)
			home.fixing = null
			await saved(() => post('/api/seen', { did: 'set', level: el.dataset.level, paths: box.paths }))
			$('[data-key="fix-open"]')?.focus()
		},
		// A line of the reader's map is taken back by its topic, and a line on what they looked at by its moment.
		async 'home-undo'(el) {
			const line = state.home.reader.learned[Number(el.dataset.index)]
			await saved(() =>
				line.topic
					? post('/api/map', { signal: 'forgot', topics: [line.topic] })
					: post('/api/seen', { did: 'undo', at: line.at }),
			)
			$('#recorded-title')?.focus({ preventScroll: true })
		},
		'home-recorded'() {
			state.home.recordedOpen = !state.home.recordedOpen
			render()
		},
	}

	const cells = () => [...document.querySelectorAll('#home-canvas .pv-picture > .pv-boxes > li')]

	// The box under the pointer or the keyboard shows in the readout line, and stays there until another does. A box
	// the reader picked, or is correcting, keeps the line. A card or a recorded line outlines its boxes.
	function point(event) {
		const home = state.home
		if (state.view !== 'home' || !home.look) return
		const at = cells().indexOf(event.target.closest?.('#home-canvas .pv-boxes > li'))
		const name = home.look.boxes[at]?.name
		if (name && name !== home.pointed) {
			home.pointed = name
			showReadout($('#home'), home)
		}
		const parts = JSON.parse(event.target.closest?.('[data-parts]')?.dataset.parts ?? '[]')
		for (const [i, cell] of cells().entries()) {
			cell.classList.toggle('is-outlined', parts.includes(home.look.boxes[i]?.name))
		}
	}

	return { actions, whyOf, point, go }
}
