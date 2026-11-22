// The briefs of what the drawings of where a project runs and what it talks to draw: a frame, a store, an outside
// thing and a crossing. The server builds each from the drawings with no model: the model's one line, the lines ken
// found in git, the crossings into and out of it, what sits in a frame, a bus's topics, and what the repository does
// not say. This file draws the parts of the drawer that differ from a part's brief.
import { mark } from '../arch-views/drawing.js'
import { partClass } from '../project/part-colours.js'
import { icon } from '../shell/icons.js'
import { esc, prose } from '../views/format.js'
import { readConcept } from './concept-id.js'

export const VIEW_KINDS = { frame: 'Frame', store: 'Store', outside: 'Outside', crossing: 'Crossing' }
const ICONS = { frame: 'runs', store: 'store', outside: 'outside', crossing: 'bus' }

export const isViewKind = (kind) => Object.hasOwn(VIEW_KINDS, kind)

export const viewKindHtml = (kind) => `<span class="k-kind">${mark(ICONS[kind])}${VIEW_KINDS[kind]}</span>`

// A row that opens another brief, led by the mark of its kind or the colour of its part.
function rowHtml({ id, name, note, key }) {
	const concept = readConcept(id)
	const lead =
		concept?.kind === 'part'
			? `<span class="k-row-ic"><span class="k-sw ${partClass(concept.name)}"></span></span>`
			: `<span class="k-row-ic">${concept?.kind === 'crossing' ? icon('arrow') : mark(ICONS[concept?.kind] ?? 'runs')}</span>`
	return `<li><button class="k-row" data-act="brief-open" data-concept="${esc(id)}" data-key="${key}">${lead}<span class="k-row-main"><b>${prose(name)}</b>${note ? `<span class="k-row-note">${prose(note)}</span>` : ''}</span>${icon('right', 'k-row-go')}</button></li>`
}

// What sits under the line of a view's brief: what the repository does not say, and a bus's topics with who
// publishes on each and who picks up.
export function viewMainHtml(brief, views) {
	const gaps =
		brief.gaps?.length > 0
			? `<h3 class="k-eyebrow">Not in the repository</h3>${brief.gaps.map((gap) => `<p class="k-rt-note is-brief">${prose(gap)}</p>`).join('')}`
			: ''
	return `${gaps}${topicsHtml(brief, views)}`
}

function topicsHtml(brief, views) {
	if (!(brief.topics?.length > 0)) return ''
	const runtime = views?.runtime
	const id = readConcept(brief.id)?.name
	const things = new Map((runtime?.things ?? []).map((thing) => [thing.id, thing]))
	const outside = new Map((views?.world?.outside ?? []).map((each) => [each.id, each.name]))
	const nameOf = (thingId) => {
		const thing = things.get(thingId)
		if (!thing) return thingId
		return thing.kind === 'part' ? thing.part : thing.kind === 'store' ? thing.name : (outside.get(thingId) ?? thingId)
	}
	const rows = brief.topics.map((topic) => {
		const events = (runtime?.crossings ?? []).filter((c) => c.kind === 'event' && c.topic === topic)
		const send = [...new Set(events.filter((c) => c.from !== id).map((c) => nameOf(c.from)))]
		const take = [...new Set(events.filter((c) => c.to !== id).map((c) => nameOf(c.to)))]
		const who = (names) => (names.length === 0 ? '<em>none drawn</em>' : names.map(esc).join(', '))
		return `<li><code>${esc(topic)}</code><span class="k-topic-who"><i class="k-rt-dot" aria-hidden="true"></i>Publishes: ${who(send)}</span><span class="k-topic-who"><i class="k-rt-ring" aria-hidden="true"></i>Picks up: ${who(take)}</span></li>`
	})
	return `<h3 class="k-eyebrow">${brief.topics.length} ${brief.topics.length === 1 ? 'topic' : 'topics'}</h3><ul class="k-topics">${rows.join('')}</ul>`
}

export const viewDeeperCount = (brief) => (brief.inside?.length ?? 0) + (brief.parts?.length ?? 0)

export function viewSidewaysHtml(brief, back) {
	const group = (title, rows, key) =>
		rows.length === 0
			? ''
			: `<h3 class="k-eyebrow">${title}</h3><ul class="k-rows">${rows.map((row, i) => rowHtml({ id: row.id, name: row.name, note: row.verb, key: `${key}-${i}` })).join('')}</ul>`
	const none =
		brief.sideways.uses.length + brief.sideways.usedBy.length === 0
			? `<p class="k-none">No crossing in the drawing goes into it or out of it.</p>`
			: ''
	return `${back}
		<h2 class="k-way-name" id="brief-name" tabindex="-1">What crosses into and out of ${prose(brief.name)}</h2>
		${group('Comes in from', brief.sideways.usedBy, 'by')}
		${group('Goes out to', brief.sideways.uses, 'uses')}
		${none}`
}

export function viewDeeperHtml(brief, back) {
	const inside = (brief.inside ?? []).map((each, i) => rowHtml({ id: each.id, name: each.name, key: `brief-in-${i}` }))
	const parts = (brief.parts ?? []).map((each, i) => rowHtml({ id: each.id, name: each.name, key: `brief-part-${i}` }))
	const none =
		inside.length + parts.length === 0
			? `<p class="k-none">${brief.kind === 'frame' ? 'Nothing in the drawing runs inside it.' : 'Nothing is inside it in the drawing.'}</p>`
			: ''
	return `${back}
		<h2 class="k-way-name" id="brief-name" tabindex="-1">Inside ${prose(brief.name)}</h2>
		${inside.length > 0 ? `<h3 class="k-eyebrow">What runs right in it</h3><ul class="k-rows">${inside.join('')}</ul>` : ''}
		${parts.length > 0 ? `<h3 class="k-eyebrow">The parts in it, at any depth</h3><ul class="k-rows">${parts.join('')}</ul>` : ''}
		${none}`
}
