// Writes a checked diagram as Mermaid text. Names and texts come from a model, so none of them reaches Mermaid as
// syntax: ids are made from element numbers, and every label passes through safe, which writes each character outside
// letters, digits, spaces, "." "_" and "-" as an entity code such as #34;. Mermaid draws the code as the character.
import type { Cardinality, ComponentDiagram, Diagram, EntityDiagram, SequenceDiagram } from './diagram.ts'

export function mermaidText(diagram: Diagram): string {
	switch (diagram.kind) {
		case 'component':
			return componentText(diagram)
		case 'sequence':
			return sequenceText(diagram)
		case 'entity-relationship':
			return entityText(diagram)
		default:
			return diagram satisfies never
	}
}

function componentText(diagram: ComponentDiagram): string {
	const id = ids(diagram.boxes)
	const lines = ['flowchart LR']
	const box = (each: ComponentDiagram['boxes'][number], indent: string) =>
		`${indent}${id(each.name)}["${numbered(each.number, each.name)}"]`
	for (const each of diagram.boxes) if (each.group === null) lines.push(box(each, '  '))
	const groups = [...new Set(diagram.boxes.flatMap((each) => (each.group === null ? [] : [each.group])))]
	for (const [index, group] of groups.entries()) {
		lines.push(`  subgraph g${index + 1}["${safe(group)}"]`)
		for (const each of diagram.boxes) if (each.group === group) lines.push(box(each, '    '))
		lines.push('  end')
	}
	for (const arrow of diagram.arrows) {
		lines.push(`  ${id(arrow.from)} -->|"${numbered(arrow.number, arrow.text)}"| ${id(arrow.to)}`)
	}
	return lines.join('\n')
}

function sequenceText(diagram: SequenceDiagram): string {
	const id = ids(diagram.participants)
	const lines = ['sequenceDiagram']
	for (const each of diagram.participants)
		lines.push(`  participant ${id(each.name)} as ${numbered(each.number, each.name)}`)
	for (const message of diagram.messages) {
		lines.push(`  ${id(message.from)}->>${id(message.to)}: ${numbered(message.number, message.text)}`)
	}
	return lines.join('\n')
}

const ENDS: Record<Cardinality, string> = {
	'one-to-one': '||--||',
	'one-to-many': '||--o{',
	'many-to-one': '}o--||',
	'many-to-many': '}o--o{',
}

function entityText(diagram: EntityDiagram): string {
	const id = ids(diagram.entities)
	const lines = ['erDiagram']
	for (const entity of diagram.entities) {
		const head = `  ${id(entity.name)}["${numbered(entity.number, entity.name)}"]`
		if (entity.fields.length === 0) {
			lines.push(head)
			continue
		}
		lines.push(`${head} {`)
		for (const field of entity.fields) lines.push(`    ${word(field.type, true)} ${word(field.name, false)}`)
		lines.push('  }')
	}
	for (const relation of diagram.relations) {
		const ends = ENDS[relation.cardinality]
		lines.push(`  ${id(relation.from)} ${ends} ${id(relation.to)} : "${numbered(relation.number, relation.text)}"`)
	}
	return lines.join('\n')
}

// The check made every name in a diagram unique without regard to case, and every edge names one of them.
function ids(nodes: { number: number; name: string }[]): (name: string) => string {
	const byName = new Map(nodes.map((node) => [node.name, `n${node.number}`]))
	return (name) => {
		const found = byName.get(name)
		if (found === undefined)
			throw new Error(`a checked diagram has an edge to "${name}", which is not one of its nodes`)
		return found
	}
}

function numbered(number: number, text: string): string {
	return `${number}. ${safe(text)}`
}

// Line breaks become spaces, so no text can start a new statement.
function safe(text: string): string {
	let written = ''
	for (const char of text.replaceAll(/\s+/g, ' ').trim()) {
		written += /^[\p{L}\p{N} ._-]$/u.test(char) ? char : `#${char.codePointAt(0)};`
	}
	return written
}

// An attribute of an entity is two bare words in Mermaid, and entity codes do not work there, so any other character
// becomes "_". PK, FK and UK would read as key markers, so they gain one too.
function word(text: string, isType: boolean): string {
	const allowed = isType ? /[^A-Za-z0-9_[\]]/g : /[^A-Za-z0-9_]/g
	const replaced = text.replaceAll(allowed, '_')
	const start = /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`
	return ['PK', 'FK', 'UK'].includes(start) ? `${start}_` : start
}
