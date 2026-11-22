// shortcut: builds a brief, and the list search reads, from what the server sends today: a level's box and its
// arrows, the stops of its tour where it has one, the record's decisions and the drawn diagrams. It is used only when
// GET /api/brief or GET /api/concepts answers 404. Its limits: a thing to know has no drawing of its own and no short
// line, a concept has no stored question, and a term is found only in a tour the page has read. Delete this file when
// the server's brief (branch dash2-server) is merged.
import { isFile } from '../home/canvas/part-box.js'
import { contentOf, diagramOf, diagramPath, picturesOf } from '../home/state/content.js'
import { cardQuotes, partOf, walkOf } from '../project/walk.js'
import { decisionQuotes, isSession } from '../views/format.js'
import { decisionId, partId, processId, readConcept, termId } from './concept-id.js'

export const TRUST = "ken's model wrote the words. ken found each quoted line in git."
const FROM_GIT = 'ken read this from git. Its model has not explained it yet.'

const sentences = (text) => text.trim().split(/(?<=[.?!])\s+(?=[A-Z`"'(])/)
const inFiles = (quotes) => quotes.filter((quote) => !isSession(quote) && quote.path !== null)
const holds = (paths, file) => paths.some((place) => file === place || file.startsWith(`${place}/`))
const NO_WAYS = { uses: [], usedBy: [], processes: [] }

// A stop of a tour as things to know: what the stop says first, then each claim it rests on with its quoted lines.
function pointsOf(stop) {
	const [first, second = '', ...rest] = sentences(stop.text)
	const claims = stop.cards.flatMap(({ card }) => {
		const said = card.claim ?? card.risk
		if (!said) return []
		const [line, ...more] = sentences(said.text)
		return [{ line, more: more.join(' '), long: '', drawing: { kind: 'dot' }, quotes: inFiles(cardQuotes(card)) }]
	})
	return [{ line: first, more: second, long: rest.join(' '), drawing: { kind: 'dot' }, quotes: [] }, ...claims]
}

// read asks the server and gives { ok, body, status }. rows gives the reader's saved questions, and levelName the
// name of a level the reader is inside, by its paths, for the question the tour is asked with.
export function fromToday({ read, rows, levelName }) {
	let looks = new Map()
	let replies = new Map()
	let decided = null
	// The terms of the tours read so far, by name.
	let terms = new Map()

	const kept = (map, key, make) => {
		if (!map.has(key)) map.set(key, make())
		return map.get(key)
	}
	const lookAt = (within) =>
		kept(looks, within.join(','), async () => {
			const answer = await read(`/api/layout?${new URLSearchParams(within.map((path) => ['within', path]))}`)
			return answer.ok ? answer.body.look : null
		})
	const replyOf = (id) =>
		kept(replies, id, async () => {
			const answer = await read(`/api/questions/${encodeURIComponent(id)}`)
			return answer.ok ? answer.body.entry.reply : null
		})
	const decisions = async () => {
		decided ??= read('/api/decisions').then((answer) => (answer.ok ? answer.body.decisions : []))
		return (await decided).filter((row) => !row.replacedBy).map((row) => row.decision)
	}

	// The stops of the level's stored tour, each with its words and cards, and its terms kept for search.
	async function tourOf(look) {
		const found = contentOf(look, rows())
		const reply = found.kind === 'level' && found.tour ? await replyOf(found.tour.id) : null
		const parts = look.boxes.map((box) => box.name.toLowerCase())
		// A topic that only repeats its part's name is the part itself, so it is no term of its own.
		const stops = walkOf(reply)
			.filter((stop) => stop.part !== null)
			.map((stop) => ({
				...stop,
				cards: stop.cards.filter(({ card }) => card.kind !== 'topic' || !parts.includes(card.topic.name.toLowerCase())),
			}))
		for (const stop of stops) {
			for (const { card } of stop.cards) {
				if (card.kind === 'topic') terms.set(card.topic.name, { ...card.topic, part: stop.part, within: look.within })
			}
		}
		return stops
	}

	async function processesOf(look) {
		const drawn = picturesOf(look, rows()).slice(1)
		const held = await Promise.all(drawn.map(async (picture) => ({ picture, reply: await replyOf(picture.id) })))
		return held.flatMap(({ picture, reply }) => {
			const diagram = diagramOf({ reply: reply ?? { items: [] } })
			return diagram ? [{ id: picture.id, asked: picture.asked, diagram, reply, within: look.within }] : []
		})
	}

	const partOfStep = (step, look) => {
		const file = inFiles(step.quotes)[0]?.path
		const at = file === undefined ? -1 : partOf(file, look.boxes)
		return at < 0 ? null : look.boxes[at]
	}

	async function partBrief(id, { within, name }) {
		const look = await lookAt(within)
		const box = look?.boxes.find((each) => each.name === name)
		if (!box) return null
		const stop = (await tourOf(look)).find((each) => each.part === name) ?? null
		const file = !look.named && isFile(box)
		const points = stop ? pointsOf(stop) : []
		const passing = (await processesOf(look)).filter((process) =>
			diagramPath(process.diagram).some((step) => partOfStep(step, look) === box),
		)
		const about = (await decisions()).filter((d) =>
			inFiles(decisionQuotes(d)).some((quote) => holds(box.paths, quote.path)),
		)
		const canExplain = !stop && look.named && look.at === look.head && !file
		const way = (arrow, other) => ({ id: partId(within, other), name: other, verb: arrow.text })
		return {
			id,
			kind: file ? 'file' : 'part',
			name,
			line: box.job ?? (file ? box.paths[0] : `${box.files} files in ${box.paths.join(', ')}.`),
			minutes: stop ? Math.max(2, Math.ceil(points.length / 2)) : 1,
			explained: stop !== null,
			explain: canExplain ? { lens: { kind: 'tour', within, name: levelName(within) } } : null,
			points,
			terms: (stop?.cards ?? []).flatMap(({ card }) =>
				card.kind === 'topic' ? [{ id: termId(card.topic.name), name: card.topic.name }] : [],
			),
			questions: [],
			decisions: about.map((d) => ({
				id: decisionId(d.id),
				question: d.question,
				chosen: d.chosen,
				why: d.reason?.text ?? '',
			})),
			sideways: {
				uses: look.arrows.filter((arrow) => arrow.from === name).map((arrow) => way(arrow, arrow.to)),
				usedBy: look.arrows.filter((arrow) => arrow.to === name).map((arrow) => way(arrow, arrow.from)),
				processes: passing.map((process) => ({
					id: processId(process.id),
					name: process.diagram.title,
					steps: diagramPath(process.diagram).length,
				})),
			},
			deeper: box.opens ? { within: box.paths.join(','), parts: box.inside ?? null, files: box.files } : null,
			steps: null,
			knows: box.knows,
			trust: stop ? TRUST : FROM_GIT,
		}
	}

	// A drawn process is found in the top level, or in a level the page has read.
	async function findProcess(id) {
		await lookAt([])
		for (const look of await Promise.all(looks.values())) {
			const found = look ? (await processesOf(look)).find((process) => process.id === id) : null
			if (found) return { process: found, look }
		}
		return null
	}

	const stepsOf = ({ process, look }) =>
		diagramPath(process.diagram).map((step) => {
			const box = partOfStep(step, look)
			return {
				n: step.number,
				part: box ? partId(look.within, box.name) : null,
				line: step.text,
				quotes: inFiles(step.quotes),
			}
		})

	async function processBrief(id, { name }) {
		const found = await findProcess(name)
		if (!found) return null
		const { process, look } = found
		const steps = stepsOf(found)
		const words = process.reply.items.find((item) => item.kind === 'words')?.text ?? ''
		const through = [...new Set(steps.map((step) => step.part).filter(Boolean))]
		return {
			id,
			kind: 'process',
			name: process.diagram.title,
			line: words ? sentences(words)[0] : `ken drew it because you asked: "${process.asked}".`,
			minutes: Math.max(2, Math.ceil(steps.length / 3)),
			explained: true,
			explain: null,
			points: [],
			terms: [],
			questions: [],
			decisions: [],
			sideways: {
				uses: through.map((part) => ({ id: part, name: readConcept(part).name, verb: 'passes through' })),
				usedBy: [],
				processes: [],
			},
			deeper: null,
			steps,
			knows: null,
			trust: TRUST,
			paths: look.boxes.flatMap((box) => (through.includes(partId(look.within, box.name)) ? box.paths : [])),
		}
	}

	async function stepBrief(id, { process: processName, n }) {
		const found = await findProcess(processName)
		const steps = found ? stepsOf(found) : []
		const step = steps.find((each) => each.n === n)
		if (!step) return null
		const part = step.part ? readConcept(step.part) : null
		return {
			id,
			kind: 'step',
			name: step.line,
			line: `Step ${steps.indexOf(step) + 1} of ${steps.length} of "${found.process.diagram.title}".`,
			minutes: 1,
			explained: true,
			explain: null,
			points: [],
			terms: [],
			questions: [],
			decisions: [],
			sideways: {
				uses: part ? [{ id: step.part, name: part.name, verb: 'happens in' }] : [],
				usedBy: [],
				processes: [{ id: processId(processName), name: found.process.diagram.title, steps: steps.length }],
			},
			deeper: null,
			steps: null,
			quotes: step.quotes,
			knows: null,
			trust: TRUST,
		}
	}

	async function termBrief(id, { name }) {
		// A term is kept when its level's tour is read: the top level's is read first, for a page opened on a term.
		if (!terms.has(name)) {
			const top = await lookAt([])
			if (top) await tourOf(top)
		}
		const term = terms.get(name)
		if (!term) return null
		const [line, ...rest] = sentences(term.note ?? '')
		return {
			id,
			kind: 'term',
			name,
			line: line ?? '',
			minutes: 1,
			explained: true,
			explain: null,
			points: rest.map((each) => ({ line: each, more: '', long: '', drawing: { kind: 'dot' }, quotes: [] })),
			terms: [],
			questions: [],
			decisions: [],
			sideways: NO_WAYS,
			deeper: null,
			steps: null,
			quotes: inFiles(term.quotes),
			usedIn: [{ id: partId(term.within, term.part), name: term.part }],
			knows: null,
			trust: TRUST,
		}
	}

	async function arrowBrief(id, { within, n }) {
		const look = await lookAt(within)
		const arrow = look?.arrows[n - 1]
		if (!arrow) return null
		const said = `${arrow.from} ${arrow.text} ${arrow.to}`
		return {
			id,
			kind: 'arrow',
			name: said,
			line: `${said}.${arrow.stale ? ' One of the two changed since, so this may be out of date.' : ''}`,
			minutes: 1,
			explained: true,
			explain: null,
			points: [],
			terms: [],
			questions: [],
			decisions: [],
			sideways: {
				uses: [{ id: partId(within, arrow.to), name: arrow.to, verb: arrow.text }],
				usedBy: [{ id: partId(within, arrow.from), name: arrow.from, verb: arrow.text }],
				processes: [],
			},
			deeper: null,
			steps: null,
			quotes: inFiles(arrow.quotes),
			knows: null,
			trust: 'ken found these lines in git.',
		}
	}

	async function decisionBrief(id, { name }) {
		const d = (await decisions()).find((each) => each.id === name)
		if (!d) return null
		return {
			id,
			kind: 'decision',
			name: d.question,
			line: d.chosen,
			why: d.reason?.text ?? '',
			minutes: 1,
			explained: true,
			explain: null,
			points: [],
			terms: [],
			questions: [],
			decisions: [],
			sideways: NO_WAYS,
			deeper: null,
			steps: null,
			quotes: inFiles(decisionQuotes(d)),
			knows: null,
			trust: TRUST,
		}
	}

	const BRIEFS = {
		part: partBrief,
		process: processBrief,
		step: stepBrief,
		term: termBrief,
		arrow: arrowBrief,
		decision: decisionBrief,
	}

	// The brief of a concept, or null when today's server holds nothing of it: a question it never stored, or an id
	// that names nothing.
	async function briefOf(id) {
		const concept = readConcept(id)
		const build = concept ? BRIEFS[concept.kind] : null
		const brief = build ? await build(id, concept) : null
		// builtToday tells the drawer that the server keeps no answer for a question about this brief.
		return brief ? { ...brief, builtToday: true } : null
	}

	// What search finds: the parts of the top level and of each level the page has read, the drawn processes, and
	// the terms of the tours.
	async function concepts() {
		const top = await lookAt([])
		if (!top) return []
		await tourOf(top)
		const all = (await Promise.all(looks.values())).filter(Boolean)
		const parts = all.flatMap((look) =>
			look.boxes.map((box) => ({
				id: partId(look.within, box.name),
				kind: !look.named && isFile(box) ? 'file' : 'part',
				name: box.name,
				line: box.job ?? box.paths.join(', '),
				level: box.knows.level,
			})),
		)
		const drawn = (await Promise.all(all.map(processesOf))).flat().map((process) => ({
			id: processId(process.id),
			kind: 'process',
			name: process.diagram.title,
			line: process.asked,
			level: null,
		}))
		const named = [...terms.values()].map((term) => ({
			id: termId(term.name),
			kind: 'term',
			name: term.name,
			line: term.note ?? '',
			level: null,
		}))
		return [...parts, ...drawn, ...named]
	}

	// What was read is let go, after a run of ken's model or a line ken wrote about the reader.
	function forget() {
		looks = new Map()
		replies = new Map()
		terms = new Map()
		decided = null
	}

	return { briefOf, concepts, lookAt, forget }
}
