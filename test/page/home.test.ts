import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const HOME = path.join(import.meta.dirname, '../../src/page/home')
type Found = { id: string; q: object | null } | null
type Content = { kind: string; tour?: Found; story?: Found; walk?: Found }
type Replies = Map<string, object>
const {
	contentOf,
}: {
	contentOf: (look: object, rows: object[], replies?: Replies, shown?: string | null) => Content
} = await import(path.join(HOME, '../level/content.js'))
type Place = { name: string; within: string[] }
type Home = {
	wayIn: string
	opened: boolean
	detail: string
	trail: Place[]
	change: string
	selected: object | null
	look: { change: { range: { head: string } } | null; boxes: { name: string }[] } | null
	reading: string | null
	problem: { message: string } | null
	ended: { kind: string; level?: string } | null
}
const { freshHome }: { freshHome: (stored: () => null, ui: object) => Home } = await import(
	path.join(HOME, '../level/level-state.js')
)
type Answer = { ok: boolean; body: object }
type Loads = {
	loadLayout: (again?: boolean) => Promise<boolean>
	loadDiff: () => Promise<void>
	refresh: () => Promise<void>
}
const { homeLoads }: { homeLoads: (app: object) => Loads } = await import(path.join(HOME, '../level/loads.js'))
const {
	homeRuns,
}: {
	homeRuns: (app: object, loads: Loads, stepTo: () => void) => { ended: (started: object, q: object) => Promise<void> }
} = await import(path.join(HOME, '../level/runs.js'))

// A command that runs the core, a core that saves to a store, and a test of the core. The second commit touches only
// the store, and the last one, the change the reader reviews, makes the core wait and the store keep, and says so in a
// README that sits in no part.
const START = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\tsave()\n}\n",
	'src/store/db.ts': 'export function save() {}\n',
	'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
	'README.md': '# demo\n',
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
			'README.md': '# demo\nIt waits.\n',
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
	{
		tool: 'ken__show',
		text: 'The core now waits before it saves.',
		args: { claims: [claim('src/core/run.ts', '\twait()')] },
	},
	{ text: '' },
	step(1, 'The core waits first.', 'src/core/run.ts', '\twait()'),
	step(2, 'The store keeps what it saved.', 'src/store/db.ts', '\tkeep()'),
	step(3, 'The README says so.', 'README.md', 'It waits.'),
	{ text: '' },
])
const server = await openKen(root, readerHome(), model.baseUrl)
// The three runs as the home sends them.
await ask(server, { lens: { kind: 'explain', within: [], name: null, part: null } })
await ask(server, { lens: { kind: 'change', change: REVIEWED, want: 'story' } })
await ask(server, { lens: { kind: 'change', change: REVIEWED, want: 'walk' } })
const rows: { id: string }[] = (await json(server, '/api/questions')).questions
const [tourRow, storyRow, walkRow] = rows

const lookAt = async (query: string) =>
	(await json(server, `/api/layout?${query}`)) as { look: object; changes: object[]; levels: object[] }

// A saved question as the page holds it once read.
async function saved(id: string) {
	const view = await json(server, `/api/questions/${id}`)
	return { ...view.entry, topics: view.topics }
}

test('the home shows the stored tour of the level on screen and the stored story and walkthrough of the change laid over it, and none that is about another level, another change, or another question about the same change', async () => {
	const whole = contentOf((await lookAt('change=none')).look, rows)
	assert.deepEqual([whole.kind, whole.tour?.id], ['level', tourRow?.id])

	const inside = contentOf((await lookAt('change=none&within=src/core')).look, rows)
	assert.equal(inside.kind, 'folders', 'nobody named the parts inside the core, so it has no tour')

	const { look } = await lookAt(`change=${REVIEWED}`)
	const reviewed = contentOf(look, rows)
	assert.deepEqual([reviewed.kind, reviewed.story?.id, reviewed.walk?.id], ['change', storyRow?.id, walkRow?.id])

	// A later question about the same change that asked for neither, as "what could go wrong" does.
	const later = { ...storyRow, id: 'a later question', want: null }
	assert.equal(
		contentOf(look, [...rows, later]).story?.id,
		storyRow?.id,
		'the story is the reply that was asked for it',
	)

	const earlier = contentOf((await lookAt(`change=${first}..${docs}`)).look, rows)
	assert.deepEqual([earlier.story, earlier.walk], [null, null], 'ken explained the last commit, not the one before')
})

// The page asks the server through one function, which says whether the answer is ok.
const fromServer = async (url: string) => {
	const { status, text } = await call(server, url)
	return { ok: status === 200, body: JSON.parse(text) }
}

// The page's own state around the home, with the server asked the way the page asks it.
function pageOn(read: (url: string) => Promise<Answer>) {
	const state = { home: freshHome(() => null, {}), rows }
	const app = {
		state,
		render() {},
		read,
		send() {},
		fromView: (view: { entry: object }) => view.entry,
		stored: () => null,
	}
	const loads = homeLoads(app)
	return { home: state.home, loads, runs: homeRuns(app, loads, () => {}) }
}

test('a level the server answers late does not replace the one the reader asked for after it', async () => {
	const answers = { none: await lookAt('change=none'), reviewed: await lookAt(`change=${REVIEWED}`) }
	const waiting: { url: string; answer: (answer: Answer) => void }[] = []
	const { home, loads } = pageOn((url) => new Promise((answer) => waiting.push({ url, answer })))

	home.change = 'none'
	const first = loads.loadLayout()
	home.change = REVIEWED
	const second = loads.loadLayout()
	assert.deepEqual(
		waiting.map((each) => new URL(each.url, 'http://ken.invalid').searchParams.get('change')),
		['none', REVIEWED],
		'each request asks for what the reader wanted when they asked',
	)
	waiting[1]?.answer({ ok: true, body: answers.reviewed })
	await second
	waiting[0]?.answer({ ok: true, body: answers.none })
	await first

	assert.equal(home.look?.change?.range.head, head, 'the change the reader asked for last is the one on screen')
	assert.equal(home.reading, null, 'and the home no longer says it is reading')
})

test('a level read again behind the screen stays as it is when the server cannot answer, and a level the reader asked for says why it is gone', async () => {
	let down = false
	const { home, loads } = pageOn(async (url) =>
		down ? { ok: false, body: { message: 'git is busy.' } } : fromServer(url),
	)
	home.change = 'none'
	await loads.refresh()
	down = true

	await loads.loadLayout(true)
	assert.ok(
		home.look?.boxes.some((box) => box.name === 'Store'),
		'the level the reader had is still the one on screen',
	)
	assert.equal(home.reading, null)

	await loads.loadLayout()
	assert.equal(home.problem?.message, 'git is busy.', 'the level the reader asked for says why it is not there')
	assert.equal(home.reading, null, 'and the home no longer says it is reading')
})

test('a run is judged against the level it started on: a reader who looked inside a part meanwhile is told it finished there, and one who stayed sees what it made', async () => {
	const whole = { name: 'Whole project', within: [] }
	const started = { kind: 'explainAll', trail: [whole], change: 'none' }
	const tour = await saved(tourRow?.id ?? '')

	const moved = pageOn(fromServer)
	moved.home.trail = [whole, { name: 'Core', within: ['src/core'] }]
	await moved.loads.refresh()
	await moved.runs.ended(started, tour)
	assert.deepEqual(
		[moved.home.ended?.kind, moved.home.ended?.level],
		['elsewhere', 'the whole project'],
		'the tour was made, so the home says where, and shows no failure',
	)

	const stayed = pageOn(fromServer)
	await stayed.loads.refresh()
	await stayed.runs.ended(started, tour)
	assert.equal(stayed.home.ended, null, 'the reader is where the tour is, so nothing needs saying')

	const stopped = pageOn(fromServer)
	await stopped.loads.refresh()
	await stopped.runs.ended(started, { ...tour, outcome: 'stopped', reply: null })
	assert.equal(stopped.home.ended?.kind, 'nothing', 'a run that made nothing says so')
})
