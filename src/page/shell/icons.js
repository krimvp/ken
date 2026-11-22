// The drawn icons of the page, as inline SVG, and the mark for what ken thinks the reader knows: four bars that grow,
// filled as far as the level, with a tick when the reader said they know it. The same mark stands for a level on every
// page, so the reader learns it once. No icon comes from the network.
import { KNOWN } from '../level/level-state.js'

const PATHS = {
	home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
	architecture:
		'<rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/><path d="M11 7h3a3 3 0 0 1 3 3v4"/>',
	processes:
		'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h7a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h7"/>',
	changes: '<path d="M3 13h4l2.500-7 4 13 2.500-6h5"/>',
	you: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.600 3.500-5.500 7-5.500s6.200 1.900 7 5.500"/>',
	ask: '<path d="M4 6.500A2.500 2.500 0 0 1 6.500 4h11A2.500 2.500 0 0 1 20 6.500v7a2.500 2.500 0 0 1-2.500 2.500H11l-5 4v-4.200A2.500 2.500 0 0 1 4 13.500z"/>',
	settings:
		'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>',
	search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.500-4.500"/>',
	right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
	left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
	close: '<path d="M6 6l12 12M18 6L6 18"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	minus: '<path d="M5 12h14"/>',
	fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
	file: '<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	tick: '<path d="M5 12.500l4.500 4.500L19 7"/>',
	changed: '<path d="M12 5l8 14H4z" fill="currentColor" stroke="none"/>',
	inside: '<path d="M9 4H5a1 1 0 0 0-1 1v4M15 20h4a1 1 0 0 0 1-1v-4M20 4l-7 7M13 6v5h5"/>',
	sideways: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M3 12h18"/>',
	question:
		'<path d="M9 9a3 3 0 1 1 4.500 2.600c-.900.600-1.500 1.200-1.500 2.400M12 17.500v.500"/><circle cx="12" cy="12" r="9"/>',
	deeper: '<path d="M12 4v13M6 11l6 6 6-6M5 20h14"/>',
	term: '<path d="M4 5h9l7 7-7 7H4z"/><circle cx="8.500" cy="12" r="1.200"/>',
	merge:
		'<circle cx="6" cy="5" r="2.200"/><circle cx="6" cy="19" r="2.200"/><circle cx="18" cy="12" r="2.200"/><path d="M6 7.200v9.600M6 9a6 6 0 0 0 9.800 3"/>',
	decision:
		'<circle cx="6" cy="5" r="2.200"/><circle cx="18" cy="5" r="2.200"/><circle cx="12" cy="19" r="2.200"/><path d="M6 7.200c0 5 6 4 6 9.600M18 7.200c0 5-6 4-6 9.600"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M5 19l1.500-1.500M17.500 6.500L19 5"/>',
	moon: '<path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z"/>',
	clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7v5l3.500 2"/>',
	layers: '<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/>',
	pictures:
		'<rect x="3" y="5" width="18" height="14" rx="2.500"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.500"/>',
	words: '<path d="M4 6h16M4 10h16M4 14h11M4 18h13"/>',
	balanced: '<rect x="3" y="5" width="8" height="14" rx="2"/><path d="M14 7h7M14 11h7M14 15h5"/>',
	pencil: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
	arrow: '<path d="M4 12h13M13 7l5 5-5 5"/><path d="M20 6v12"/>',
	plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
	box: '<path d="M12 3l8 4.500v9L12 21l-8-4.500v-9zM4 7.500l8 4.500 8-4.500M12 12v9"/>',
	door: '<path d="M13 4h6v16h-6M3 12h11M10 8l4 4-4 4"/>',
	check: '<rect x="5" y="4" width="14" height="17" rx="2.500"/><path d="M9 4V3h6v1M8.500 13l2.500 2.500 4.500-5"/>',
	grid: '<rect x="4" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.500"/>',
	wrench:
		'<path d="M20 7.500a4.500 4.500 0 0 1-6.200 4.200L7 18.500a2 2 0 0 1-2.800-2.800l6.800-6.800A4.500 4.500 0 0 1 16.500 4l-2.600 2.600 1 2.500 2.500 1z"/>',
	stack:
		'<rect x="4" y="4" width="16" height="4" rx="1.200"/><rect x="4" y="10" width="16" height="4" rx="1.200"/><rect x="4" y="16" width="16" height="4" rx="1.200"/>',
	code: '<path d="M8 7l-4 5 4 5M16 7l4 5-4 5M13.500 5l-3 14"/>',
	gate: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.700h18M3 14.300h18M9 5v4.700M15 9.700v4.600M9 14.300V19"/>',
	screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
}

export function icon(name, extra = '') {
	return `<svg class="k-i${extra ? ` ${extra}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ''}</svg>`
}

// ken's own mark: four tiles in part colours.
export const LOGO =
	'<svg class="k-logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3.500" fill="#ff8562"/><rect x="18" y="2" width="12" height="12" rx="3.500" fill="#5bc4ff"/><rect x="2" y="18" width="12" height="12" rx="3.500" fill="#ffc940"/><rect x="18" y="18" width="12" height="12" rx="3.500" fill="var(--k-brand)"/></svg>'

const BARS = [8, 13, 18, 23]

// The level mark, height pixels high. It is drawn in the colour of the text around it.
export function levelMark(level, height = 18) {
	const at = Math.max(KNOWN.indexOf(level), 0)
	const said = at === KNOWN.length - 1
	const width = said ? 52 : 37
	const bars = BARS.map((tall, i) => {
		const fill = i < at ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.7"'
		return `<rect x="${i * 9 + 1}" y="${24 - tall}" width="6.5" height="${tall - 1}" rx="1.5" ${fill}/>`
	})
	const tick = said
		? '<path d="M39 15l4 4 7-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
		: ''
	return `<svg class="k-mark" viewBox="0 0 ${width} 25" width="${(width * height) / 25}" height="${height}" aria-hidden="true">${bars.join('')}${tick}</svg>`
}

// A part's icon, from the words of its name: the same name gives the same icon on every page. A name none of the
// words fit takes one of the plain shapes, by its letters.
const BY_WORD = [
	[/plugin|engine|core/i, 'plug'],
	[/sandbox|worker|vm\b/i, 'box'],
	[/entry|adapter|host|api|server|http/i, 'door'],
	[/eval|test|check|grad/i, 'check'],
	[/integration|multi|bridge/i, 'grid'],
	[/tool|repo|ci\b|build|script|config/i, 'wrench'],
	[/record|log|store|data|cache|state/i, 'stack'],
	[/cli|command|page|view|ui\b/i, 'screen'],
	[/gate|guard|auth|secur/i, 'gate'],
]
const PLAIN = ['box', 'grid', 'stack', 'code', 'layers', 'plug']

export function partIcon(name) {
	const found = BY_WORD.find(([words]) => words.test(name))
	if (found) return found[1]
	let number = 0
	for (const letter of name) number = (number * 31 + letter.codePointAt(0)) >>> 0
	return PLAIN[number % PLAIN.length]
}

export const KIND_ICONS = {
	part: 'architecture',
	file: 'file',
	process: 'processes',
	step: 'processes',
	term: 'term',
	question: 'question',
	decision: 'decision',
	arrow: 'arrow',
}
