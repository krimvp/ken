import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

// A command that runs the core, a core of two files that saves to a store, and a test of the core.
const FILES = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\tsave(plan())\n}\n",
	'src/core/plan.ts': 'export function plan() {\n\treturn 1\n}\n',
	'src/store/db.ts': 'export function save(made: number) {}\n',
	'test/run.test.ts': "import { run } from '../src/core/run.ts'\nrun()\n",
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const quote = (file: keyof typeof FILES, text: string) => ({ path: file, commit: 'HEAD', text })

// What the record holds before the reader asks anything: the parts with their arrows, one term with what it means,
// and one decision that quotes a line of the core.
const record = fileRecordStore(root, gitRepository(root))
const term = {
	kind: 'topic' as const,
	name: 'save',
	quotes: [quote('src/store/db.ts', 'export function save(made: number) {}')],
}
const termEntry = await record.check(term)
if (termEntry.kind !== 'ok') assert.fail(termEntry.problems.join(' '))
const written = await record.append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		about: 'A command that runs one piece of work and saves it.',
		flows: ['How a run is saved'],
		parts: [
			{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
			{ name: 'Store', job: 'Saves what the core makes', paths: ['src/store'] },
			{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
			{ name: 'Tests', job: 'Tests the core', paths: ['test'] },
		],
		arrows: [
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
	},
	term,
	{ kind: 'note', topic: termEntry.entry.id, text: 'Writes what the core made to the store.' },
	{
		kind: 'decision',
		question: 'When does the core save?',
		chosen: 'Once, at the end of a run',
		reason: { text: 'One write keeps a run whole.', quotes: [] },
		rejected: [],
		undo: 'easy',
		needsOwner: false,
		quotes: [quote('src/core/run.ts', '\tsave(plan())')],
		work: null,
	},
])
if (written.kind !== 'appended') assert.fail(written.problems.join(' '))

// A stop as ken's model sent it while ken still gave tours: a paragraph, and one card that proves it.
const stop = (number: number, text: string, claim: string, file: keyof typeof FILES, line: string): Turn => ({
	tool: 'ken__show',
	args: { step: { number, text }, claims: [{ text: claim, label: 'inferred', quotes: [quote(file, line)] }] },
})
const model = await scriptedModel([
	stop(
		1,
		'A run starts in run. It makes a plan and hands it to the store in one call.',
		'run saves the plan it makes, in src/core/run.ts.',
		'src/core/run.ts',
		'\tsave(plan())',
	),
	stop(
		2,
		'The store takes what the core made.',
		'save takes a number.',
		'src/store/db.ts',
		'export function save(made: number) {}',
	),
	stop(3, 'The command starts a run.', 'main calls run.', 'src/cli/main.ts', 'run()'),
	stop(4, 'The tests call run.', 'The test calls run.', 'test/run.test.ts', 'run()'),
	{ text: '' },
	{
		tool: 'ken__show',
		text: 'One run, from the command to the store.',
		args: {
			diagrams: [
				{
					kind: 'sequence',
					title: 'One run, from the command to the store',
					label: 'inferred',
					participants: [{ name: 'Command' }, { name: 'Core' }, { name: 'db' }],
					messages: [
						{ from: 'Command', to: 'Core', text: 'starts a run', quotes: [quote('src/cli/main.ts', 'run()')] },
						{ from: 'Core', to: 'db', text: 'saves the plan', quotes: [quote('src/core/run.ts', '\tsave(plan())')] },
					],
				},
			],
		},
	},
	{ text: '' },
])
const server = await openKen(root, readerHome(), model.baseUrl)
const briefOf = async (concept: string) => await json(server, `/api/brief?concept=${encodeURIComponent(concept)}`)

const unexplained = await briefOf('part::Core')
await ask(server, { lens: { kind: 'tour', within: [] } })
await ask(server, { lens: { kind: 'view', within: [], text: 'Follow one run' } })

test('a part ken has not explained opens from what ken holds: its job, the decision in its files, what is inside it, and the lens that asks for the rest', () => {
	assert.deepEqual(
		[unexplained.id, unexplained.kind, unexplained.name, unexplained.line, unexplained.explained],
		['part::Core', 'part', 'Core', 'Runs the work', false],
	)
	assert.deepEqual([unexplained.points, unexplained.terms, unexplained.questions], [[], [], []])
	assert.deepEqual(unexplained.explain, { lens: { kind: 'explain', within: [], part: 'Core' } })
	assert.deepEqual(
		unexplained.decisions.map((each: { question: string; chosen: string; why: string }) => [
			each.question,
			each.chosen,
			each.why,
		]),
		[['When does the core save?', 'Once, at the end of a run', 'One write keeps a run whole.']],
	)
	assert.deepEqual(unexplained.deeper, { within: 'src/core', parts: 2, files: 2 }, 'two files, each a box inside')
	assert.equal(unexplained.knows.level, 'new')
})

test('Sideways lists the parts a part uses and the parts that use it, each with its verb, and the drawn process that passes through it', async () => {
	const { sideways } = await briefOf('part::Core')
	assert.deepEqual(sideways.uses, [{ id: 'part::Store', name: 'Store', verb: 'saves to' }])
	assert.deepEqual(sideways.usedBy, [{ id: 'part::Command', name: 'Command', verb: 'runs' }])
	assert.deepEqual(
		sideways.processes.map((each: { name: string; steps: number }) => [each.name, each.steps]),
		[['One run, from the command to the store', 2]],
	)
	const [through] = sideways.processes
	const process = await briefOf(through.id)
	assert.deepEqual(
		process.steps.map((step: { n: number; part: string | null; line: string }) => [step.n, step.part, step.line]),
		[
			[1, 'part::Command', 'starts a run'],
			[2, 'part::Core', 'saves the plan'],
		],
		'each step is in the part its quoted line is in',
	)
	assert.deepEqual((await briefOf('part::Tests')).sideways.processes, [], 'the process does not pass through the tests')
})

test('a term opens with what it means and the place the code uses it, and names the part that holds that place', async () => {
	const brief = await briefOf('term:save')
	assert.deepEqual([brief.kind, brief.name, brief.line], ['term', 'save', 'Writes what the core made to the store.'])
	assert.deepEqual(
		brief.points.map((point: { quotes: { path: string; startLine: number; text: string }[] }) =>
			point.quotes.map((each) => [each.path, each.startLine, each.text]),
		),
		[[['src/store/db.ts', 1, 'export function save(made: number) {}']]],
	)
	assert.deepEqual(brief.usedIn, [{ id: 'part::Store', name: 'Store' }])
})

test('a concept ken does not have answers 404, whatever is wrong with its id', async () => {
	for (const concept of [
		'part::Nowhere',
		'part:src/none:Core',
		'term:nothing',
		'process:none',
		'decision:none',
		'rumour:x',
		'',
	]) {
		const { status, text } = await call(server, `/api/brief?concept=${encodeURIComponent(concept)}`)
		assert.equal(status, 404, `${concept}: ${text}`)
		assert.equal(typeof JSON.parse(text).message, 'string')
	}
})

test('a level toured before ken wrote briefs opens as briefs: the stop and its card are things to know with their quoted lines, drawn as a dot, under the job as the line', async () => {
	const brief = await briefOf('part::Core')
	assert.deepEqual([brief.explained, brief.line], [true, 'Runs the work'])
	assert.deepEqual(
		brief.points.map(
			(point: { line: string; long: string; drawing: object; quotes: { path: string; text: string }[] }) => [
				point.line,
				point.long,
				point.drawing,
				point.quotes.map((each) => `${each.path}: ${each.text.trim()}`),
			],
		),
		[
			[
				'A run starts in run.',
				'A run starts in run. It makes a plan and hands it to the store in one call.',
				{ kind: 'dot' },
				['src/core/run.ts: save(plan())'],
			],
			[
				'run saves the plan it makes, in src/core/run.ts.',
				'run saves the plan it makes, in src/core/run.ts.',
				{ kind: 'dot' },
				['src/core/run.ts: save(plan())'],
			],
		],
	)
	assert.deepEqual(
		brief.explain,
		{ lens: { kind: 'explain', within: [], part: 'Core' } },
		'ken can still explain it anew',
	)
})

test('search finds each part of the level, the term and the drawn process, and finds a part once though the record holds a topic of its name', async () => {
	const found: { id: string; kind: string; name: string; line: string; level: string | null }[] = await json(
		server,
		'/api/concepts',
	)
	assert.deepEqual(
		found.filter((each) => each.kind !== 'process').map((each) => [each.id, each.line, each.level]),
		[
			['part::Core', 'Runs the work', 'new'],
			['part::Store', 'Saves what the core makes', 'new'],
			['part::Command', 'The command a person types', 'new'],
			['part::Tests', 'Tests the core', 'new'],
			['term:save', 'Writes what the core made to the store.', null],
		],
		'the tour made a topic of each part, and none of them is found as a term',
	)
	assert.deepEqual(
		found.filter((each) => each.kind === 'process').map((each) => [each.name, each.line, each.level]),
		[['One run, from the command to the store', '2 steps across 3 lanes.', null]],
	)
})

test('the processes of a level come as lanes matched to its parts and the messages between them, with the processes ken offers to draw there', async () => {
	const { processes, offers } = await json(server, '/api/processes')
	assert.deepEqual(offers, ['How a run is saved'])
	const [process] = processes
	const asked: { askedAt: string }[] = (await json(server, '/api/questions')).questions
	assert.deepEqual(
		[processes.length, process.name, process.steps, process.drawn],
		[1, 'One run, from the command to the store', 2, asked.at(-1)?.askedAt.slice(0, 10)],
		'drawn on the day the reader asked for it',
	)
	assert.deepEqual(
		process.lanes,
		[
			{ name: 'Command', part: 'part::Command' },
			{ name: 'Core', part: 'part::Core' },
			{ name: 'db', part: null },
		],
		'a lane that is no part of the level, and has no line in one, stands for none',
	)
	assert.deepEqual(
		process.messages.map(
			(message: { n: number; from: number; to: number; line: string; quotes: { path: string }[] }) => [
				message.n,
				message.from,
				message.to,
				message.line,
				message.quotes.map((quote) => quote.path),
			],
		),
		[
			[1, 0, 1, 'starts a run', ['src/cli/main.ts']],
			[2, 1, 2, 'saves the plan', ['src/core/run.ts']],
		],
	)
	const inside = await json(server, '/api/processes?within=test')
	assert.deepEqual(inside, { processes: [], offers: [] }, 'no drawn process rests on a line of the tests')
})
