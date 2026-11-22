// The architecture in words. Each part and connection opens the same brief as on the canvas.
import { arrowId, partId } from '../brief/concept-id.js'
import { esc, prose } from '../views/format.js'
import { FRAME_NAMES } from './drawing.js'
import { crossingWords } from './world-layout.js'

function row(id, name, note = '', key = id) {
	return `<li><button class="k-link" data-act="brief-open" data-concept="${esc(id)}" data-key="read-${esc(key)}">${prose(name)}</button>${note ? `<p>${prose(note)}</p>` : ''}</li>`
}

function section(name, rows) {
	return rows.length ? `<section><h3>${name}</h3><ul>${rows.join('')}</ul></section>` : ''
}

function partsHtml(look) {
	const parts = look.boxes.map((box) => row(partId(look.within, box.name), box.name, box.told ?? box.job))
	const arrows = look.arrows.map((arrow, i) =>
		row(
			arrowId(look.within, i + 1),
			`${arrow.from} ${arrow.text} ${arrow.to}`,
			arrow.stale ? 'The part this arrow starts from has changed since ken drew it.' : '',
		),
	)
	return section('Parts', parts) + section('How the parts connect', arrows)
}

function worldHtml(world, project) {
	const people = world.outside.map((each) => row(`outside:${each.id}`, each.name, each.line))
	const links = world.crossings.map((c) => {
		const other = world.outside.find((each) => each.id === c.outside)?.name ?? c.outside
		const ends =
			c.direction === 'both'
				? `${project} and ${other}, both ways`
				: c.direction === 'in'
					? `${other} to ${project}`
					: `${project} to ${other}`
		return row(`crossing:${c.id}`, ends, crossingWords(c))
	})
	return section('People and other systems', people) + section('What passes between them', links)
}

function runtimeHtml({ runtime, world }) {
	const { frames, things, crossings } = runtime
	const outside = (id) => world?.outside.find((each) => each.id === id)
	const names = new Map(things.map((t) => [t.id, t.part ?? t.name ?? outside(t.id)?.name ?? t.id]))
	const frameName = (id) => frames.find((frame) => frame.id === id)?.name
	const places = frames.map((f) => {
		const context = [
			FRAME_NAMES[f.kind],
			f.in && `inside ${frameName(f.in)}`,
			f.copies && `${f.copies.count} ${f.copies.count === 1 ? 'copy' : 'copies'}`,
		]
			.filter(Boolean)
			.join(', ')
		return row(`frame:${f.id}`, f.name, `${context}. ${f.line}`)
	})
	const components = things.map((t) => {
		const id = t.kind === 'part' ? partId([], t.part) : `${t.kind}:${t.id}`
		const where = t.frame ? `In ${frameName(t.frame)}. ` : ''
		const description = t.line ?? (t.kind === 'outside' ? outside(t.id)?.line : '') ?? ''
		return row(id, names.get(t.id), where + description, t.id)
	})
	const links = crossings.map((c) => {
		const from = names.get(c.from)
		const to = names.get(c.to)
		const line = c.kind === 'call' ? `${from} calls ${to}` : `${from} sends ${c.topic} to ${to}`
		const note = c.kind === 'call' ? crossingWords(c) : c.text
		return row(`crossing:${c.id}`, line, note)
	})
	return (
		section('Places the code runs', places) +
		section('Parts, stores and other systems', components) +
		section('Calls and events', links)
	)
}

export function readingHtml(look, view, project) {
	if (view === 'world') return worldHtml(look.views.world, project)
	if (view === 'runtime') return runtimeHtml(look.views)
	return partsHtml(look)
}
