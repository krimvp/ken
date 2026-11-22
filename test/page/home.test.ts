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
} = await import(path.join(HOME, 'state/content.js'))
const { inspectorHtml }: { inspectorHtml: (home: object, env: object) => string } = await import(
	path.join(HOME, 'inspector/inspector.js')
)
const { canvasHtml }: { canvasHtml: (home: object, rows: object[]) => string } = await import(
	path.join(HOME, 'canvas/canvas.js')
)
type Place = { name: string; within: string[] }
type Home = {
	wayIn: string
	detail: string
	trail: Place[]
	change: string
	selected: object | null
	look: { change: { range: { head: string } } | null } | null
	reading: string | null
	ended: { kind: string; level?: string } | null
}
const { freshHome }: { freshHome: (stored: () => null, ui: object) => Home } = await import(
	path.join(HOME, 'state/home-state.js')
)
type Answer = { ok: boolean; body: object }
type Loads = { loadLayout: () => Promise<boolean>; loadDiff: () => Promise<void>; refresh: () => Promise<void> }
const { homeLoads }: { homeLoads: (app: object) => Loads } = await import(path.join(HOME, 'state/loads.js'))
const {
	homeRuns,
}: {
	homeRuns: (app: object, loads: Loads, stepTo: () => void) => { ended: (started: object, q: object) => Promise<void> }
} = await import(path.join(HOME, 'state/runs.js'))

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

const ENV = {
	off: null,
	running: null,
	seconds: 0,
	model: { kind: 'ok', name: 'scripted' },
	rows,
	asked: true,
	lenses: { open: false, pick: {} },
}

// What a reader sees of a piece of the page: its words in order, with the markup taken out.
const said = (html: string) =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
const panel = async (query: string, detail: string, selected: object | null) =>
	said(inspectorHtml(await homeOn(query, detail, selected), ENV))

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

test('for a toured level the panel offers the stored tour at the big picture, opens the picked stop with its words and arrows at "How it works", and shows that stop\'s quoted lines at "In the code"', async () => {
	const big = await panel('change=none', 'big', null)
	assert.match(big, /Start the tour/, 'the stored tour starts with no run')
	assert.doesNotMatch(big, /Show me around/, 'so no run is offered')

	const picked = { kind: 'part', name: 'Core' }
	const how = await panel('change=none', 'how', picked)
	assert.match(how, /Stop 2 of 4/, 'the core is the second stop: the tour starts at the store, which it uses')
	assert.match(how, /2 Core The core runs the work\./)
	for (const arrow of ['Tests tests Core', 'Core saves to Store', 'Command runs Core']) {
		assert.match(how, new RegExp(arrow), 'the open stop lists each arrow that starts or ends at the core')
	}
	assert.match(how, /I know this part/)
	assert.match(how, /Back to stop 1 Store/)
	assert.match(how, /Next, stop 3 Command/)
	assert.match(said(canvasHtml(await homeOn('change=none', 'how', picked), rows)), /Stop 2 Core Runs the work/)

	const code = await panel('change=none', 'code', picked)
	assert.match(code, /src\/core\/run\.ts/)
	assert.match(code, /export function run\(\) \{/, "the stop's quoted line shows as code")
	assert.doesNotMatch(code, /export function save\(\) \{/, "another stop's quote stays with its stop")
})

test('for a walked change the panel tells its story at the big picture, opens the picked step with its files at "How it works", and shows that step\'s diff at "In the code"', async () => {
	const big = await panel(`change=${REVIEWED}`, 'big', null)
	assert.match(big, /The core now waits before it saves\./)
	assert.doesNotMatch(big, /Ask ken what this change did/, 'a stored story needs no run')
	assert.match(big, /Ask what could go wrong/)
	assert.match(big, /feat: the core waits before it saves/, 'git names the commit of the change, with no model')

	const picked = { kind: 'step', number: 2 }
	const how = await panel(`change=${REVIEWED}`, 'how', picked)
	assert.match(how, /Step 2 of 2/)
	assert.ok(
		how.indexOf('The core now waits before it saves.') < how.indexOf('The core waits first'),
		'the story opens the reading path',
	)
	assert.match(how, /2 The store keeps what it saved/)
	assert.match(how, /src\/store\/db\.ts lines added: \+3 removed: -1/, 'the open step lists its file with its lines')
	assert.equal(how.match(/lines added:/g)?.length, 1, "the other step's file is not listed with it")
	assert.match(
		how,
		/The steps quote 2 of 2 changed blocks\./,
		'and the walkthrough says how much of the change it quotes',
	)

	const code = await panel(`change=${REVIEWED}`, 'code', picked)
	assert.match(code, /keep\(\)/)
	assert.doesNotMatch(code, /wait\(\)/, "the other step's diff stays with its step")
})

// The page asks the server through one function, which says whether the answer is ok.
const fromServer = async (url: string) => {
	const { status, text } = await call(server, url)
	return { ok: status === 200, body: JSON.parse(text) }
}

test('a change nobody asked ken about still says what git knows: its commits, the changed files of each part, and the diff of the part the reader picks', async () => {
	const { home, loads } = pageOn(fromServer)
	Object.assign(home, { wayIn: 'review', change: `${first}..${docs}`, detail: 'how' })
	await loads.refresh()
	const how = said(inspectorHtml(home, ENV))
	assert.match(how, /docs: say what the store is for/, 'the commit of the change')
	assert.match(how, /Store .*src\/store\/db\.ts lines added: \+1 removed: -0/, 'the file it changed, under its part')
	assert.match(how, /Ask ken to walk me through it/)

	Object.assign(home, { detail: 'code', selected: { kind: 'part', name: 'Store' } })
	await loads.loadDiff()
	const code = said(inspectorHtml(home, ENV))
	assert.match(code, /Added: \/\/ Saves\./, 'the line the change added to the store, read from git')
	assert.doesNotMatch(code, /Ask ken to walk me through it/, 'the picked part shows its own diff')
})

const address: { writeAddress: (place: object) => string; readAddress: (hash: string) => object | null } = await import(
	path.join(HOME, 'state/address.js')
)

test('the address of a place on the home reads back as the same place, and an address that names none reads as none', () => {
	const place = {
		wayIn: 'review',
		detail: 'code',
		trail: [
			{ name: 'Whole project', within: [] },
			{ name: 'Code & "tests": all of it', within: ['src/core', 'test/a b.ts'] },
		],
		change: `${docs}..${head}`,
		at: '',
		shown: null,
		selected: { kind: 'part', name: 'Core: the #1 part' },
	}
	assert.deepEqual(address.readAddress(address.writeAddress(place)), place)

	const drawnPicture = {
		...place,
		change: 'none',
		at: 'abc1234',
		shown: 'q-17',
		selected: { kind: 'element', number: 4 },
	}
	assert.deepEqual(address.readAddress(address.writeAddress(drawnPicture)), drawnPicture)

	assert.equal(address.readAddress(''), null, 'a first visit has no place')
	assert.equal(address.readAddress('#way=sideways&detail=big'), null, 'a way in ken does not have is no place')
})

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

test('a run is judged against the level it started on: a reader who looked inside a part meanwhile is told it finished there, and one who stayed sees what it made', async () => {
	const whole = { name: 'Whole project', within: [] }
	const started = { kind: 'tour', trail: [whole], change: 'none' }
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
