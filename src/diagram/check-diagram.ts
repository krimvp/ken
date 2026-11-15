// The gate in front of the reader for diagrams. A writer hands in drafts, and this turns them into diagrams or says what
// to fix: each diagram is small, its lists fit its kind, every edge joins two of its nodes, every label is allowed, and
// every quote passes checkQuote. One problem refuses all the diagrams, the same way one bad quote refuses an answer.
import { checkLabel, checkQuote, explainQuote, type Label, type Quote, type VerifiedQuote } from '../checks/index.ts'
import type { Repository } from '../repo/index.ts'
import type { Arrow, Diagram, DiagramDraft, DiagramKind } from './diagram.ts'

// A basic diagram supports an answer, so it stays small enough to read at a glance. More than this is a map of
// everything, and the reader is better served by two diagrams or by prose.
export const DIAGRAM_BOUNDS = {
	diagrams: 3,
	nodes: 8,
	edges: 12,
	fields: 6,
	quotes: 3,
	title: 80,
	name: 40,
	text: 60,
	field: 30,
} as const

// Each kind's two lists, by the names the model sends them under.
const LISTS = {
	component: { node: 'box', nodes: 'boxes', edge: 'arrow', edges: 'arrows' },
	sequence: { node: 'participant', nodes: 'participants', edge: 'message', edges: 'messages' },
	'entity-relationship': { node: 'entity', nodes: 'entities', edge: 'relation', edges: 'relations' },
} as const satisfies Record<
	DiagramKind,
	{ node: string; nodes: keyof DiagramDraft; edge: string; edges: keyof DiagramDraft }
>

export type DiagramCheck = { kind: 'ok'; diagrams: Diagram[] } | { kind: 'refused'; problems: string[] }

export async function checkDiagrams(
	repo: Repository,
	drafts: DiagramDraft[],
	signal?: AbortSignal,
): Promise<DiagramCheck> {
	const problems: string[] = []
	if (drafts.length > DIAGRAM_BOUNDS.diagrams) {
		problems.push(
			`The answer has ${drafts.length} diagrams; send at most ${DIAGRAM_BOUNDS.diagrams}, the ones that answer the question.`,
		)
	}
	const diagrams: Diagram[] = []
	for (const [index, draft] of drafts.entries()) {
		diagrams.push(await checkOne(repo, draft, `Diagram ${index + 1}`, problems, signal))
	}
	return problems.length > 0 ? { kind: 'refused', problems } : { kind: 'ok', diagrams }
}

// The draft that checks back to the same diagram, so the project record can check a stored diagram again.
export function diagramDraft(diagram: Diagram): DiagramDraft {
	const raw = (quotes: VerifiedQuote[]): Quote[] =>
		quotes.map((quote) => ({ path: quote.path, commit: quote.commit, text: quote.text, line: quote.startLine }))
	const node = (each: { name: string; quotes: VerifiedQuote[] }) => ({ name: each.name, quotes: raw(each.quotes) })
	const edge = (each: Arrow) => ({
		from: each.from,
		to: each.to,
		text: each.text,
		label: each.label,
		quotes: raw(each.quotes),
	})
	const empty = { boxes: [], arrows: [], participants: [], messages: [], entities: [], relations: [] }
	const base = { kind: diagram.kind, title: diagram.title, label: diagram.label, ...empty }
	switch (diagram.kind) {
		case 'component':
			return {
				...base,
				boxes: diagram.boxes.map((box) => ({ ...node(box), group: box.group ?? undefined })),
				arrows: diagram.arrows.map(edge),
			}
		case 'sequence':
			return { ...base, participants: diagram.participants.map(node), messages: diagram.messages.map(edge) }
		case 'entity-relationship':
			return {
				...base,
				entities: diagram.entities.map((entity) => ({ ...node(entity), fields: entity.fields })),
				relations: diagram.relations.map((relation) => ({ ...edge(relation), cardinality: relation.cardinality })),
			}
		default:
			return diagram satisfies never
	}
}

async function checkOne(
	repo: Repository,
	draft: DiagramDraft,
	where: string,
	problems: string[],
	signal?: AbortSignal,
): Promise<Diagram> {
	const lists = LISTS[draft.kind]
	const text = (field: string, value: string, max: number) => {
		const trimmed = value.trim()
		if (trimmed === '') problems.push(`${field} is empty.`)
		else if (trimmed.length > max) problems.push(`${field} has ${trimmed.length} characters; keep it under ${max}.`)
		return trimmed
	}
	const label = (field: string, raw: string): Label => {
		const checked = checkLabel(raw)
		if (checked.kind === 'ok') return checked.label
		problems.push(`${field}: ${checked.problem}`)
		return 'inferred'
	}
	const quotes = async (field: string, raw: Quote[], needed: boolean) => {
		if (needed && raw.length === 0) problems.push(`${field} needs at least one quote: the lines that show it.`)
		if (raw.length > DIAGRAM_BOUNDS.quotes) {
			problems.push(`${field} has ${raw.length} quotes; keep it to ${DIAGRAM_BOUNDS.quotes}.`)
		}
		const checks = await Promise.all(raw.map((quote) => checkQuote(repo, quote, signal)))
		return checks.flatMap((check, index): VerifiedQuote[] => {
			if (check.kind === 'verified') return [check.quote]
			const quote = raw[index]
			problems.push(
				`${field}, quote ${index + 1} (${quote?.path} at ${quote?.commit}): ${explainQuote(check, quote?.text ?? '')}`,
			)
			return []
		})
	}

	const title = text(`${where}: the title`, draft.title, DIAGRAM_BOUNDS.title)
	const own = label(`${where}: the label`, draft.label)
	for (const [kind, other] of Object.entries(LISTS)) {
		if (kind === draft.kind) continue
		for (const list of [other.nodes, other.edges]) {
			if (draft[list].length > 0) {
				problems.push(
					`${where} is a ${draft.kind} diagram, so it takes ${lists.nodes} and ${lists.edges}, not ${list}. Send ${list} in a ${kind} diagram.`,
				)
			}
		}
	}
	const nodeCount = draft[lists.nodes].length
	const edgeCount = draft[lists.edges].length
	if (nodeCount === 0) problems.push(`${where} needs at least one ${lists.node}.`)
	if (nodeCount > DIAGRAM_BOUNDS.nodes) {
		problems.push(
			`${where} has ${nodeCount} ${lists.nodes}; keep it to ${DIAGRAM_BOUNDS.nodes}, the ones the question needs.`,
		)
	}
	if (edgeCount === 0) {
		problems.push(`${where} needs at least one ${lists.edge}: a diagram shows how its ${lists.nodes} connect.`)
	}
	if (edgeCount > DIAGRAM_BOUNDS.edges) {
		problems.push(
			`${where} has ${edgeCount} ${lists.edges}; keep it to ${DIAGRAM_BOUNDS.edges}, the ones the question needs.`,
		)
	}

	const names = new Map<string, string>()
	const node = async (draftNode: { name: string; quotes: Quote[] }, index: number) => {
		const field = `${where}, ${lists.node} ${index + 1}`
		const name = text(`${field}: the name`, draftNode.name, DIAGRAM_BOUNDS.name)
		if (names.has(name.toLowerCase())) {
			problems.push(`${field}: the name "${name}" is already a ${lists.node}. Give each its own name.`)
		}
		names.set(name.toLowerCase(), name)
		return { number: index + 1, name, quotes: await quotes(field, draftNode.quotes, false) }
	}
	const end = (field: string, name: string) => {
		const found = names.get(name.trim().toLowerCase())
		if (found === undefined) {
			problems.push(
				`${field} names "${name}", which is not one of its ${lists.nodes}: ${[...names.values()].join(', ')}. Add it as a ${lists.node} or use one of those names.`,
			)
		}
		return found ?? name
	}
	const edge = async (draftEdge: DiagramDraft['arrows'][number], index: number) => {
		const field = `${where}, ${lists.edge} ${index + 1} ("${draftEdge.text}" from ${draftEdge.from} to ${draftEdge.to})`
		return {
			number: nodeCount + index + 1,
			from: end(field, draftEdge.from),
			to: end(field, draftEdge.to),
			text: text(`${field}: the text`, draftEdge.text, DIAGRAM_BOUNDS.text),
			label: draftEdge.label === undefined ? own : label(field, draftEdge.label),
			quotes: await quotes(field, draftEdge.quotes, true),
		}
	}

	switch (draft.kind) {
		case 'component': {
			const boxes = await inOrder(draft.boxes, async (box, index) => {
				const group =
					box.group === undefined ? null : text(`${where}, box ${index + 1}: the group`, box.group, DIAGRAM_BOUNDS.name)
				return { ...(await node(box, index)), group }
			})
			return { kind: 'component', title, label: own, boxes, arrows: await inOrder(draft.arrows, edge) }
		}
		case 'sequence': {
			const participants = await inOrder(draft.participants, node)
			return { kind: 'sequence', title, label: own, participants, messages: await inOrder(draft.messages, edge) }
		}
		case 'entity-relationship': {
			const entities = await inOrder(draft.entities, async (entity, index) => {
				const field = `${where}, entity ${index + 1}`
				if (entity.fields.length > DIAGRAM_BOUNDS.fields) {
					problems.push(
						`${field} has ${entity.fields.length} fields; keep it to ${DIAGRAM_BOUNDS.fields}, the ones that matter.`,
					)
				}
				const fields = entity.fields.map((each, at) => ({
					name: text(`${field}, field ${at + 1}: the name`, each.name, DIAGRAM_BOUNDS.field),
					type: text(`${field}, field ${at + 1}: the type`, each.type, DIAGRAM_BOUNDS.field),
				}))
				return { ...(await node(entity, index)), fields }
			})
			const relations = await inOrder(draft.relations, async (relation, index) => ({
				...(await edge(relation, index)),
				cardinality: relation.cardinality,
			}))
			return { kind: 'entity-relationship', title, label: own, entities, relations }
		}
		default:
			return draft.kind satisfies never
	}
}

// One at a time, because a node's name must be known before the next node or any edge is checked.
async function inOrder<T, R>(items: T[], each: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = []
	for (const [index, item] of items.entries()) results.push(await each(item, index))
	return results
}
