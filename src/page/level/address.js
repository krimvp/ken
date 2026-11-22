// The addresses from before the pages, and the address of a reply. A reply open as a thread has an address, so a
// reload opens it again. An address from the one-screen home, "#way=...", is read here so that it opens the nearest
// place there is now (src/page/shell/place.js).
import { WHOLE } from './level-state.js'

const WAYS = ['learn', 'catch-up', 'review']
const DETAILS = ['big', 'how', 'code']

export function replyAddress(id) {
	return `#${new URLSearchParams({ reply: id })}`
}

export function readReply(hash) {
	return new URLSearchParams(hash.replace(/^#/, '')).get('reply')
}

// What an address from before the pages named: { wayIn, trail, change, shown, selected }, or null for none.
export function readAddress(hash) {
	const query = new URLSearchParams(hash.replace(/^#/, ''))
	if (!WAYS.includes(query.get('way') ?? '') || !DETAILS.includes(query.get('detail') ?? '')) return null
	const opened = query.getAll('in').map((part) => {
		const [name, ...within] = part.split('\n')
		return { name, within }
	})
	const [kind, ...rest] = (query.get('pick') ?? '').split(':')
	return {
		wayIn: query.get('way'),
		trail: [WHOLE, ...opened],
		change: query.get('change') ?? 'none',
		shown: query.get('picture'),
		selected: kind === 'part' ? { kind, name: rest.join(':') } : null,
	}
}
