// Where the reader is, as the part of the page's address after "#": the page, the level of the architecture and its
// layer, the change on the Changes page and its tab, and the brief that is open. The browser's Back goes to the place
// before and a reload keeps the place. One function reads a place from an address and one writes it. An address
// from before the pages, "#way=...", opens the nearest place there is now.
import { partId } from '../brief/concept-id.js'
import { readAddress, readReply } from '../level/address.js'
import { WHOLE } from '../level/level-state.js'

export const PAGES = ['home', 'architecture', 'processes', 'changes', 'you']
export const LAYERS = ['processes', 'changes', 'know']
const WAYS_ON = ['sideways', 'questions', 'deeper']
const TABS = ['changes', 'decisions', 'live']

const inField = (part) => [part.name, ...part.within].join('\n')

// place is { page, trail, layer, process, change, tab, brief, on }.
export function writePlace(place) {
	const { page, brief, on } = place
	const query = new URLSearchParams(
		page === 'architecture' ? place.trail.slice(1).map((part) => ['in', inField(part)]) : [],
	)
	if (page === 'architecture' && place.layer) {
		query.set('layer', place.layer)
		if (place.layer === 'processes' && place.process) query.set('process', place.process)
		if (place.layer === 'changes' && place.change !== 'none') query.set('change', place.change)
	}
	if (page === 'changes') {
		if (place.tab !== 'changes') query.set('tab', place.tab)
		else if (place.change !== 'none') query.set('change', place.change)
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

const START = {
	page: 'home',
	trail: [WHOLE],
	layer: null,
	process: null,
	change: 'none',
	tab: 'changes',
	brief: null,
	on: null,
}

// The place an address names. An address that names none is the Home page, as on a first visit. reply is the id of a
// saved reply the address opens as a thread, over the place.
export function readPlace(hash) {
	const reply = readReply(hash)
	if (reply) return { ...START, reply }
	if (!hash.startsWith('#/')) return { ...fromOlder(hash), reply: null }
	const [name, fields = ''] = hash.slice(2).split('?')
	const query = new URLSearchParams(fields)
	const page = PAGES.includes(name) ? name : 'home'
	const layer = page === 'architecture' ? (LAYERS.find((each) => each === query.get('layer')) ?? null) : null
	const brief = query.get('brief')
	const changed = page === 'changes' || layer === 'changes'
	return {
		page,
		trail: page === 'architecture' ? trailOf(query) : [WHOLE],
		layer,
		process: layer === 'processes' ? query.get('process') : null,
		change: changed ? (query.get('change') ?? 'none') : 'none',
		tab: page === 'changes' ? (TABS.find((each) => each === query.get('tab')) ?? 'changes') : 'changes',
		brief,
		on: brief ? (WAYS_ON.find((each) => each === query.get('on')) ?? null) : null,
		reply: null,
	}
}

// An address from before the pages: learning the project is the Architecture page, with the part that was picked as
// an open brief, a drawn picture is on Processes, and catching up or reviewing a change is on Changes, with that
// change.
function fromOlder(hash) {
	const older = readAddress(hash)
	if (!older) return START
	if (older.wayIn !== 'learn') return { ...START, page: 'changes', change: older.change }
	if (older.shown !== null) return { ...START, page: 'processes' }
	const picked = older.selected?.kind === 'part' ? older.selected.name : null
	return {
		...START,
		page: 'architecture',
		trail: older.trail,
		brief: picked ? partId(older.trail.at(-1).within, picked) : null,
	}
}
