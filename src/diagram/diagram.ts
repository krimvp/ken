// A diagram is checked data, never diagram syntax written by a model. The model sends boxes and arrows, ken checks
// every quote they rest on with checkQuote, and ken writes the Mermaid text itself. So a diagram always draws, and it
// cannot show a call, a write or a link that the quoted code does not show.
import type { Label, Quote, VerifiedGitQuote } from '../checks/index.ts'

export const DIAGRAM_KINDS = ['component', 'sequence', 'entity-relationship'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

// How many of one entity relate to how many of the other, read from the first entity to the second.
export const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const
export type Cardinality = (typeof CARDINALITIES)[number]

// ken numbers the elements of a diagram in one run: its boxes, participants or entities first, then its arrows,
// messages or relations, each in the order the model sent them. The terminal and the page list them by number, and
// count the messages of a sequence from 1: see diagramElements.
// A node may carry quotes that show where it is defined. An edge is a claim and carries at least one.
type Node = { number: number; name: string; quotes: VerifiedGitQuote[] }
type Edge = { number: number; from: string; to: string; text: string; label: Label; quotes: VerifiedGitQuote[] }

export type Box = Node & { group: string | null }
export type Arrow = Edge
export type Participant = Node
export type Message = Edge
export type Field = { name: string; type: string }
export type Entity = Node & { fields: Field[] }
export type Relation = Edge & { cardinality: Cardinality }

// label is the diagram's own. Each edge carries its own label, which is the diagram's unless the model gave another.
export type ComponentDiagram = { kind: 'component'; title: string; label: Label; boxes: Box[]; arrows: Arrow[] }
export type SequenceDiagram = {
	kind: 'sequence'
	title: string
	label: Label
	participants: Participant[]
	messages: Message[]
}
export type EntityDiagram = {
	kind: 'entity-relationship'
	title: string
	label: Label
	entities: Entity[]
	relations: Relation[]
}
export type Diagram = ComponentDiagram | SequenceDiagram | EntityDiagram

// A diagram as a writer sends it, before the check: every list is present, and only the two lists of its kind may hold
// anything. Names in from and to are matched to the nodes without regard to case. An edge with no label takes the
// diagram's.
type EdgeDraft = { from: string; to: string; text: string; label: string | undefined; quotes: Quote[] }
export type DiagramDraft = {
	kind: DiagramKind
	title: string
	label: string
	boxes: { name: string; group: string | undefined; quotes: Quote[] }[]
	arrows: EdgeDraft[]
	participants: { name: string; quotes: Quote[] }[]
	messages: EdgeDraft[]
	entities: { name: string; fields: Field[]; quotes: Quote[] }[]
	relations: (EdgeDraft & { cardinality: Cardinality })[]
}
