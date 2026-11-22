// Diagrams as checked data, and their Mermaid text. A model sends boxes and arrows, never diagram syntax, and
// checkDiagram turns each into a diagram whose every arrow, message and relation rests on a quote that passed
// checkQuote. mermaidText writes the drawing and diagramElements the numbered list that goes under it, and drawn adds
// both to a diagram on its way to a reader. checkLayout does the same for a level of the project's layout, whose
// arrows rest on lines that name the part they point to, and checkViews for the drawings of where the top level runs and
// what it talks to, with what deployFacts reads from compose files and manifests. No model here.

export { checkDiagram, DIAGRAM_BOUNDS, type DiagramCheck, diagramDraft } from './check-diagram.ts'
export {
	checkLayout,
	LAYOUT_BOUNDS,
	type Layout,
	type LayoutCheck,
	type LayoutDraft,
	layoutDraft,
	onlyComments,
	type Part,
	type PartArrow,
	type Place,
} from './check-layout.ts'
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
export {
	type CrossingDraft,
	checkViews,
	type FrameDraft,
	type OutsideDraft,
	type SentBack,
	type ThingDraft,
	type ViewsCheck,
	type ViewsDraft,
	viewsDraft,
	type WorldCrossingDraft,
} from './views/check-views.ts'
export { type DeployFacts, deployFacts, type Workload } from './views/deploy-files.ts'
export {
	CROSSING_KINDS,
	type Crossing,
	DIRECTIONS,
	FRAME_KINDS,
	type Frame,
	type Gap,
	HOWS,
	type How,
	OUTSIDE_KINDS,
	type Outside,
	type Runtime,
	STORE_KINDS,
	THING_KINDS,
	type Thing,
	VIEWS_BOUNDS,
	type Views,
	type World,
	type WorldCrossing,
} from './views/views.ts'
