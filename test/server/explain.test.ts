import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

// A command that runs the core, a core that saves to a store, and a test of the core.
const FILES = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts':
		"import { save } from '../store/db.ts'\n// Runs the work, then saves it.\nexport function run() {\n\tsave()\n}\n",
	'src/store/db.ts': 'export function save() {}\n',
	'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const home = readerHome()

// The parts as ken's model named them, the test part first, to show that it is still explained last.
const record = fileRecordStore(root, gitRepository(root))
const quote = (file: keyof typeof FILES, text: string) => ({ path: file, commit: 'HEAD', text })
const named = await record.append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		parts: [
			{ name: 'Tests', job: 'Tests the core', paths: ['test'] },
			{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
			{ name: 'Store', job: 'Saves what the core makes', paths: ['src/store'] },
			{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
		],
		arrows: [
			{
				from: 'Core',
				to: 'Store',
				text: 'saves to',
				quotes: [quote('src/core/run.ts', "import { save } from '../store/db.ts'")],
			},
		],
	},
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

type Sent = { line: string; drawing?: object; file: keyof typeof FILES; quoted: string }
// A thing to know as the model sends it. The quote names no commit, so ken reads it at HEAD.
const point = ({ line, drawing = { kind: 'dot' }, file, quoted }: Sent) => ({
	line,
	more: `${line} More.`,
	long: `${line} Long. And longer.`,
	drawing,
	quotes: [{ path: file, text: quoted }],
})
const term = (name: string, means: string, file: keyof typeof FILES, quoted: string) => ({
	name,
	means,
	quote: { path: file, text: quoted },
})
const brief = (number: number, line: string, rest: object): Turn => ({
	tool: 'ken__show',
	args: { brief: { number, line, ...rest } },
})

const ASKED = ['What happens when a save fails?', 'Why does a run save once?', 'What would a second store break?']
const model = await scriptedModel([
	{ text: 'Let me read the parts.', tool: 'ken__read_file', args: { path: 'src/cli/main.ts' } },
	brief(1, 'Runs one piece of work and saves it.', {
		points: [
			point({
				line: 'A run saves once, at its end.',
				drawing: { kind: 'steps', count: 3, lit: 3, label: 'save' },
				file: 'src/core/run.ts',
				quoted: '\tsave()',
			}),
			point({ line: 'A run saves twice to be safe.', file: 'src/core/run.ts', quoted: '\tsaveTwice()' }),
			point({
				line: 'This line runs on and on, well past the ten words a line may hold.',
				file: 'src/core/run.ts',
				quoted: 'export function run() {',
			}),
		],
		terms: [term('save', 'Writes what a run made.', 'src/store/db.ts', 'export function save() {}')],
		questions: ASKED,
	}),
	brief(2, 'Keeps what the core hands it.', {
		points: [
			point({
				line: 'The store takes one call.',
				drawing: { kind: 'loop', count: 40, label: 'far too long a label' },
				file: 'src/store/db.ts',
				quoted: 'export function save() {}',
			}),
		],
		terms: [term('Save', 'Something else entirely.', 'src/core/run.ts', '\tsave()')],
	}),
	brief(3, 'Starts a run when a person types the command.', {
		points: [point({ line: 'The command calls run.', file: 'src/cli/main.ts', quoted: 'run()' })],
	}),
	brief(4, 'Runs the core the way the command does.', {
		points: [point({ line: 'The test calls run.', file: 'test/run.test.ts', quoted: 'run()' })],
	}),
	{ text: 'That is the whole project.' },
	// Later, the reader asks for the store alone.
	brief(1, 'Holds the one function that saves.', {
		points: [
			point({ line: 'Saving is one empty function.', file: 'src/store/db.ts', quoted: 'export function save() {}' }),
		],
	}),
	{ text: '' },
])
const server = await openKen(root, home, model.baseUrl)
const briefOf = async (concept: string, from = server) =>
	await json(from, `/api/brief?concept=${encodeURIComponent(concept)}`)
const lines = await ask(server, { lens: { kind: 'explain', within: [], part: null } })
const core = await briefOf('part::Core')

test('explaining a level asks for a brief of each part in the order the level lists them, tests last, and keeps the reply as the briefs of those parts', async () => {
	const question: string = lines.find((line) => line.kind === 'asked').question
	assert.equal(question.split('\n')[0], 'Explain the parts of this project')
	assert.deepEqual(
		question.split('\n').flatMap((line) => line.match(/^- Part \d+, (.+) \((.+)\): (.+)$/)?.slice(1) ?? []),
		[
			...['Core', 'src/core', 'Runs the work'],
			...['Store', 'src/store', 'Saves what the core makes'],
			...['Command', 'src/cli', 'The command a person types'],
			...['Tests', 'test', 'Tests the core'],
		],
		'the question carries each part in order with its paths and job',
	)
	const rows = (await json(server, '/api/questions')).questions
	assert.deepEqual(rows[0].tour, { within: [], stops: ['Core', 'Store', 'Command', 'Tests'] })
	const topics: { topic: string; kind: string }[] = lines.at(-1).view.topics
	assert.deepEqual(
		Object.fromEntries(topics.map((state) => [state.topic, state.kind])),
		{ Command: 'never-met', Core: 'never-met', Store: 'never-met', Tests: 'never-met', save: 'never-met' },
		"each part and each term is a topic of the record, and asking ken to explain marks none of them on the reader's map",
	)
})

test("a part ken's model explained opens with the model's line, its things to know with their drawings and quoted lines, its terms and its questions", () => {
	assert.deepEqual([core.explained, core.line], [true, 'Runs one piece of work and saves it.'])
	assert.deepEqual(
		core.points.map((each: { quotes: { path: string; startLine: number; endLine: number; text: string }[] }) => ({
			...each,
			quotes: each.quotes.map(({ path, startLine, endLine, text }) => ({ path, startLine, endLine, text })),
		})),
		[
			{
				line: 'A run saves once, at its end.',
				more: 'A run saves once, at its end. More.',
				long: 'A run saves once, at its end. Long. And longer.',
				drawing: { kind: 'steps', count: 3, lit: 3, label: 'save' },
				quotes: [{ path: 'src/core/run.ts', startLine: 4, endLine: 4, text: '\tsave()' }],
			},
		],
	)
	assert.deepEqual(core.terms, [{ id: 'term:save', name: 'save' }])
	assert.deepEqual(
		core.questions.map((each: { text: string; answered: boolean }) => [each.text, each.answered]),
		ASKED.map((text) => [text, false]),
	)
})

test('a thing to know whose quote is not in git, or whose line passes ten words, goes back to the model alone and never reaches the brief', () => {
	assert.deepEqual(
		lines.flatMap((line) => (line.kind === 'step' && line.step.kind === 'sent-back' ? [line.step.what] : [])),
		['Point 2', 'Point 3'],
	)
	const sent = JSON.stringify(core)
	assert.ok(!sent.includes('saveTwice') && !sent.includes('saves twice'), 'nothing of the point with the false quote')
	assert.ok(!sent.includes('runs on and on'), 'nothing of the point with the long line')
	assert.equal(core.points.length, 1, 'the thing to know that passed stands')
})

test('a term is a topic of the record with one meaning: a second brief that names it keeps the first meaning, and the term opens as a brief', async () => {
	const store = await briefOf('part::Store')
	assert.deepEqual(store.terms, [{ id: 'term:save', name: 'save' }])
	const opened = await briefOf('term:save')
	assert.deepEqual(
		[opened.line, opened.note, opened.explained, opened.explain?.lens.kind],
		['A term the project uses in Store.', 'Writes what a run made.', false, 'answer'],
		'it opens with where it is used and its meaning, and offers the run that explains it',
	)
	assert.deepEqual(opened.usedIn, [{ id: 'part::Store', name: 'Store' }])
	const topics = (await record.read()).current.filter(
		(entry) => entry.kind === 'topic' && entry.name.toLowerCase() === 'save',
	)
	assert.equal(topics.length, 1)
})

test('a drawing keeps only what the page can draw: a count or a label past its bounds is left out and the kind stands', async () => {
	const store = await briefOf('part::Store')
	assert.deepEqual(store.points[0].drawing, { kind: 'loop' })
})

test('explaining one part asks for that part alone, with the others beside it, and leaves their briefs as they were', async () => {
	const refused = await call(server, '/api/questions', { lens: { kind: 'explain', within: [], part: 'Nowhere' } })
	assert.equal(refused.status, 400, refused.text)
	const asked = await ask(server, { lens: { kind: 'explain', within: [], part: 'Store' } })
	const question: string = asked.find((line) => line.kind === 'asked').question
	assert.equal(question.split('\n')[0], 'Explain Store, a part of this project')
	assert.deepEqual(question.match(/^- Part \d+, .+$/gm), ['- Part 1, Store (src/store): Saves what the core makes'])
	assert.match(question, /^- Beside it: Core \(Runs the work\); Command .*; Tests .*\.$/m)

	assert.equal((await briefOf('part::Store')).line, 'Holds the one function that saves.')
	assert.deepEqual(await briefOf('part::Core'), core, 'the core keeps the brief of the run before')
	await server.close()
	const later = await openKen(root, home)
	assert.deepEqual(await briefOf('part::Core', later), core, 'a brief opens again with no model')
})

test('a thing to know that quotes only a comment goes back to the model, and one that quotes code beside the comment is shown', async () => {
	const comment = '// Runs the work, then saves it.'
	const told = (quoted: string) =>
		brief(1, 'Runs the work.', {
			points: [point({ line: 'The core runs the work.', file: 'src/core/run.ts', quoted })],
		})
	const scripted = await scriptedModel([told(comment), told(`${comment}\nexport function run() {`), { text: '' }])
	const again = await openKen(root, readerHome(), scripted.baseUrl)
	const said = await ask(again, { lens: { kind: 'explain', within: [], part: 'Core' } })

	assert.deepEqual(
		said.flatMap((line) => (line.kind === 'step' && line.step.kind === 'sent-back' ? [line.step.what] : [])),
		['Point 1'],
		'the point that quotes only a comment went back',
	)
	const shown = await briefOf('part::Core', again)
	assert.deepEqual(
		shown.points.map((each: { quotes: { text: string }[] }) => each.quotes[0]?.text),
		[`${comment}\nexport function run() {`],
		'the reader sees the one point that quotes code',
	)
})

test('briefs the model sends in one turn reach the reader in the order of the parts, each followed by its own things to know and terms', async () => {
	const first = {
		number: 1,
		line: 'Runs the work.',
		points: [
			point({ line: 'The core runs the work.', file: 'src/core/run.ts', quoted: 'export function run() {' }),
			point({ line: 'The core saves at the end.', file: 'src/core/run.ts', quoted: '\tsave()' }),
		],
		terms: [term('run', 'One piece of work, start to end.', 'src/core/run.ts', 'export function run() {')],
	}
	const second = {
		number: 2,
		line: 'Keeps what the core hands it.',
		points: [
			point({ line: 'The store takes one call.', file: 'src/store/db.ts', quoted: 'export function save() {}' }),
		],
	}
	const scripted = await scriptedModel([
		{
			calls: [
				{ tool: 'ken__show', args: { brief: first } },
				{ tool: 'ken__show', args: { brief: second } },
			],
		},
		{ text: '' },
	])
	const again = await openKen(root, readerHome(), scripted.baseUrl)
	const said = await ask(again, { lens: { kind: 'explain', within: [], part: null } })
	const items: { kind: string; number?: number; step?: number; card?: { kind: string } }[] =
		said.at(-1).view.entry.reply.items
	assert.deepEqual(
		items.map((item) => (item.kind === 'step' ? `brief ${item.number}` : `${item.card?.kind} of ${item.step}`)),
		['brief 1', 'claim of 1', 'claim of 1', 'topic of 1', 'brief 2', 'claim of 2'],
	)
})

test('asked to explain the whole level once one part is explained, the model is asked for the rest alone', async () => {
	const scripted = await scriptedModel([
		brief(1, 'Runs the work.', {
			points: [point({ line: 'The core runs the work.', file: 'src/core/run.ts', quoted: 'export function run() {' })],
		}),
		{ text: '' },
		{ text: '' },
	])
	const again = await openKen(root, readerHome(), scripted.baseUrl)
	await ask(again, { lens: { kind: 'explain', within: [], part: 'Core' } })
	const said = await ask(again, { lens: { kind: 'explain', within: [], part: null } })
	const question: string = said.find((line) => line.kind === 'asked').question
	assert.deepEqual(
		[...question.matchAll(/^- Part \d+, (.+?) \(/gm)].map((match) => match[1]),
		['Store', 'Command', 'Tests'],
	)
})
