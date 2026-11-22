// What ken has to say about the subject on screen, found by plain code among the reader's saved questions. A level
// ken's model named may have a tour, and a change may have a story and a walkthrough. Each is the newest answered
// question about exactly that subject, so the home opens it again with no run of the model. The reading path is what
// the home walks through at "How it works" and "In the code": the stops of a tour, or the steps of a walkthrough.
import { walkOf } from '../project/walk.js'

const same = (a, b) => a.length === b.length && a.every((each, i) => each === b[i])

// look is the level on screen as GET /api/layout sends it, and rows the reader's questions, oldest first, as
// GET /api/questions sends them. replies holds the saved questions the page has read so far, by id: q is null until
// the one found is among them.
export function contentOf(look, rows, replies = new Map()) {
	const answered = rows.filter((row) => row.outcome === 'answered').reverse()
	const found = (row) => (row ? { id: row.id, q: replies.get(row.id) ?? null } : null)
	if (look.change) {
		const { base, head } = look.change.range
		const about = answered.filter((row) => row.change?.base === base && row.change.head === head)
		return {
			kind: 'change',
			story: found(about.find((row) => row.steps === 0)),
			walk: found(about.find((row) => row.steps > 0)),
		}
	}
	if (!look.named) return { kind: 'folders' }
	const stops = (look.tour ?? []).map((stop) => stop.name)
	const tour = answered.find(
		(row) => row.tour && same(row.tour.within, look.within) && same(row.tour.stops, stops) && stops.length > 0,
	)
	return { kind: 'level', about: look.named.about, tour: found(tour) }
}

// The saved questions a content names, read or not.
export function repliesOf(content) {
	const all = content.kind === 'change' ? [content.story, content.walk] : content.kind === 'level' ? [content.tour] : []
	return all.filter(Boolean)
}

// The detail the home shows. A level of folders has one: git knows nothing more of it than the big picture.
export function shownDetail(home) {
	return home.look?.named ? home.detail : 'big'
}

// The reading path of what is on screen, in order. For a named level it is one stop per part, in the order plain code
// picked from the arrows, each with the words and cards of the stored tour when there is one. For a change it is the
// steps of its stored walkthrough. A stop the tour has no words for has text null.
export function pathOf(look, content) {
	if (content.kind === 'change') return content.walk?.q ? walkOf(content.walk.q.reply) : []
	if (content.kind !== 'level') return []
	const told = content.tour?.q ? walkOf(content.tour.q.reply) : []
	return (look.tour ?? []).map(
		(stop, k) =>
			told.find((step) => step.number === k + 1) ?? {
				number: k + 1,
				text: null,
				cards: [],
				hunks: [],
				part: stop.name,
			},
	)
}

// Where the selection is on the path, or -1: a part is the stop of that part, a step is itself.
export function placeOf(path, selected) {
	if (!selected) return -1
	return path.findIndex((step) =>
		selected.kind === 'part' ? step.part === selected.name : step.number === selected.number,
	)
}

// Where the reader stands on the topics named, among those ken keeps for the box: "none" when ken keeps none of them,
// "known" when the reader said they understand each and no code of them changed since, "new" when they have not met
// one of them, and "met" otherwise.
export function stoodOn(box, names) {
	const wanted = names.map((name) => name.toLowerCase())
	const marks = box.topics.filter((each) => wanted.includes(each.topic.toLowerCase())).map((each) => each.mark)
	if (marks.length === 0) return 'none'
	if (marks.every((mark) => mark === 'understood')) return 'known'
	return marks.includes('new') ? 'new' : 'met'
}
