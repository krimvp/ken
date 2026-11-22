// Where the reader is on the home, as the part of the page's address after "#". The browser's Back then goes to the
// level before, and a reload keeps the place. A place is { wayIn, detail, trail, change, at, shown, selected }, the
// same fields the home's state holds. One function reads a place from an address and one writes it, and nothing else
// knows the form.
import { DETAILS, WAYS, WHOLE } from './home-state.js'

const PICKS = ['part', 'step', 'element']

export function writeAddress({ wayIn, detail, trail, change, at, shown, selected }) {
	const query = new URLSearchParams({ way: wayIn, detail })
	// A part the reader opened is its name and then its paths, one to a line: a name holds no line break.
	for (const part of trail.slice(1)) query.append('in', [part.name, ...part.within].join('\n'))
	if (change !== 'none') query.set('change', change)
	if (at !== '') query.set('at', at)
	if (shown !== null) query.set('picture', shown)
	if (selected) query.set('pick', `${selected.kind}:${selected.kind === 'part' ? selected.name : selected.number}`)
	return `#${query}`
}

// The place an address names, or null when it names none, as on a first visit.
export function readAddress(hash) {
	const query = new URLSearchParams(hash.replace(/^#/, ''))
	const [wayIn, detail] = [query.get('way'), query.get('detail')]
	if (!Object.hasOwn(WAYS, wayIn ?? '') || !Object.hasOwn(DETAILS, detail ?? '')) return null
	const opened = query.getAll('in').map((part) => {
		const [name, ...within] = part.split('\n')
		return { name, within }
	})
	const [kind, ...rest] = (query.get('pick') ?? '').split(':')
	const picked = rest.join(':')
	const selected = !PICKS.includes(kind)
		? null
		: kind === 'part'
			? { kind, name: picked }
			: { kind, number: Number(picked) }
	return {
		wayIn,
		detail,
		trail: [WHOLE, ...opened],
		change: query.get('change') ?? 'none',
		at: query.get('at') ?? '',
		shown: query.get('picture'),
		selected: selected && (selected.kind === 'part' || Number.isInteger(selected.number)) ? selected : null,
	}
}
