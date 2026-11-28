import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const HOME = path.join(import.meta.dirname, '../../src/page/home')
type Found = { id: string; q: object | null } | null
type Content = { kind: string; tour?: Found }
type Picture = { kind: 'parts' } | { kind: 'drawn'; id: string; title: string | null; asked: string }
type Replies = Map<string, object>
const {
	contentOf,
	picturesOf,
}: {
	contentOf: (look: object, rows: object[], replies?: Replies, shown?: string | null) => Content
	picturesOf: (look: object, rows: object[], replies?: Replies) => Picture[]
} = await import(path.join(HOME, '../level/content.js'))

// A command that runs a core, and a test of the core. Every request below draws this project another way, so the
// project and its record are this file's own.
const { root } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
			'src/core/run.ts': 'export function run() {\n\tsave()\n}\n',
			'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
		},
	},
])
const quote = (file: string, text: string) => ({ path: file, commit: 'HEAD', text })
const part = (name: string, job: string, folder: string) => ({ name, job, paths: [folder] })
const named = await fileRecordStore(root, gitRepository(root)).append(
	[
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			parts: [part('Code', 'Runs the work', 'src'), part('Tests', 'Tests the code', 'test')],
			arrows: [
				{
					from: 'Tests',
					to: 'Code',
					text: 'tests',
					quotes: [quote('test/run.test.ts', "import { run } from '../src/core/run.ts'")],
				},
			],
		},
	],
	'project',
)
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

// What the reader asks on "Show it another way", as the home sends it, and a diagram the model answers with.
const view = (text: string, within: string[]) => ({ lens: { kind: 'view', text, within, name: null } })
const flow = (title: string) => ({
	kind: 'sequence',
	title,
	label: 'inferred',
	participants: [{ name: 'Command' }, { name: 'Core' }],
	messages: [
		{ from: 'Command', to: 'Core', text: 'runs the work', quotes: [quote('src/cli/main.ts', 'run()')] },
		{ from: 'Core', to: 'Command', text: 'returns once it saved', quotes: [quote('src/core/run.ts', '\tsave()')] },
	],
})
const drawing = (title: string, text: string): Turn[] => [
	{ tool: 'ken__show', text, args: { diagrams: [flow(title)] } },
	{ text: '' },
]
const stop = (number: number, text: string, file: string, line: string): Turn => ({
	tool: 'ken__show',
	args: {
		step: { number, text },
		claims: [{ text: `${file} holds it.`, label: 'inferred', quotes: [quote(file, line)] }],
	},
})
const again = {
	within: ['src'],
	about: 'The code a person runs.',
	parts: [part('Front', 'Takes the command and runs it', 'src/cli'), part('Rest', 'Runs and saves', 'src/core')],
}

// A tour of the whole project, then four requests to see a level another way: two diagrams of the whole project, then
// inside src the parts drawn again and one diagram.
const model = await scriptedModel([
	stop(1, 'The code runs the work.', 'src/core/run.ts', 'export function run() {'),
	stop(2, 'The tests run the code.', 'test/run.test.ts', 'run()'),
	...drawing('One command through the code', 'The command runs the core.'),
	...drawing('The same command, once more', 'The same flow again.'),
	{ tool: 'ken__show', text: 'Two parts now.', args: { layout: again } },
	{ text: '' },
	...drawing('Inside src', 'Only the code in src.'),
	// The last request draws the whole project again, under other names.
	{
		tool: 'ken__show',
		text: 'Other names now.',
		args: {
			layout: {
				within: [],
				about: 'A command and its tests.',
				parts: [part('Program', 'Runs the work', 'src'), part('Checks', 'Tests the program', 'test')],
			},
		},
	},
	{ text: '' },
])
const server = await openKen(root, readerHome(), model.baseUrl)
await ask(server, { lens: { kind: 'explain', within: [], name: null, part: null } })
await ask(server, view('Follow one command', []))
await ask(server, view('Follow it again', []))
await ask(server, view('Fewer parts', ['src']))
await ask(server, view('Follow it inside src', ['src']))
const rows: { id: string }[] = (await json(server, '/api/questions')).questions
const replies: Replies = new Map()
for (const row of rows) {
	const read = await json(server, `/api/questions/${row.id}`)
	replies.set(row.id, { ...read.entry, topics: read.topics })
}
const lookAt = async (query: string) => (await json(server, `/api/layout?${query}`)).look as object
const whole = await lookAt('change=none')
const src = await lookAt('change=none&within=src')
const [tour, first, second, , inside] = rows.map((row) => row.id)

test("a level's pictures are its parts and then, newest first, each diagram ken drew because the reader asked to see that level another way", () => {
	assert.deepEqual(
		picturesOf(whole, rows),
		[
			{ kind: 'parts' },
			{ kind: 'drawn', id: second, title: null, asked: 'Follow it again' },
			{ kind: 'drawn', id: first, title: null, asked: 'Follow one command' },
		],
		'until its reply is read a drawn picture has only the words the reader asked with',
	)
	assert.deepEqual(
		picturesOf(whole, rows, replies).map((picture) => (picture.kind === 'drawn' ? picture.title : null)),
		[null, 'The same command, once more', 'One command through the code'],
	)
	assert.deepEqual(
		picturesOf(src, rows, replies),
		[{ kind: 'parts' }, { kind: 'drawn', id: inside, title: 'Inside src', asked: 'Follow it inside src' }],
		'the request that drew the parts of src again is not a picture of its own, and neither is a diagram of the whole project',
	)

	assert.equal(contentOf(whole, rows, replies, first).kind, 'drawn')
	assert.equal(
		contentOf(src, rows, replies, first).kind,
		'level',
		'inside src the parts show, not a picture of the whole project',
	)
})

test('a level ken drew again has no tour until ken gives one for its new parts', async () => {
	assert.deepEqual(
		[contentOf(whole, rows).kind, contentOf(whole, rows).tour?.id],
		['level', tour],
		'the tour of the two parts shows while they are the parts',
	)
	await ask(server, view('Other names', []))
	const redrawn = contentOf(await lookAt('change=none'), (await json(server, '/api/questions')).questions)
	assert.deepEqual([redrawn.kind, redrawn.tour], ['level', null])
})
