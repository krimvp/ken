import type { Label, VerifiedQuote } from '../checks/index.ts'
import type { Diagram } from './diagram.ts'

// label is null for a box, a participant or an entity: it only says where the thing is defined.
export type DiagramElement = { number: number; text: string; label: Label | null; quotes: VerifiedQuote[] }

// Every element of a diagram in number order, as one line of text each, for the list under the drawing.
export function diagramElements(diagram: Diagram): DiagramElement[] {
	const node = (each: { number: number; quotes: VerifiedQuote[] }, text: string) => ({
		number: each.number,
		text,
		label: null,
		quotes: each.quotes,
	})
	const edge = (each: { number: number; label: Label; quotes: VerifiedQuote[] }, text: string) => ({
		number: each.number,
		text,
		label: each.label,
		quotes: each.quotes,
	})
	switch (diagram.kind) {
		case 'component':
			return [
				...diagram.boxes.map((box) => node(box, box.group === null ? box.name : `${box.name}, in ${box.group}`)),
				...diagram.arrows.map((arrow) => edge(arrow, `${arrow.from} ${arrow.text} ${arrow.to}`)),
			]
		case 'sequence':
			return [
				...diagram.participants.map((participant) => node(participant, participant.name)),
				...diagram.messages.map((message) => edge(message, `${message.from} to ${message.to}: ${message.text}`)),
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
						`${relation.from} ${relation.text} ${relation.to}, ${relation.cardinality.replaceAll('-', ' ')}`,
					),
				),
			]
		default:
			return diagram satisfies never
	}
}
