import type { Label, VerifiedGitQuote } from '../checks/index.ts'
import type { Diagram } from './diagram.ts'

// label is null for a box, a participant or an entity: it only says where the thing is defined.
export type DiagramElement = { number: number; text: string; label: Label | null; quotes: VerifiedGitQuote[] }

// An arrow points at the thing its text would name next, so a text that ends on one of these words ("appends each
// question to") drops it: the line under the drawing names the target, and in the drawing the word sits alone.
const TRAILING = new Set(['to', 'into', 'onto', 'from', 'with', 'for', 'of', 'by'])

export function edgeText(text: string): string {
	const words = text.trim().split(/\s+/)
	return words.length > 1 && TRAILING.has(words.at(-1)?.toLowerCase() ?? '') ? words.slice(0, -1).join(' ') : text
}

// Every element of a diagram in number order, as one line of text each, for the list under the drawing. An arrow, a
// message or a relation reads "From A to B: what it says", so the names never run into the words between them.
export function diagramElements(diagram: Diagram): DiagramElement[] {
	const node = (each: { number: number; quotes: VerifiedGitQuote[] }, text: string) => ({
		number: each.number,
		text,
		label: null,
		quotes: each.quotes,
	})
	const edge = (each: { number: number; label: Label; quotes: VerifiedGitQuote[] }, text: string) => ({
		number: each.number,
		text,
		label: each.label,
		quotes: each.quotes,
	})
	switch (diagram.kind) {
		case 'component':
			return [
				...diagram.boxes.map((box) => node(box, box.group === null ? box.name : `${box.name}, in ${box.group}`)),
				...diagram.arrows.map((arrow) => edge(arrow, `From ${arrow.from} to ${arrow.to}: ${edgeText(arrow.text)}`)),
			]
		case 'sequence':
			return [
				...diagram.participants.map((participant) => node(participant, participant.name)),
				...diagram.messages.map((message) =>
					edge(message, `From ${message.from} to ${message.to}: ${edgeText(message.text)}`),
				),
			]
		case 'entity-relationship':
			return [
				...diagram.entities.map((entity) => {
					const fields = entity.fields.map((field) => field.name).join(', ')
					return node(entity, fields === '' ? entity.name : `${entity.name}: ${fields}`)
				}),
				...diagram.relations.map((relation) =>
					edge(
						relation,
						`From ${relation.from} to ${relation.to}: ${edgeText(relation.text)}, ${relation.cardinality.replaceAll('-', ' ')}`,
					),
				),
			]
		default:
			return diagram satisfies never
	}
}
