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
type Content = { kind: string; tour?: Found; story?: Found; walk?: Found }
type Picture = { kind: 'parts' } | { kind: 'drawn'; id: string; title: string | null; asked: string }
type Replies = Map<string, object>
const {
	contentOf,
	picturesOf,
}: {
	contentOf: (look: object, rows: object[], replies?: Replies, shown?: string | null) => Content
	picturesOf: (look: object, rows: object[], replies?: Replies) => Picture[]
} = await import(path.join(HOME, 'content.js'))
const { inspectorHtml }: { inspectorHtml: (home: object, env: object) => string } = await import(
	path.join(HOME, 'inspector.js')
)
const { canvasHtml }: { canvasHtml: (home: object, rows: object[]) => string } = await import(
	path.join(HOME, 'canvas.js')
)
const { freshHome }: { freshHome: (stored: () => null, ui: object) => object } = await import(
	path.join(HOME, 'home-actions.js')
)

// A command that runs the core, a core that saves to a store, and a test of the core. The second commit touches only
// the store, and the last one, the change the reader reviews, makes the core wait and the store keep.
const START = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\tsave()\n}\n",
	'src/store/db.ts': 'export function save() {}\n',
	'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
}
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: START },
	{
		message: 'docs: say what the store is for',
		files: { 'src/store/db.ts': '// Saves.\nexport function save() {}\n' },
	},
	{
		message: 'feat: the core waits before it saves',
		files: {
			'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\twait()\n\tsave()\n}\n",
			'src/store/db.ts': '// Saves.\nexport function save() {\n\tkeep()\n}\n',
		},
	},
])
const [first = '', docs = '', head = ''] = hashes
const REVIEWED = `${docs}..${head}`

const quote = (file: string, text: string) => ({ path: file, commit: 'HEAD', text })
const part = (name: string, job: string, folder: string) => ({ name, job, paths: [folder] })
const record = fileRecordStore(root, gitRepository(root))
type Arrow = { from: string; to: string; text: string; quotes: ReturnType<typeof quote>[] }
async function draw(parts: ReturnType<typeof part>[], arrows: Arrow[]) {
	const before = (await record.read()).current.findLast((entry) => entry.kind === 'layout')
	const drawn = await record.append([{ kind: 'layout', within: [], at: 'HEAD', parts, arrows, replaces: before?.id }])
	if (drawn.kind !== 'appended') assert.fail(drawn.problems.join(' '))
}
// The parts as ken's model named them, the test part first, so no order below can come from the level's own.
await draw(
	[
		part('Tests', 'Tests the core', 'test'),
		part('Store', 'Saves what the core makes', 'src/store'),
		part('Core', 'Runs the work', 'src/core'),
		part('Command', 'The command a person types', 'src/cli'),
	],
	[
		{
			from: 'Tests',
			to: 'Core',
			text: 'tests',
			quotes: [quote('test/run.test.ts', "import { run } from '../src/core/run.ts'")],
		},
		{
			from: 'Core',
			to: 'Store',
			text: 'saves to',
			quotes: [quote('src/core/run.ts', "import { save } from '../store/db.ts'")],
		},
		{
			from: 'Command',
			to: 'Core',
			text: 'runs',
			quotes: [quote('src/cli/main.ts', "import { run } from '../core/run.ts'")],
		},
	],
)

const claim = (file: string, line: string) => ({
	text: `${file} holds it.`,
	label: 'inferred',
	quotes: [quote(file, line)],
})
const step = (number: number, text: string, file: string, line: string): Turn => ({
	tool: 'ken__show',
	args: { step: { number, text }, claims: [claim(file, line)] },
})
// One script for three runs: the tour of the whole project, the story of the reviewed change, and its walkthrough.
const model = await scriptedModel([
	step(1, 'The store saves it.', 'src/store/db.ts', 'export function save() {'),
	step(2, 'The core runs the work.', 'src/core/run.ts', 'export function run() {'),
	step(3, 'The command starts everything.', 'src/cli/main.ts', 'run()'),
	step(4, 'The tests run the core.', 'test/run.test.ts', 'run()'),
	{ text: 'That is the whole project.' },
	{
		tool: 'ken__show',
		text: 'The core now waits before it saves.',
		args: { claims: [claim('src/core/run.ts', '\twait()')] },
	},
	{ text: '' },
	step(1, 'The core waits first.', 'src/core/run.ts', '\twait()'),
	step(2, 'The store keeps what it saved.', 'src/store/db.ts', '\tkeep()'),
	{ text: '' },
])
const server = await openKen(root, readerHome(), model.baseUrl)
// The three runs as the home sends them.
await ask(server, { lens: { kind: 'tour', within: [], name: null } })
await ask(server, { lens: { kind: 'change', change: REVIEWED, want: 'story' } })
await ask(server, { lens: { kind: 'change', change: REVIEWED, want: 'walk' } })
const rows: { id: string }[] = (await json(server, '/api/questions')).questions
const [tourRow, storyRow, walkRow] = rows

const lookAt = async (query: string) =>
	(await json(server, `/api/layout?${query}`)) as { look: object; changes: object[] }

// A saved question as the page holds it once read.
async function saved(id: string) {
	const view = await json(server, `/api/questions/${id}`)
	return { ...view.entry, topics: view.topics }
}

// The home on one level, with every reply its content names already read.
async function homeOn(query: string, detail: string, selected: object | null) {
	const { look, changes } = await lookAt(query)
	const replies = new Map<string, object>()
	for (const row of rows) replies.set(row.id, await saved(row.id))
	const ui = {
		panel: { kind: 'checks' },
		openQuotes: new Set(),
		openDecisions: new Set(),
		unfolded: new Set(),
		wide: false,
	}
	return { ...freshHome(() => null, ui), look, changes, detail, selected, content: contentOf(look, rows, replies) }
}

const ENV = { off: null, running: null, seconds: 0, model: { kind: 'ok', name: 'scripted' }, rows, asked: true }
// The stop or step that is open in the reading path.
const open = (html: string) =>
	html.match(/<li class="path-step is-on"[\s\S]*?<\/li>\s*(?=<li class="path-step|<\/ol>)/)?.[0] ?? ''

test('the home shows the stored tour of the level on screen and the stored story and walkthrough of the change laid over it, and none that is about another level or another change', async () => {
	const whole = contentOf((await lookAt('change=none')).look, rows)
	assert.deepEqual([whole.kind, whole.tour?.id], ['level', tourRow?.id])

	const inside = contentOf((await lookAt('change=none&within=src/core')).look, rows)
	assert.equal(inside.kind, 'folders', 'nobody named the parts inside the core, so it has no tour')

	const reviewed = contentOf((await lookAt(`change=${REVIEWED}`)).look, rows)
	assert.deepEqual(
		[reviewed.kind, reviewed.story?.id, reviewed.walk?.id],
		['change', storyRow?.id, walkRow?.id],
		'the reply with no steps is the story, and the one with steps the walkthrough',
	)

	const earlier = contentOf((await lookAt(`change=${first}..${docs}`)).look, rows)
	assert.deepEqual([earlier.story, earlier.walk], [null, null], 'ken explained the last commit, not the one before')
})

test('for a toured level the inspector offers the stored tour at the big picture, opens the picked stop with its words at "How it works", and shows that stop\'s quoted lines at "In the code"', async () => {
	const big = inspectorHtml(await homeOn('change=none', 'big', null), ENV)
	assert.match(big, /data-act="home-tour"/, 'the stored tour starts with no run')
	assert.doesNotMatch(big, /data-act="run-tour"/)

	const picked = { kind: 'part', name: 'Core' }
	const how = await homeOn('change=none', 'how', picked)
	const stop = open(inspectorHtml(how, ENV))
	assert.match(stop, /class="path-n">2</, 'the core is the second stop: the tour starts at the store, which it uses')
	assert.match(stop, /The core runs the work\./)
	assert.doesNotMatch(stop, /The store saves it\./)
	assert.equal(stop.match(/data-act="home-arrow"/g)?.length, 3, 'three arrows start or end at the core')
	assert.match(stop, /data-act="home-know"/)
	assert.match(inspectorHtml(how, ENV), /data-key="home-nav-Next, stop 3"[\s\S]*?nav-name">Command</)
	assert.match(
		canvasHtml(how, rows),
		/aria-pressed="true"><span class="home-badge">Stop 2<\/span>\s*<span class="pv-name">Core</,
	)

	const code = open(inspectorHtml(await homeOn('change=none', 'code', picked), ENV))
	assert.match(code, /src\/core\/run\.ts/)
	assert.match(code, /export function run\(\) \{/, "the stop's quoted line shows as code")
	assert.doesNotMatch(code, /export function save\(\) \{/, "another stop's quote stays with its stop")
})

test('for a walked change the inspector tells its story at the big picture, opens the picked step with its files at "How it works", and shows that step\'s diff at "In the code"', async () => {
	const big = inspectorHtml(await homeOn(`change=${REVIEWED}`, 'big', null), ENV)
	assert.match(big, /The core now waits before it saves\./)
	assert.doesNotMatch(big, /data-act="run-story"/, 'a stored story needs no run')
	assert.match(big, /data-chip="risks"/)

	const picked = { kind: 'step', number: 2 }
	const whole = inspectorHtml(await homeOn(`change=${REVIEWED}`, 'how', picked), ENV)
	assert.ok(
		whole.indexOf('The core now waits before it saves.') < whole.indexOf('class="path"'),
		'the story opens the reading path',
	)
	const how = open(whole)
	assert.match(how, /The store keeps what it saved\./)
	assert.match(
		how,
		/<code>src\/store\/db\.ts<\/code> <span class="home-plus">\+3<\/span> <span class="home-minus">-1<\/span>/,
	)
	assert.doesNotMatch(how, /src\/core\/run\.ts/, "the other step's file is not in this step")
	assert.match(how, /data-detail="code"/)

	const code = open(inspectorHtml(await homeOn(`change=${REVIEWED}`, 'code', picked), ENV))
	assert.match(code, /<span class="lc add">.*keep\(\)/)
	assert.doesNotMatch(code, /wait\(\)/, "the other step's diff stays with its step")
})

test('a level ken drew again has no tour until ken gives one for its new parts', async () => {
	await draw([part('Code', 'All the code', 'src'), part('Tests', 'Tests the core', 'test')], [])
	const redrawn = contentOf((await lookAt('change=none')).look, rows)
	assert.deepEqual([redrawn.kind, redrawn.tour], ['level', null])
})

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

// Four requests to see a level another way: two diagrams of the whole project, then inside src the parts drawn again
// and one diagram.
async function drawnPictures() {
	const again = {
		within: ['src'],
		about: 'The code a person runs.',
		parts: [part('Front', 'Takes the command and runs it', 'src/cli'), part('Rest', 'Runs and saves', 'src/core')],
	}
	const drawer = await scriptedModel([
		...drawing('One command through the code', 'The command runs the core.'),
		...drawing('The same command, once more', 'The same flow again.'),
		{ tool: 'ken__show', text: 'Two parts now.', args: { layout: again } },
		{ text: '' },
		...drawing('Inside src', 'Only the code in src.'),
	])
	const desk = await openKen(root, readerHome(), drawer.baseUrl)
	await ask(desk, view('Follow one command', []))
	await ask(desk, view('Follow it again', []))
	await ask(desk, view('Fewer parts', ['src']))
	await ask(desk, view('Follow it inside src', ['src']))
	const asked: { id: string }[] = (await json(desk, '/api/questions')).questions
	const replies: Replies = new Map()
	for (const row of asked) {
		const read = await json(desk, `/api/questions/${row.id}`)
		replies.set(row.id, { ...read.entry, topics: read.topics })
	}
	const look = async (query: string) => (await json(desk, `/api/layout?${query}`)).look as object
	return { asked, replies, whole: await look('change=none'), src: await look('change=none&within=src') }
}
const drawn = await drawnPictures()

test("a level's pictures are its parts and then, newest first, each diagram ken drew because the reader asked to see that level another way", () => {
	const { asked, replies, whole, src } = drawn
	const [first, second, , inside] = asked.map((row) => row.id)

	assert.deepEqual(
		picturesOf(whole, asked),
		[
			{ kind: 'parts' },
			{ kind: 'drawn', id: second, title: null, asked: 'Follow it again' },
			{ kind: 'drawn', id: first, title: null, asked: 'Follow one command' },
		],
		'until its reply is read a drawn picture has only the words the reader asked with',
	)
	assert.deepEqual(
		picturesOf(whole, asked, replies).map((picture) => (picture.kind === 'drawn' ? picture.title : null)),
		[null, 'The same command, once more', 'One command through the code'],
	)
	assert.deepEqual(
		picturesOf(src, asked, replies),
		[{ kind: 'parts' }, { kind: 'drawn', id: inside, title: 'Inside src', asked: 'Follow it inside src' }],
		'the request that drew the parts of src again is not a picture of its own, and neither is a diagram of the whole project',
	)

	assert.equal(contentOf(whole, asked, replies, first).kind, 'drawn')
	assert.equal(
		contentOf(src, asked, replies, first).kind,
		'level',
		'inside src the parts show, not a picture of the whole project',
	)
})

test('a drawn picture shows its drawing on the canvas under its own tab, and the inspector tells it by the detail: the words of ken, the picked arrow, then the line that arrow quotes', () => {
	const { asked, replies, whole } = drawn
	const first = asked[0]?.id ?? ''
	const ui = { panel: { kind: 'checks' }, openQuotes: new Set(), openDecisions: new Set(), unfolded: new Set() }
	const home = (detail: string, selected: object | null) => ({
		...freshHome(() => null, ui),
		look: whole,
		detail,
		selected,
		pictures: picturesOf(whole, asked, replies),
		shown: first,
		content: contentOf(whole, asked, replies, first),
	})

	const canvas = canvasHtml(home('big', null), asked)
	assert.match(canvas, new RegExp(`data-id="${first}"[^>]*aria-pressed="true"`), 'its tab is the pressed one')
	assert.match(canvas, /data-mermaid="sequenceDiagram/)
	assert.doesNotMatch(canvas, /class="pv-box/, 'the parts give their place to the drawing')

	const big = inspectorHtml(home('big', null), ENV)
	assert.match(big, /The command runs the core\./)
	assert.doesNotMatch(big, /data-mermaid/, 'the drawing is on the canvas, so the inspector does not draw it again')

	// ken numbers the two participants 1 and 2, so the second message is number 4.
	const picked = { kind: 'element', number: 4 }
	const how = open(inspectorHtml(home('how', picked), ENV))
	assert.match(how, /class="path-n">4</)
	assert.match(how, /From Core to Command: returns once it saved/)
	assert.match(how, /src\/core\/run\.ts/, 'it says where the line it quotes is')
	assert.doesNotMatch(how, /class="code"/, 'the line itself waits for "In the code"')

	const code = open(inspectorHtml(home('code', picked), ENV))
	assert.match(code, /class="code"[\s\S]*save\(\)/)
	assert.doesNotMatch(code, /runs the work/, "the other arrow's row is not in this one")
})
