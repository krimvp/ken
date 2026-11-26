// What the reader does on the You page: open a part's brief from their map, and correct what ken recorded, by taking
// a line back or by saying what they know of its part. The parts inside each part they read are read from git once.
import { KNOWN } from '../level/level-state.js'
import { fill } from '../shell/fill.js'
import { youPageHtml } from './you.js'

export const freshYou = () => ({
	// The line of what ken recorded whose "Not right" is open, or -1.
	fixing: -1,
	all: false,
	note: '',
	savingNote: false,
	noteStatus: null,
	problem: null,
	// What ken wrote after the last correction, as ken recorded it.
	said: null,
	// The names of the parts inside each part, by its name: null while read.
	inside: new Map(),
})

// app is the page: its state, render, post, the store of briefs, and level, which reads what ken recorded again.
export function youActions(app) {
	const { state, render, post } = app
	const you = state.you
	const $ = (selector) => document.querySelector(selector)
	const page = $('#pg-you')
	const look = () => state.shell.top?.look ?? null

	// The parts inside each part the reader has read, for its inner branches.
	function readInside() {
		for (const box of look()?.boxes ?? []) {
			const read = KNOWN.indexOf(box.knows.level) >= KNOWN.indexOf('read')
			if (!read || !box.opens || you.inside.has(box.name)) continue
			you.inside.set(box.name, null)
			void app.briefs.lookAt(box.paths).then((inner) => {
				you.inside.set(box.name, inner?.boxes.map((each) => each.name) ?? [])
				render()
			})
		}
	}

	async function enter() {
		you.fixing = -1
		const { loads } = app.level
		await Promise.all([state.shell.top ? null : app.topRead(), loads.loadReader(), loads.loadNotes()])
		render()
	}

	function draw() {
		readInside()
		const inside = new Map([...you.inside].map(([name, names]) => [name, names ?? []]))
		const project = state.project?.name ?? 'ken'
		fill(page, youPageHtml({ look: look(), inside, home: state.home, you, project }))
	}

	async function saved(change, took) {
		you.problem = null
		try {
			await change()
		} catch (error) {
			you.problem = `ken could not save that. ${error.message}`
		}
		you.fixing = -1
		await app.level.recorded()
		const newest = state.home.reader?.learned[0]?.text
		you.said = you.problem ? null : took ? `ken took back: ${took}` : newest ? `ken wrote: ${newest}` : null
		render()
		$('#recorded-title')?.focus({ preventScroll: true })
	}

	async function saveNote() {
		if (you.savingNote) return
		if (!you.note.trim()) {
			state.home.noteProblem = 'Write a note first.'
			render()
			$('#reader-note')?.focus()
			return
		}
		you.savingNote = true
		you.noteStatus = null
		state.home.noteProblem = null
		render()
		try {
			state.home.notes = (await post('/api/notes', { text: you.note })).notes
			you.note = ''
			you.noteStatus = 'Saved for your next question.'
		} catch (error) {
			state.home.noteProblem = error.message
		}
		you.savingNote = false
		render()
		$('#reader-note')?.focus()
	}

	function submit(event) {
		if (event.target.id !== 'reader-note-form') return false
		event.preventDefault()
		void saveNote()
		return true
	}

	function input(event) {
		if (event.target.id !== 'reader-note') return false
		you.note = event.target.value
		you.noteStatus = null
		return true
	}

	const lineAt = (el) => state.home.reader.learned[Number(el.dataset.index)]

	const actions = {
		'you-fix'(el) {
			you.fixing = Number(el.dataset.index)
			you.said = null
			render()
			$(you.fixing < 0 ? '#recorded-title' : '[data-key="you-undo"]')?.focus({ preventScroll: true })
		},
		'you-all'() {
			you.all = !you.all
			render()
		},
		// A line of the reader's map is taken back by its topic, and a line on what they looked at by its moment.
		'you-undo'(el) {
			const line = lineAt(el)
			if (line.did === 'shorter')
				return saved(() => post('/api/map', { signal: 'usual', topics: [line.topic] }), line.text)
			return line.topic
				? saved(() => post('/api/map', { signal: 'forgot', topics: [line.topic] }))
				: saved(() => post('/api/seen', { did: 'undo', at: line.at }), line.text)
		},
		// "You said you know it" is the reader's to say, so ken writes it as said.
		'you-set'(el) {
			const box = look()?.boxes.find((each) => each.name === el.dataset.name)
			if (!box) return
			const { level } = el.dataset
			return saved(() =>
				post(
					'/api/seen',
					level === 'said' ? { did: 'said', paths: box.paths } : { did: 'set', level, paths: box.paths },
				),
			)
		},
	}

	function closeFix() {
		if (you.fixing < 0) return false
		you.fixing = -1
		render()
		$('#recorded-title')?.focus({ preventScroll: true })
		return true
	}

	return { actions, enter, draw, closeFix, submit, input }
}
