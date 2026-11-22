// The processes ken has drawn: every checked diagram in the reader's saved replies and in the record's pieces of work,
// as lanes and the messages between them. A lane is a box, a participant or an entity of the drawing, and plain code
// finds the part of a level it stands for, by its name or by the files its lines are in.
import type { Diagram } from '../../diagram/index.ts'
import type { HistoryEntry } from '../../history/index.ts'
import { under } from '../../layout/index.ts'
import { type RecordRead, sameName } from '../../record/index.ts'
import { shortHash } from './concept.ts'
import { type BriefQuote, fileQuotes } from './told.ts'

// A part of the level the lanes are matched against.
export type PartRef = { id: string; name: string; paths: string[] }

// from and to are indexes into lanes. part is the part a message's quoted lines are in, else the part of the lane it
// starts at. drawn is the day ken drew it.
export type Process = {
	id: string
	name: string
	steps: number
	drawn: string
	lanes: { part: string | null; name: string }[]
	messages: { n: number; from: number; to: number; line: string; part: string | null; quotes: BriefQuote[] }[]
}

// within is the level the reader asked ken to draw it for, the whole project when they asked in words alone.
export type Drawn = { id: string; diagram: Diagram; at: string; within: string[] }

// Newest first. The same drawing in a reply and in the record is one process.
export function drawnOf(
	answered: Extract<HistoryEntry, { outcome: 'answered' | 'partial' }>[],
	record: RecordRead,
): Drawn[] {
	const draw = (diagram: Diagram, at: string, within: string[]) => ({ id: idOf(diagram), diagram, at, within })
	const replied = answered.flatMap(({ reply, askedAt }) =>
		reply.items.flatMap((item) =>
			item.kind === 'card' && item.card.kind === 'diagram'
				? [draw(item.card.diagram, askedAt, reply.view?.within ?? [])]
				: [],
		),
	)
	const recorded = record.current.flatMap((entry) =>
		entry.kind === 'work' ? entry.diagrams.map((diagram) => draw(diagram, entry.at, [])) : [],
	)
	const all = [...replied, ...recorded].toSorted((a, b) => b.at.localeCompare(a.at))
	return all.filter((each, at) => all.findIndex((other) => other.id === each.id) === at)
}

export function processOf({ id, diagram, at }: Drawn, parts: PartRef[]): Process {
	const { nodes, edges } = nodesAndEdges(diagram)
	const holding = (quotes: BriefQuote[]) =>
		parts.find((part) => quotes.some((quote) => part.paths.some((place) => under(quote.path, place))))?.id ?? null
	const laneOf = (name: string) =>
		Math.max(
			0,
			nodes.findIndex((node) => node.name.toLowerCase() === name.toLowerCase()),
		)
	const startingAt = (name: string) => edges.filter((edge) => edge.from.toLowerCase() === name.toLowerCase())
	const lanes = nodes.map((node) => ({
		name: node.name,
		part:
			parts.find((part) => sameName(part.name, node.name))?.id ??
			holding(fileQuotes(node.quotes)) ??
			holding(startingAt(node.name).flatMap((edge) => fileQuotes(edge.quotes))),
	}))
	const messages = edges.map((edge, k) => {
		const quotes = fileQuotes(edge.quotes)
		const from = laneOf(edge.from)
		return {
			n: k + 1,
			from,
			to: laneOf(edge.to),
			line: edge.text,
			part: holding(quotes) ?? lanes[from]?.part ?? null,
			quotes,
		}
	})
	return { id, name: diagram.title, steps: messages.length, drawn: at.slice(0, 10), lanes, messages }
}

function nodesAndEdges(diagram: Diagram) {
	switch (diagram.kind) {
		case 'component':
			return { nodes: diagram.boxes, edges: diagram.arrows }
		case 'sequence':
			return { nodes: diagram.participants, edges: diagram.messages }
		case 'entity-relationship':
			return { nodes: diagram.entities, edges: diagram.relations }
		default:
			return diagram satisfies never
	}
}

// The drawing's own content names it, so the same process keeps its id wherever ken finds it.
function idOf(diagram: Diagram): string {
	const { nodes, edges } = nodesAndEdges(diagram)
	return shortHash([
		diagram.kind,
		diagram.title,
		nodes.map((node) => node.name),
		edges.map((edge) => [edge.from, edge.to, edge.text]),
	])
}
