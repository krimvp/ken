import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'
import { SHOP } from '../fixtures/drawings.ts'
import { call, json, openKen, readerHome } from '../fixtures/ken-server.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const PAGE = path.join(import.meta.dirname, '../../src/page')
type Step = { name: string; within: string[] }
type Place = {
	page: string
	trail: Step[]
	layer: string | null
	process: string | null
	change: string
	brief: string | null
	on: string | null
	older: object | null
	reply: string | null
}
const { readPlace, writePlace }: { readPlace: (hash: string) => Place; writePlace: (place: object) => string } =
	await import(path.join(PAGE, 'shell/place.js'))
const { findConcepts }: { findConcepts: (list: object[], text: string) => { name: string }[] } = await import(
	path.join(PAGE, 'shell/shell.js')
)
type Found = { kind: 'reading' } | { kind: 'ok'; brief: object } | { kind: 'none'; message: string }
type Answer = { ok: boolean; status: number; body: object }
const { briefStore }: { briefStore: (app: object) => { get: (id: string, then: () => void) => Found } } = await import(
	path.join(PAGE, 'brief/briefs.js')
)
const { processStops }: { processStops: (diagram: object, boxes: object[]) => { count: number; byBlock: number[][] } } =
	await import(path.join(PAGE, 'architecture/layers.js'))
type Home = { trail: Step[]; change: string; look: object | null; changes: object[] }
const { freshHome }: { freshHome: (stored: () => null, ui: object) => Home } = await import(
	path.join(PAGE, 'level/level-state.js')
)
const { homeLoads }: { homeLoads: (app: object) => { refresh: () => Promise<void> } } = await import(
	path.join(PAGE, 'level/loads.js')
)
const { briefHtml }: { briefHtml: (ui: object, found: Found, ctx: object) => string } = await import(
	path.join(PAGE, 'brief/brief.js')
)
const { architectureHtml }: { architectureHtml: (view: object) => string } = await import(
	path.join(PAGE, 'architecture/architecture.js')
)

const { processesPageHtml }: { processesPageHtml: (view: object) => string } = await import(
	path.join(PAGE, 'processes/processes.js')
)
const { changesPageHtml }: { changesPageHtml: (view: object) => string } = await import(
	path.join(PAGE, 'changes/changes.js')
)
const { startPageHtml }: { startPageHtml: (view: object) => string } = await import(path.join(PAGE, 'start/start.js'))
const { youPageHtml }: { youPageHtml: (view: object) => string } = await import(path.join(PAGE, 'you/you.js'))
const {
	changedParts,
	openViewHtml,
}: {
	changedParts: (look: object) => object[]
	openViewHtml: (...view: unknown[]) => string
} = await import(path.join(PAGE, 'views/open.js'))

const WHOLE = { name: 'Whole project', within: [] }
const ENGINE = { name: 'Plugin engine', within: ['src/engine.ts', 'src/hooks.ts'] }

test('an address written for a place reads back as that place, so a reload and Back keep where the reader is', () => {
	const places = [
		{ page: 'home', trail: [WHOLE], layer: null, process: null, change: 'none', tab: 'changes', brief: null, on: null },
		{
			page: 'changes',
			trail: [WHOLE],
			layer: null,
			process: null,
			change: 'since:2026-11-13',
			part: 'Plugin engine',
			tab: 'changes',
			brief: 'part::Sandbox',
			on: null,
		},
		{
			page: 'changes',
			trail: [WHOLE],
			layer: null,
			process: null,
			change: 'none',
			tab: 'decisions',
			brief: null,
			on: null,
		},
		{
			page: 'architecture',
			trail: [WHOLE, ENGINE],
			layer: 'changes',
			process: null,
			change: 'abc..def',
			tab: 'changes',
			brief: 'part:src/engine.ts,src/hooks.ts:Tool-call gate',
			on: 'sideways',
		},
		{
			page: 'architecture',
			trail: [WHOLE],
			layer: 'processes',
			process: 'p-1',
			change: 'none',
			tab: 'changes',
			brief: 'step:p-1:3',
			on: null,
		},
		{
			page: 'home',
			trail: [WHOLE],
			layer: null,
			process: null,
			change: 'none',
			tab: 'changes',
			brief: 'part:lib:entry',
			on: 'source',
			source: { path: 'lib/a & b.js', commit: 'a'.repeat(40), line: 61 },
		},
		{
			page: 'home',
			trail: [WHOLE],
			layer: null,
			process: null,
			change: 'none',
			tab: 'changes',
			brief: 'term:record log',
			on: 'questions',
		},
	]
	for (const place of places) {
		assert.deepEqual(readPlace(writePlace(place)), { ...place, reply: null })
	}
})

test('an address from before the pages opens the nearest place there is now', () => {
	const inside = new URLSearchParams({ way: 'learn', detail: 'how', pick: 'part:Tool-call gate' })
	inside.append('in', [ENGINE.name, ...ENGINE.within].join('\n'))
	const learned = readPlace(`#${inside}`)
	assert.equal(learned.page, 'architecture', 'learning the project is the Architecture page')
	assert.deepEqual(learned.trail, [WHOLE, ENGINE], 'at the level the reader was in')
	assert.equal(
		learned.brief,
		'part:src/engine.ts,src/hooks.ts:Tool-call gate',
		'with the part they picked as an open brief',
	)

	const review = readPlace('#way=review&detail=how&change=main..feature')
	assert.equal(review.page, 'changes', 'a change to review is on the Changes page')
	assert.equal(review.change, 'main..feature', 'with that change laid over the parts')

	assert.equal(readPlace('#way=learn&detail=big&picture=q-7').page, 'processes', 'a drawn picture is on Processes')
	assert.equal(readPlace('#reply=q-9').reply, 'q-9', 'and a saved reply still opens as itself')
	assert.equal(readPlace('#nothing-ken-knows').page, 'home', 'anything else is Home')
})

test('search finds a concept by every word typed, a match in the name before a match in its line', () => {
	const list = [
		{ id: 'part::Sandbox', name: 'Sandbox', line: 'Runs model-written code behind a gate' },
		{ id: 'term:gate', name: 'gate', line: 'A check a plugin runs on a tool call' },
		{ id: 'part::Eval runner', name: 'Eval runner', line: 'Parses scenarios' },
	]
	assert.deepEqual(
		findConcepts(list, 'GATE').map((each) => each.name),
		['gate', 'Sandbox'],
	)
	assert.deepEqual(findConcepts(list, 'gate plugin runs'), [list[1]], 'every word must be there')
	assert.deepEqual(findConcepts(list, '   '), [], 'and nothing typed finds nothing')
})

test('a drawn process numbers the parts it passes through in the order of its steps', () => {
	const boxes = [
		{ name: 'Host', paths: ['src/pi.ts'] },
		{ name: 'Engine', paths: ['src/engine'] },
		{ name: 'Sandbox', paths: ['src/sandbox.ts'] },
	]
	const step = (number: number, file: string | null) => ({
		number,
		numbered: true,
		text: `step ${number}`,
		quotes: file ? [{ path: file, startLine: 1, endLine: 1, text: 'x' }] : [],
	})
	const diagram = {
		elements: [
			step(1, 'src/pi.ts'),
			step(2, 'src/engine/call.ts'),
			step(3, 'src/engine/gate.ts'),
			step(4, 'README.md'),
			step(5, null),
			step(6, 'src/pi.ts'),
			{ number: 7, numbered: false, text: 'Host', quotes: [] },
		],
	}
	const stops = processStops(diagram, boxes)
	assert.deepEqual(stops.byBlock, [[1, 3], [2], []], 'a part the process comes back to has both its numbers')
	assert.equal(stops.count, 3, 'two steps in a row in one part are one stop, and a step in no part is none')
})

// A project with two parts ken's model named, and a later commit that touches one of them.
async function namedProject() {
	const startStore = "import { start } from '../store/db.ts'\nstart()"
	const waitForStore = "import { ready } from '../store/db.ts'\nawait ready()"
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: {
				'src/core/run.ts': startStore,
				'src/core/wait.ts': waitForStore,
				'src/store/db.ts': 'save()\n',
			},
		},
		{
			message: 'feat: the store keeps',
			files: { 'src/store/db.ts': 'keep()\n' },
			author: { name: 'Bo Other', email: 'bo@example.com' },
		},
	])
	const record = fileRecordStore(root, gitRepository(root))
	const drawn = await record.append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			// Two arrows join the same two parts.
			arrows: [
				{
					from: 'core',
					to: 'store',
					text: 'starts',
					quotes: [{ path: 'src/core/run.ts', commit: 'HEAD', text: startStore }],
				},
				{
					from: 'core',
					to: 'store',
					text: 'waits on',
					quotes: [{ path: 'src/core/wait.ts', commit: 'HEAD', text: waitForStore }],
				},
			],
			parts: ['core', 'store'].map((name) => ({ name, job: `Does the work of ${name}`, paths: [`src/${name}`] })),
		},
	])
	if (drawn.kind !== 'appended') assert.fail(drawn.problems.join(' '))
	const server = await openKen(root, readerHome())
	const read = async (url: string): Promise<Answer> => {
		const { status, text } = await call(server, url)
		return { ok: status === 200, status, body: JSON.parse(text) }
	}
	return { server, read }
}

function briefOf(store: { get: (id: string, then: () => void) => Found }, id: string): Promise<Found> {
	return new Promise((resolve) => {
		const now = store.get(id, () => resolve(store.get(id, () => {})))
		if (now.kind !== 'reading') resolve(now)
	})
}

test('Home gives a returning reader a way to open each suggested next step', async () => {
	const { server } = await namedProject()
	await json(server, '/api/seen', { did: 'opened', paths: ['src/core'] })
	const top = await json(server, '/api/layout?change=none')
	const home = freshHome(() => null, { unfolded: new Set() })
	const html = startPageHtml({
		top,
		home,
		project: 'p',
		concepts: [],
		briefOf: () => null,
		followUp: { decisions: [], topics: [] },
	})
	const next = top.look.next.items.slice(0, 3)
	assert.ok(next.length > 1)
	for (const [i, item] of next.entries()) {
		assert.ok(textOf(html).includes(item.title))
		assert.ok(html.includes(`data-act="start-go" data-index="${i}"`))
	}
})

test('Sideways shows a part two arrows join once, with both verbs, and counts it once', async () => {
	const { read } = await namedProject()
	const found = await briefOf(briefStore({ read }), 'part::store')
	if (found.kind !== 'ok') assert.fail(`the part has no brief: ${JSON.stringify(found)}`)
	const ctx = { home: freshHome(() => null, { unfolded: new Set() }), prefs: { text: 'pictures' }, env: {}, look: null }
	const ui = { trail: [{ id: 'part::store', name: 'store' }], openQuotes: new Set(), on: 'sideways' }
	const text = textOf(briefHtml(ui, found, { ...ctx, inner: null }))
	assert.match(text, /Used by core starts it, and waits on it (?!core)/, 'core is one row that says both arrows')
	assert.match(text, / 1 Sideways /, 'and Sideways counts one part')
})

test('a reader can follow the same parts, runtime and system connections in words', async () => {
	const { read } = await namedProject()
	const home = freshHome(() => null, { unfolded: new Set() })
	const { look } = (await read('/api/layout?change=none')).body as { look: { named: { about: string } } }
	look.named.about = 'The project keeps orders.'
	home.look = { ...look, views: SHOP }
	const page = (view: string, text: string, format?: string) =>
		architectureHtml({ home, arch: { view, format }, env: {}, brief: null, column: true, text })
	const parts = page('parts', 'words')
	assert.match(parts, /Show diagram/)
	assert.match(parts, /data-concept="arrow::1"[^>]*>core starts store</)
	const runtime = page('runtime', 'words')
	assert.match(runtime, /inside Cluster, namespace shop, 2 copies/)
	assert.match(runtime, /data-concept="crossing:e1"[^>]*>orders sends order\.placed to payments</)
	const world = page('world', 'pictures', 'text')
	assert.match(world, /Shopper to [^<]+<\/button><p>places orders/)
	assert.match(world, /to Payment provider<\/button><p>charges cards/)
	const mixed = page('parts', 'balanced')
	assert.match(mixed, /The project keeps orders\./)
	assert.match(mixed, /id="arch-world"/)
	assert.match(page('parts', 'words', 'drawing'), /Read as text/)
})

test('the canvas draws a level it read from a real server, and the changes layer says what each part changed', async () => {
	const { server, read } = await namedProject()
	const state = { home: freshHome(() => null, { unfolded: new Set() }), rows: [] }
	const app = {
		state,
		render() {},
		read,
		post: (url: string, body: object) => json(server, url, body),
		fromView: (view: { entry: object }) => view.entry,
		stored: () => null,
	}
	const loads = homeLoads(app)
	const arch = { layer: null as string | null, process: null, drawOpen: false, tree: new Map() }
	const env = { off: null, running: null, seconds: 0 }
	const draw = () => architectureHtml({ home: state.home, arch, env, brief: null, column: false })

	await loads.refresh()
	const parts = textOf(draw())
	assert.match(
		parts,
		/core New to you .*store New to you/,
		'each part is a block that says what ken thinks the reader knows of it',
	)

	const landed = state.home.changes.find((choice) => (choice as { kind: string }).kind === 'since') as {
		change: string
	}
	Object.assign(state.home, { change: landed.change })
	arch.layer = 'changes'
	await loads.refresh()
	const changed = textOf(draw())
	assert.match(changed, /store .*1 file/, 'the part the commit touched says how many files')
	assert.match(changed, /core .*No change/, 'and the other says it did not change')

	Object.assign(state.home, { trail: [WHOLE, { name: 'store', within: ['src/store'] }], change: 'none' })
	arch.layer = null
	await loads.refresh()
	assert.match(textOf(draw()), /db\.ts/, 'inside a part nobody named, the tree lists what git lists')
	const inside = architectureHtml({ home: state.home, arch, env, brief: null, column: true, topViews: SHOP })
	assert.match(inside, /data-view="runtime"/, 'the reader can return to the runtime from inside an unnamed folder')
	assert.match(inside, /data-view="world"/)
})

// What a reader reads on a page: its text without the markup.
const textOf = (html: string) =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&minus;/g, '-')
		.replace(/\s+/g, ' ')

test('a reader can follow the process in words and switch to either picture', () => {
	const process = {
		id: 'saved:route',
		name: 'Send a receipt',
		drawn: '2026-11-23',
		steps: 2,
		lanes: [{ name: 'Desk' }, { name: 'Mailer' }],
		messages: [
			{ n: 1, from: 0, to: 1, line: 'sends a receipt' },
			{ n: 2, from: 1, to: 0, line: 'returns a delivery ID' },
		],
	}
	const draw = (text: string, view: string | null = null) =>
		processesPageHtml({
			procs: { list: [process], offers: [], at: process.id, view },
			look: { boxes: [], arrows: [], within: [] },
			home: {},
			env: {},
			text,
		})
	const words = draw('words')
	assert.match(textOf(words), /1 sends a receipt Desk to Mailer 2 returns a delivery ID Mailer to Desk/)
	assert.match(words, /data-concept="step:saved:route:2"/)
	assert.match(words, /data-key="proc-view-text" aria-pressed="true"/)
	assert.match(draw('words', 'map'), /data-key="proc-view-map" aria-pressed="true"/)
	assert.match(draw('pictures'), /data-key="proc-view-lanes" aria-pressed="true"/)
	assert.match(draw('pictures', 'text'), /data-key="proc-view-text" aria-pressed="true"/)
})

const DAY = 86_400_000
const dayText = (time: number) =>
	new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// Commits n changes to one file now, by the reader, as a project where their work landed today.
function landNow(root: string, n: number) {
	for (let i = 0; i < n; i += 1) {
		writeFileSync(path.join(root, 'src/core/run.ts'), `run(${i})\n`)
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', `edit ${i}`], {
			cwd: root,
			env: { ...process.env, GIT_AUTHOR_EMAIL: OWNER.email, GIT_COMMITTER_EMAIL: OWNER.email },
		})
	}
}

// The reader looked at paths on an earlier visit, minutes ago, when the project was at head.
function lookedBefore(home: string, root: string, minutes: number, line: object) {
	const first = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
	const file = path.join(home, 'projects', first, 'seen.jsonl')
	mkdirSync(path.dirname(file), { recursive: true })
	const at = new Date(Date.now() - minutes * 60_000).toISOString()
	writeFileSync(file, `${JSON.stringify({ at, ...line })}\n`)
}

// The page as the reader meets it on a real server: the top level, what waits, the commits by day, and the Changes
// page with the change pick() chooses from what the server offers.
async function pagesOf(root: string, home: string, pick: (changes: { kind: string; change: string }[]) => string) {
	const server = await openKen(root, home)
	const read = async (url: string): Promise<Answer> => {
		const { status, text } = await call(server, url)
		return { ok: status === 200, status, body: JSON.parse(text) }
	}
	const state = { home: freshHome(() => null, { unfolded: new Set() }), rows: [] }
	const app = { state, render() {}, read, post: () => null, fromView: () => null, stored: () => null }
	const top = await json(server, '/api/layout?change=none')
	const timeline = await json(server, '/api/timeline')
	const followUp = await json(server, '/api/open')
	Object.assign(state.home, { change: pick(top.changes) })
	await homeLoads(app).refresh()
	const chg = { tab: 'changes', drag: null, typed: '' }
	const env = { off: null, running: null, seconds: 0 }
	const changes = changesPageHtml({ home: state.home, chg, env, timeline, waiting: 0, live: 'off', older: '' })
	const view = {
		top,
		home: state.home,
		reader: null,
		followUp,
		concepts: [],
		timeline,
		project: 'p',
		briefOf: () => null,
		first: null,
		env,
	}
	const waiting = openViewHtml(followUp, {}, false, '', [], changedParts(top.look))
	return { changes: textOf(changes), home: textOf(startPageHtml(view)), waiting: textOf(waiting) }
}

test('Changes counts every commit of a span of days and starts it on the day the span starts, though it lists only the newest', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n' } }])
	landNow(root, 60)
	const span = (changes: { kind: string; change: string }[]) =>
		changes.find((choice) => choice.kind === 'since')?.change ?? ''
	const { changes } = await pagesOf(root, readerHome(), span)
	assert.equal(changes.match(/\b60 commits\b/g)?.length, 2, 'in the numbers on top and over the list')
	assert.match(changes, new RegExp(`${dayText(Date.now() - 7 * DAY)} to today`), 'the last 7 days start 7 days ago')
})

test('Changes offers what landed since the reader last looked once, as the server counts it from the commit they looked at', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n' } }])
	const home = readerHome()
	lookedBefore(home, root, 120, { did: 'read', paths: ['src/core'], head: hashes[0] })
	landNow(root, 1)
	const { changes } = await pagesOf(root, home, () => 'none')
	assert.equal(changes.match(/Since you( last)? looked/g)?.length, 1)
})

test('a part that changed since the reader looked at it is counted the same on Home, in what waits on them, and by the server', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/core/run.ts': 'run()\n', 'src/store/db.ts': 'save()\n' } },
	])
	const home = readerHome()
	lookedBefore(home, root, 120, { did: 'read', paths: ['src/core'], head: hashes[0] })
	landNow(root, 2)
	const pages = await pagesOf(root, home, () => 'none')
	assert.match(pages.home, /\b1 part changed since you looked/)
	assert.match(pages.home, /\b1 thing waits on you/)
	assert.match(pages.waiting, /Changed since you looked \(1\) .* src 2 commits touched it/)
})

test('Home lists the other ways in as links that say what each is, and offers to draw the main process ken named when none is drawn', async () => {
	const { root } = buildRepository([
		{ message: 'First version', files: { 'delivery/send.ts': 'send', 'receipts/save.ts': 'save' } },
		{ message: 'Change how notices are sent', files: { 'delivery/send.ts': 'retry', 'receipts/save.ts': 'retain' } },
		{ message: 'Merge pull request #42 from example/notices', parent: 0, merge: 1, files: {} },
	])
	const flow = 'A notice is sent and its receipt saved'
	const named = await fileRecordStore(root, gitRepository(root)).append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			arrows: [],
			flows: [flow],
			parts: ['delivery', 'receipts'].map((name) => ({ name, job: `Does the work of ${name}`, paths: [name] })),
		},
	])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	const server = await openKen(root, readerHome())
	await json(server, '/api/seen', { did: 'opened', paths: ['delivery'] })
	const top = await json(server, '/api/layout?change=none')
	const html = startPageHtml({
		top,
		home: freshHome(() => null, { unfolded: new Set() }),
		project: 'p',
		concepts: [],
		briefOf: () => null,
		followUp: { decisions: [], topics: [] },
		env: { jobs: [], off: null },
	})
	const tile = (name: string) => html.split('<section').find((each) => each.includes(name)) ?? ''
	const start = tile('Start here')
	assert.match(
		textOf(start),
		/Review the merge of pull request #42 : 2 files, 2 parts/,
		'a link says how large the change is',
	)
	const processes = tile('>Processes<')
	assert.match(textOf(processes), new RegExp(`None drawn yet\\. ken's model named the main process, ${flow}`))
	assert.match(processes, /data-act="first-draw"/, 'and offers to draw it')
})

test('the You page gives a part the reader opened and read one line, led by the strongest thing they did', async () => {
	const { server } = await namedProject()
	for (const did of ['opened', 'read']) await json(server, '/api/seen', { did, paths: ['src/core'] })
	await json(server, '/api/seen', { did: 'opened', paths: ['src/store'] })
	const home = { ...freshHome(() => null, { unfolded: new Set() }), reader: await json(server, '/api/reader') }
	const { look } = await json(server, '/api/layout?change=none')
	const you = { all: false, fixing: null, note: '' }
	const lines = textOf(youPageHtml({ look, inside: new Map(), home, you, project: 'p' }))
	assert.match(lines, /You read about core once and opened it once\./)
	assert.match(lines, /You opened store\./, 'a part with one line keeps it as ken wrote it')
	assert.doesNotMatch(lines, /You opened core/, 'core has one line')
})
