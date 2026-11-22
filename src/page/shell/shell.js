// The frame of ken's page: a rail on the left with a page for each job, a bar on top with the page's name and the
// search, and a panel for the settings. Under 760 pixels the rail lies along the foot as icons.
import { TEXTS } from '../brief/brief.js'
import { levelLabel } from '../level/level-state.js'
import { partClass, partOfFile } from '../project/part-colours.js'
import { esc, prose } from '../views/format.js'
import { icon, KIND_ICONS, LOGO, levelMark } from './icons.js'

export const PAGE_NAMES = {
	home: 'Home',
	architecture: 'Architecture',
	processes: 'Processes',
	changes: 'Changes',
	you: 'You',
}

// The name over a view from before the pages, which opens over whichever page the reader is on.
const OVER_NAMES = { question: 'A reply' }

// on is the page the rail marks, or null while a reply or another view lies over the pages.
export function railHtml({ on, askOpen, settingsOpen }) {
	const pages = Object.entries(PAGE_NAMES).map(
		([page, name]) =>
			`<button class="k-rail-btn" data-act="go-page" data-page="${page}" data-key="rail-${page}" title="${name}"${on === page ? ' aria-current="page"' : ''}>${icon(page)}<span>${name}</span></button>`,
	)
	return `<button class="k-rail-logo" data-act="go-page" data-page="home" data-key="rail-logo" aria-label="ken. Go to Home.">${LOGO}</button>
		<div class="k-rail-links">${pages.join('')}</div>
		<div class="k-rail-foot">
			<button class="k-rail-btn" data-act="ask-open" data-key="ask-open" title="Ask ken" aria-expanded="${askOpen}">${icon('ask')}<span>Ask ken</span></button>
			<button class="k-rail-btn" data-act="settings" data-key="settings" title="Settings" aria-expanded="${settingsOpen}">${icon('settings')}<span>Settings</span></button>
		</div>`
}

// On a phone the rail holds the five pages along the foot, and "Ask ken" and the settings move up into the bar.
export function barActsHtml({ askOpen, settingsOpen }) {
	return `<button class="k-icon-btn" data-act="ask-open" data-key="bar-ask" aria-label="Ask ken" aria-expanded="${askOpen}">${icon('ask')}</button><button class="k-icon-btn" data-act="settings" data-key="bar-settings" aria-label="Settings" aria-expanded="${settingsOpen}">${icon('settings')}</button>`
}

export function barTitle({ page, view, project }) {
	if (OVER_NAMES[view]) return OVER_NAMES[view]
	return page === 'home' ? (project ?? 'ken') : PAGE_NAMES[page]
}

const KIND_WORDS = {
	part: 'Part',
	file: 'File',
	process: 'Process',
	step: 'Step',
	term: 'Term',
	question: 'Question',
	decision: 'Decision',
	frame: 'Where it runs',
	store: 'Store',
	outside: 'Outside',
}

// The concepts that hold every word the reader typed, those that hold them in the name first.
export function findConcepts(list, text, most = 8) {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean)
	if (words.length === 0) return []
	const holds = (said) => words.every((word) => said.toLowerCase().includes(word))
	const named = list.filter((each) => holds(each.name))
	const said = list.filter((each) => !holds(each.name) && holds(`${each.name} ${each.line ?? ''}`))
	return [...named, ...said].slice(0, most)
}

// search is { text, at, list }: what the reader typed, the row the arrow keys are on, and everything search can
// find, or null while the page reads it.
export function foundHtml(search, home) {
	if (search.text.trim() === '') return ''
	if (search.list === null) return '<p class="k-found-note" role="status">Reading what there is to find.</p>'
	if (search.list === false) {
		return '<p class="k-found-note" role="status">ken could not read what there is to find. Type again to try once more.</p>'
	}
	const found = findConcepts(search.list, search.text)
	if (found.length === 0) {
		return `<p class="k-found-note" role="status">Nothing is called "${esc(search.text.trim())}". Search finds parts, processes and terms.</p>`
	}
	const rows = found.map((each, i) => {
		const colour =
			each.kind === 'part' || each.kind === 'file'
				? partClass(each.name) || partClass(partOfFile(each.id.split(':')[1]?.split(',')[0] ?? '') ?? '')
				: ''
		const lead = colour ? `<span class="k-sw ${colour}"></span>` : icon(KIND_ICONS[each.kind] ?? 'term')
		const level = each.level
			? `${levelMark(each.level, 14)}<span class="visually-hidden">${esc(levelLabel(home, each.level))}</span>`
			: ''
		return `<button class="k-found-row" role="option" id="found-${i}" data-act="found-open" data-concept="${esc(each.id)}" data-key="found-${i}" aria-selected="${i === search.at}" tabindex="-1"><span class="k-row-ic">${lead}</span><span class="k-found-name">${prose(each.name)}</span><span class="k-found-kind">${KIND_WORDS[each.kind] ?? ''}${level}</span></button>`
	})
	return `${rows.join('')}<p class="k-found-note">Enter opens the brief. Escape closes.</p>`
}

const TEXT_SAYS = {
	pictures: 'A large picture, and one line for each thing to know.',
	balanced: 'The picture, and a sentence under each line.',
	words: 'A smaller picture, and a short paragraph under each line.',
}

// prefs is { text, theme }. files is where ken keeps what it knows: the project's folder, and the folder outside it
// with the reader's own files.
export function settingsHtml(prefs, files) {
	const texts = Object.entries(TEXTS).map(
		([text, name]) =>
			`<button class="k-pick" data-act="pref-text" data-text="${text}" data-key="set-text-${text}" aria-pressed="${prefs.text === text}">${icon(text)}<span><b>${name}</b><span>${TEXT_SAYS[text]}</span></span>${icon('tick', 'k-tick')}</button>`,
	)
	const theme = (name, label, glyph) =>
		`<button data-act="pref-theme" data-theme="${name}" data-key="set-theme-${name}" aria-pressed="${prefs.theme === name}">${icon(glyph)}${label}</button>`
	const kept = files.own
		? `<p class="k-files">ken reads the project in <code>${esc(files.project ?? '')}</code> and writes there only to its record, in <code>.ken/</code>. What it knows of you is in <code>${esc(files.own)}</code>, on this computer.</p>`
		: '<p class="k-files">ken keeps what it knows of you on this computer, outside the project.</p>'
	return `<h2 class="k-eyebrow" id="settings-title" tabindex="-1">How much text</h2>
		${texts.join('')}
		<h2 class="k-eyebrow">Light or dark</h2>
		<div class="k-seg" role="group" aria-label="Light or dark">${theme('light', 'Light', 'sun')}${theme('dark', 'Dark', 'moon')}</div>
		<h2 class="k-eyebrow">Where ken keeps its files</h2>
		${kept}`
}
