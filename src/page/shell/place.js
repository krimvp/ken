// Where the reader is, as the part of the page's address after "#": the page, the level of the architecture and its
// layer, and the brief that is open. The browser's Back goes to the place before and a reload keeps the place. One
// function reads a place from an address and one writes it. An address from before the pages, "#way=...", opens the
// nearest place there is now. The views from before the pages keep their own fields in the address, as they were.
import { partId } from '../brief/concept-id.js'
import { readAddress, readReply, writeAddress } from '../home/state/address.js'
import { WHOLE } from '../home/state/home-state.js'

export const PAGES = ['home', 'architecture', 'processes', 'changes', 'you']
export const LAYERS = ['processes', 'changes', 'know']
const WAYS_ON = ['sideways', 'questions', 'deeper']
// The pages that still show a view from before the pages, with what that view keeps in the address.
const OLDER = ['processes', 'changes']

const inField = (part) => [part.name, ...part.within].join('\n')

// place is { page, trail, layer, process, change, brief, on, older }: older is the home's state from before the
// pages, for the two pages that still show it, and null elsewhere.
export function writePlace(place) {
	const { page, brief, on } = place
	const query = OLDER.includes(page)
		? new URLSearchParams(writeAddress(place.older).slice(1))
		: new URLSearchParams(page === 'architecture' ? place.trail.slice(1).map((part) => ['in', inField(part)]) : [])
	if (page === 'architecture' && place.layer) {
		query.set('layer', place.layer)
		if (place.layer === 'processes' && place.process) query.set('process', place.process)
		if (place.layer === 'changes' && place.change !== 'none') query.set('change', place.change)
	}
	if (brief) {
		query.set('brief', brief)
		if (on) query.set('on', on)
	}
	const fields = query.toString()
	return `#/${page}${fields ? `?${fields}` : ''}`
}

function trailOf(query) {
	const opened = query.getAll('in').map((part) => {
		const [name, ...within] = part.split('\n')
		return { name, within }
	})
	return [WHOLE, ...opened]
}

const START = { page: 'home', trail: [WHOLE], layer: null, process: null, change: 'none', brief: null, on: null }

// The place an address names. An address that names none is the Home page, as on a first visit. reply is the id of a
// saved reply the address opens as a thread, over the place.
export function readPlace(hash) {
	const reply = readReply(hash)
	if (reply) return { ...START, older: null, reply }
	if (!hash.startsWith('#/')) return { ...fromOlder(hash), reply: null }
	const [name, fields = ''] = hash.slice(2).split('?')
	const query = new URLSearchParams(fields)
	const page = PAGES.includes(name) ? name : 'home'
	const layer = LAYERS.find((each) => each === query.get('layer')) ?? null
	const brief = query.get('brief')
	return {
		page,
		trail: page === 'architecture' ? trailOf(query) : [WHOLE],
		layer: page === 'architecture' ? layer : null,
		process: layer === 'processes' ? query.get('process') : null,
		change: layer === 'changes' ? (query.get('change') ?? 'none') : 'none',
		brief,
		on: brief ? (WAYS_ON.find((each) => each === query.get('on')) ?? null) : null,
		older: OLDER.includes(page) ? readAddress(`#${fields}`) : null,
		reply: null,
	}
}

// An address from before the pages: learning the project is the Architecture page, with the part that was picked as
// an open brief, a drawn picture is on Processes, and catching up or reviewing a change is on Changes.
function fromOlder(hash) {
	const older = readAddress(hash)
	if (!older) return { ...START, older: null }
	if (older.wayIn !== 'learn') return { ...START, page: 'changes', older }
	if (older.shown !== null) return { ...START, page: 'processes', older }
	const picked = older.selected?.kind === 'part' ? older.selected.name : null
	return {
		...START,
		page: 'architecture',
		trail: older.trail,
		brief: picked ? partId(older.trail.at(-1).within, picked) : null,
		older: null,
	}
}
