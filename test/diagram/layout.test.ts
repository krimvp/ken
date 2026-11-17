import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkLayout, type LayoutDraft } from '../../src/diagram/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const { root } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/server/serve.ts':
				"import { answer } from '../agent/answer.ts'\nexport const port = 80\nexport const restored = 1\n// the answers come from\n// ../agent/answer.ts\n",
			'src/agent/answer.ts': "import { save } from '../store/save.ts'\nexport function answer() {}\n",
			'src/store/save.ts': 'export function save() {}\n',
			'README.md': '# demo\n',
		},
	},
])
const repo = gitRepository(root)
const IMPORT = { path: 'src/server/serve.ts', commit: 'HEAD', text: "import { answer } from '../agent/answer.ts'" }

function draft(change: Partial<LayoutDraft> = {}): LayoutDraft {
	return {
		within: ['src'],
		at: undefined,
		parts: [
			{ name: 'Server', job: 'serves the page', paths: ['src/server'] },
			{ name: 'Chat engine', job: 'answers questions', paths: ['src/agent'] },
			{ name: 'Store', job: 'keeps what ken learned', paths: ['src/store'] },
		],
		arrows: [{ from: 'Server', to: 'Chat engine', text: 'asks', quotes: [IMPORT] }],
		...change,
	}
}

const base = draft()
const [server, agent] = base.parts
const arrow = base.arrows[0]
if (!server || !agent || !arrow) throw new Error('the draft has its parts and its arrow')

test('a layout whose arrow quotes an import line in its from part naming its to part is accepted, with git ids for its paths', async () => {
	const checked = await checkLayout(repo, base, 'The layout')
	assert.ok(checked.kind === 'ok', JSON.stringify(checked))
	assert.deepEqual(
		checked.layout.parts.map((part) => [part.name, part.places.map((place) => place.path)]),
		[
			['Server', ['src/server']],
			['Chat engine', ['src/agent']],
			['Store', ['src/store']],
		],
	)
	assert.ok(checked.layout.parts.every((part) => part.places.every((place) => /^[0-9a-f]{40}$/.test(place.id))))
	assert.deepEqual(
		checked.layout.arrows.map((each) => [each.from, each.text, each.to, each.quotes[0]?.startLine]),
		[['Server', 'asks', 'Chat engine', 1]],
	)
})

test('each broken rule refuses the layout and names the problem', async () => {
	const cases: [string, LayoutDraft, RegExp][] = [
		[
			'a path with no file',
			draft({ parts: [server, { ...agent, paths: ['src/nothing'] }] }),
			/src\/nothing holds no file/,
		],
		[
			'a path outside the scope',
			draft({ parts: [server, { ...agent, paths: ['README.md'] }], arrows: [] }),
			/README\.md is outside src/,
		],
		[
			'two parts sharing a file',
			draft({ parts: [server, { ...agent, paths: ['src/agent', 'src/server/serve.ts'] }] }),
			/share src\/server/,
		],
		['one part', draft({ parts: [server], arrows: [] }), /1 parts\. Name 2 to 6/],
		[
			'seven parts',
			draft({
				parts: Array.from({ length: 7 }, (_, n) => ({ name: `P${n}`, job: 'j', paths: ['src/agent'] })),
				arrows: [],
			}),
			/7 parts/,
		],
		['nine arrows', draft({ arrows: Array.from({ length: 9 }, () => arrow) }), /9 arrows\. Keep it to 8/],
		['an arrow to no part', draft({ arrows: [{ ...arrow, to: 'Nowhere' }] }), /ends at "Nowhere", which is no part/],
		['an arrow to itself', draft({ arrows: [{ ...arrow, to: 'Server' }] }), /from a part to itself/],
		['an arrow without a quote', draft({ arrows: [{ ...arrow, quotes: [] }] }), /has no quote/],
		[
			'a quote git does not have',
			draft({ arrows: [{ ...arrow, quotes: [{ ...IMPORT, text: "import { ask } from '../agent/ask.ts'" }] }] }),
			/quote 1:/,
		],
		[
			'a quote outside the from part',
			draft({ arrows: [{ ...arrow, from: 'Store', to: 'Chat engine' }] }),
			/src\/server\/serve\.ts, which is not in Store/,
		],
		[
			'a quote that does not name the to part',
			draft({ arrows: [{ ...arrow, to: 'Store' }] }),
			/names no folder or file of Store \(store\)/,
		],
		[
			'a quote whose lines are all comments',
			draft({
				arrows: [{ ...arrow, quotes: [{ ...IMPORT, text: '// the answers come from\n// ../agent/answer.ts' }] }],
			}),
			/holds only comments/,
		],
		[
			'a quote that holds the name only inside a longer word',
			draft({
				arrows: [{ ...arrow, to: 'Store', quotes: [{ ...IMPORT, text: 'export const restored = 1' }] }],
			}),
			/names no folder or file of Store/,
		],
	]
	for (const [what, each, problem] of cases) {
		const checked = await checkLayout(repo, each, 'The layout')
		assert.ok(checked.kind === 'refused', `${what} is refused`)
		assert.match(checked.problems.join('\n'), problem, what)
	}
})
