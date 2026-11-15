// Diagrams as checked data, and their Mermaid text. A model sends boxes and arrows, never diagram syntax, and
// checkDiagrams turns them into diagrams whose every arrow, message and relation rests on a quote that passed
// checkQuote. mermaidText writes the drawing and diagramElements the numbered list that goes under it. No model here.
export { checkDiagrams, DIAGRAM_BOUNDS, type DiagramCheck, diagramDraft } from './check-diagram.ts'
export {
	type Arrow,
	type Box,
	CARDINALITIES,
	type Cardinality,
	type ComponentDiagram,
	DIAGRAM_KINDS,
	type Diagram,
	type DiagramDraft,
	type DiagramKind,
	type Entity,
	type EntityDiagram,
	type Field,
	type Message,
	type Participant,
	type Relation,
	type SequenceDiagram,
} from './diagram.ts'
export { type DiagramElement, diagramElements } from './diagram-elements.ts'
export { mermaidText } from './mermaid-text.ts'
