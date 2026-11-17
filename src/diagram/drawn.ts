import type { Diagram } from './diagram.ts'
import { type DiagramElement, diagramElements } from './diagram-elements.ts'
import { mermaidText } from './mermaid-text.ts'

// A diagram as it leaves ken for a reader: the checked data, the Mermaid text that draws it, and its numbered elements
// for the list under the drawing. Both are made here from the data each time, so a reply is stored without them.
export type DrawnDiagram = Diagram & { mermaid: string; elements: DiagramElement[] }

export function drawn(diagram: Diagram): DrawnDiagram {
	return { ...diagram, mermaid: mermaidText(diagram), elements: diagramElements(diagram) }
}
