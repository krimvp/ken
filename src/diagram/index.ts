// Diagrams as checked data, and their Mermaid text. A model sends boxes and arrows, never diagram syntax, and
// checkDiagram turns each into a diagram whose every arrow, message and relation rests on a quote that passed
// checkQuote. mermaidText writes the drawing and diagramElements the numbered list that goes under it, and drawn adds
// both to a diagram on its way to a reader. No model here.
export { checkDiagram, DIAGRAM_BOUNDS, type DiagramCheck, diagramDraft } from './check-diagram.ts'
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
export { type DrawnDiagram, drawn } from './drawn.ts'
export { mermaidText } from './mermaid-text.ts'
