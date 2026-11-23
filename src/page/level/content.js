// What ken has to say about the subject on screen, found by plain code among the reader's saved questions. A level
// ken's model named may have a tour, and a change may have a story and a walkthrough. Each is the newest answered
// question that asked for exactly that about exactly that subject, so the home opens it again with no run of the
// model. The server says what a question asked for, so a later question about the same change is not taken for its
// story. A level also keeps each diagram ken's model drew because the reader asked to see it another way.

// Whether two lists, such as the paths of two levels, hold the same things in the same order.
export const sameList = (a, b) => a.length === b.length && a.every((each, i) => each === b[i])
const sameSet = (a, b) => a.length === b.length && a.every((each) => b.includes(each))

// The diagram a saved question holds, or null: the first one, when its reply has more.
export function diagramOf(q) {
	return q?.reply.items.find((item) => item.kind === 'card' && item.card.kind === 'diagram')?.card.diagram ?? null
}

// The pictures of the level on screen: its parts, then its drawn pictures, newest first. A drawn picture is a diagram
// ken's model drew because the reader asked to see this level another way. It is named by the diagram's title, which
// is null until the page has read the reply, and asked is the reader's own words.
export function picturesOf(look, rows, replies = new Map()) {
	const drawn = rows
		.filter(
			(row) => row.outcome === 'answered' && row.view?.drew === 'diagram' && sameList(row.view.within, look.within),
		)
		.reverse()
		.map((row) => ({
			kind: 'drawn',
			id: row.id,
			title: diagramOf(replies.get(row.id))?.title ?? null,
			asked: row.view.asked,
		}))
	return [{ kind: 'parts' }, ...drawn]
}

// look is the level on screen as GET /api/layout sends it, and rows the reader's questions, oldest first, as
// GET /api/questions sends them. replies holds the saved questions the page has read so far, by id: q is null until
// the one found is among them. shown is the id of the drawn picture on screen, or null when the parts are.
export function contentOf(look, rows, replies = new Map(), shown = null) {
	const answered = rows.filter((row) => row.outcome === 'answered').reverse()
	const found = (row) => (row ? { id: row.id, q: replies.get(row.id) ?? null } : null)
	const picture = picturesOf(look, rows, replies).find((each) => each.kind === 'drawn' && each.id === shown)
	if (picture) return { kind: 'drawn', picture, ...found(picture) }
	if (look.change) {
		const { base, head } = look.change.range
		const about = answered.filter((row) => row.change?.base === base && row.change.head === head)
		return {
			kind: 'change',
			story: found(about.find((row) => row.want === 'story')),
			walk: found(about.find((row) => row.want === 'walk' && row.steps > 0)),
		}
	}
	if (!look.named) return { kind: 'folders' }
	const stops = (look.tour ?? []).map((stop) => stop.name)
	// A tour is of this level when its stops are the level's parts. The order the server walks them in may have
	// changed since: each stop's words are about its part, so they still hold.
	const tour = answered.find(
		(row) => row.tour && sameList(row.tour.within, look.within) && sameSet(row.tour.stops, stops) && stops.length > 0,
	)
	return { kind: 'level', about: look.named.about, tour: found(tour) }
}

export function repliesOf(content) {
	const all = { change: [content.story, content.walk], level: [content.tour], drawn: [content], folders: [] }
	return all[content.kind].filter(Boolean)
}

// A reply to a request to show a level another way, as the inspector tells it: without the card the canvas shows.
// That is the parts ken drew again, and the diagram when the reply is a drawn picture.
export function besideCanvas(q, drawn) {
	const onCanvas = drawn ? diagramOf(q) : null
	const items = q.reply.items.filter(
		(item) => item.kind !== 'card' || (item.card.kind !== 'layout' && item.card.diagram !== onCanvas),
	)
	return { ...q, reply: { ...q.reply, items } }
}

// The elements of a diagram a reader steps through: those the drawing numbers. The participants of a sequence have
// no number, so its path is its messages.
export function diagramPath(diagram) {
	return (diagram?.elements ?? []).filter((element) => element.numbered)
}

// The files a step changed, from the changed blocks its quotes fall on, each with its lines added and removed.
export function stepFiles(step, limit) {
	const files = new Map()
	for (const { path, hunk } of step.hunks) {
		const file = files.get(path) ?? { path, added: 0, removed: 0 }
		const lines = limit === undefined ? hunk.lines : hunk.lines.slice(0, limit)
		file.added += lines.filter((line) => line.startsWith('+')).length
		file.removed += lines.filter((line) => line.startsWith('-')).length
		files.set(path, file)
	}
	return [...files.values()]
}
