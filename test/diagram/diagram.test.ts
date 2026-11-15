import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDiagrams, type DiagramDraft, mermaidText } from '../../src/diagram/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const { root } = buildRepository([
	{
		message: 'feat: start',
		files: { 'src/app.ts': "import { save } from './store.ts'\nexport function run() {\n\tsave('done')\n}\n" },
	},
])
const repo = gitRepository(root)
const CALL = { path: 'src/app.ts', commit: 'HEAD', text: "\tsave('done')" }
const EMPTY = { boxes: [], arrows: [], participants: [], messages: [], entities: [], relations: [] }

function component(boxes: string[], arrows: { from: string; to: string; quotes?: (typeof CALL)[] }[]): DiagramDraft {
	return {
		...EMPTY,
		kind: 'component',
		title: 'How app saves',
		label: 'inferred',
		boxes: boxes.map((name) => ({ name, group: undefined, quotes: [] })),
		arrows: arrows.map(({ from, to, quotes = [CALL] }) => ({ from, to, text: 'calls', label: undefined, quotes })),
	}
}

async function refusal(draft: DiagramDraft): Promise<string> {
	const checked = await checkDiagrams(repo, [draft])
	return checked.kind === 'refused' ? checked.problems.join('\n') : assert.fail('the diagram was accepted')
}

test('a diagram within the rules is accepted and numbered; one over the bounds, with an unknown box, without a quote or with a later label is refused with the reason', async () => {
	const accepted = await checkDiagrams(repo, [component(['app', 'store'], [{ from: 'APP', to: 'store' }])])
	assert.ok(accepted.kind === 'ok', JSON.stringify(accepted))
	const [diagram] = accepted.diagrams
	assert.ok(diagram?.kind === 'component')
	assert.deepEqual(
		[...diagram.boxes, ...diagram.arrows].map((element) => element.number),
		[1, 2, 3],
	)
	assert.deepEqual(diagram.arrows[0]?.from, 'app', 'an arrow names the box as the box spells it')
	assert.deepEqual(diagram.arrows[0]?.quotes[0]?.startLine, 3)

	const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
	assert.match(await refusal(component(seven, [{ from: 'a', to: 'b' }])), /7 boxes; keep it to 6/)
	const nineArrows = Array.from({ length: 9 }, () => ({ from: 'app', to: 'store' }))
	assert.match(await refusal(component(['app', 'store'], nineArrows)), /9 arrows; keep it to 8/)
	assert.match(await refusal(component(['app', 'store'], [{ from: 'app', to: 'disk' }])), /arrow 1 .*"disk"/)
	assert.match(
		await refusal(component(['app', 'store'], [{ from: 'app', to: 'store', quotes: [] }])),
		/arrow 1 .*quote/,
	)
	const recorded = component(['app', 'store'], [{ from: 'app', to: 'store' }])
	const [arrow] = recorded.arrows
	assert.ok(arrow)
	assert.match(await refusal({ ...recorded, arrows: [{ ...arrow, label: 'recorded' }] }), /arrow 1 .*"recorded"/)
})

// Names a model could send to break Mermaid: quotes and brackets end a label, a semicolon or a line break ends a
// statement, %% starts a directive, click binds a script, and HTML could reach the page.
const HOSTILE = [
	'He said "hi"',
	'a]b[c',
	'semi; colon',
	'%%{init: {"theme":"dark"}}%%',
	'two\nlines\nclick n1 call alert(1)',
	'<img src=x onerror=alert(1)>',
	'`md` |pipe| {curly} #59;',
]
const SAFE_LABEL = /^(?:[\p{L}\p{N} ._-]|#\d+;)*$/u

function decoded(label: string): string {
	return label.replaceAll(/#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

function hostile(kind: DiagramDraft['kind']): DiagramDraft {
	const nodes = HOSTILE.slice(0, 4).map((name) => ({ name, quotes: [] }))
	const edges = HOSTILE.map((text, index) => ({
		from: HOSTILE[index % 4] ?? '',
		to: HOSTILE[(index + 1) % 4] ?? '',
		text,
		label: undefined,
		quotes: [CALL],
	}))
	const base = { ...EMPTY, kind, title: 'hostile', label: 'inferred' }
	if (kind === 'component') {
		return { ...base, boxes: nodes.map((node) => ({ ...node, group: HOSTILE[4] })), arrows: edges }
	}
	if (kind === 'sequence') return { ...base, participants: nodes, messages: edges }
	const fields = [
		{ name: 'PK', type: 'string[]' },
		{ name: 'a "b" }', type: 'Map<a, b>' },
	]
	const relations = edges.map((edge) => ({ ...edge, cardinality: 'one-to-many' as const }))
	return { ...base, entities: nodes.map((node) => ({ ...node, fields })), relations }
}

// Each line of the text must be one of the shapes listed for its kind. A shape names its label group "label" and its
// element number "number".
const SHAPES: Record<DiagramDraft['kind'], RegExp[]> = {
	component: [
		/^flowchart LR$/,
		/^ {2,4}n(?<number>\d+)\["(?<label>[^"]*)"\]$/,
		/^ {2}n\d+ -->\|"(?<label>[^"]*)"\| n\d+$/,
		/^ {2}subgraph g\d+\["(?<group>[^"]*)"\]$/,
		/^ {2}end$/,
	],
	sequence: [
		/^sequenceDiagram$/,
		/^ {2}participant n(?<number>\d+) as (?<label>.*)$/,
		/^ {2}n\d+->>n\d+: (?<label>.*)$/,
	],
	'entity-relationship': [
		/^erDiagram$/,
		/^ {2}n(?<number>\d+)\["(?<label>[^"]*)"\]( \{)?$/,
		/^ {4}[A-Za-z_][A-Za-z0-9_[\]]* (?!(?:PK|FK|UK)$)[A-Za-z_][A-Za-z0-9_]*$/,
		/^ {2}\}$/,
		/^ {2}n\d+ \|\|--o\{ n\d+ : "(?<label>[^"]*)"$/,
	],
}

test('the Mermaid text of each kind has one line per element with its number, and no name can end a label or start a directive', async () => {
	for (const kind of ['component', 'sequence', 'entity-relationship'] as const) {
		const checked = await checkDiagrams(repo, [hostile(kind)])
		assert.ok(checked.kind === 'ok', JSON.stringify(checked))
		const [diagram] = checked.diagrams
		assert.ok(diagram)
		const text = mermaidText(diagram)

		const labels: string[] = []
		for (const line of text.split('\n')) {
			const match = SHAPES[kind].map((shape) => line.match(shape)).find((found) => found !== null)
			assert.ok(match, `${kind}: every line has a promised shape: ${JSON.stringify(line)}`)
			for (const part of [match.groups?.label, match.groups?.group]) {
				if (part === undefined) continue
				assert.match(part, SAFE_LABEL, `${kind}: a label holds only safe characters and entity codes: ${line}`)
				labels.push(decoded(part))
			}
		}
		const collapsed = HOSTILE.map((name) => name.replaceAll(/\s+/g, ' '))
		const expected = [
			...collapsed.slice(0, 4).map((name, index) => `${index + 1}. ${name}`),
			...collapsed.map((name, index) => `${index + 5}. ${name}`),
		]
		const numbered = labels.filter((label) => /^\d+\. /.test(label))
		assert.deepEqual(numbered.sort(), expected.sort(), `${kind}: one label per element, with its number`)
	}
})
