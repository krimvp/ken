import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
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
	{
		tool: 'ken__show',
		args: {
			brief: {
				number: 1,
				line: 'Save writes one number to the store.',
				points: [
					{
						line: 'It takes what the core made.',
						more: 'It takes the number the core made.',
						long: 'It takes the number the core made, and keeps it.',
						drawing: { kind: 'store' },
						quotes: [{ path: 'src/store/db.ts', text: 'export function save(made: number) {}' }],
					},
				],
			},
		},
	},
	{ text: '' },
])
const server = await openKen(root, readerHome(), model.baseUrl)
const briefOf = async (concept: string) => await json(server, `/api/brief?concept=${encodeURIComponent(concept)}`)

const unexplained = await briefOf('part::Core')
const levelBefore = await json(server, '/api/layout')
await ask(server, { lens: { kind: 'explain', within: [], part: null } })
const levelAfter = await json(server, '/api/layout')
await ask(server, { lens: { kind: 'view', within: [], text: 'Follow one run' } })

test('a part ken has not explained opens from what ken holds: its job, the decision in its files, what is inside it, and the lens that asks for the rest', () => {
	assert.equal(unexplained.trust, "ken found this in git. ken's model has not explained it yet.")
	assert.deepEqual(
		[unexplained.id, unexplained.kind, unexplained.name, unexplained.line, unexplained.explained],
		['part::Core', 'part', 'Core', 'Runs the work', false],
	)
	assert.deepEqual([unexplained.points, unexplained.terms], [[], []])
	assert.deepEqual(
		unexplained.questions.map((each: { text: string; answered: boolean }) => [each.text, each.answered]),
		[
			['How does Core save to Store?', false],
			['How does Command run Core?', false],
			['Which of its 2 files should I read first?', false],
		],
		'plain code asks what its arrows and its files raise',
	)
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

test("a level says how many of its parts ken's model explained, and a block of one file says its lines and what the model said of it", async () => {
	assert.deepEqual(
		[levelBefore.look.explained, levelAfter.look.explained],
		[0, levelAfter.look.boxes.length],
		'a level explained part by part counts as explained as one explained whole',
	)
	const inside = await json(server, '/api/layout?within=src/core')
	const run = inside.look.boxes.find((box: { name: string }) => box.name === 'run.ts')
	assert.deepEqual([run.lines, run.told], [4, null])
})

test('inside a part nobody split, a block of one file opens as that file', async () => {
	const file = await briefOf('part:src/core:run.ts')
	assert.deepEqual([file.kind, file.name, file.line], ['file', 'run.ts', 'The file src/core/run.ts.'])
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
	assert.deepEqual(
		[brief.kind, brief.name, brief.line, brief.note],
		['term', 'save', 'A term the project uses in Store.', 'Writes what the core made to the store.'],
		'before the model explains it, a plain line on where it is used, then what the record says it means',
	)
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
	const core = found.find((each) => each.id === 'part::Core') as { minutes: number } | undefined
	assert.equal(core?.minutes, (await briefOf('part::Core')).minutes, 'a part takes as long as its brief says')
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

test("ken's model explains a term when asked, and its answer is the term's brief from then on", async () => {
	const before = await briefOf('term:save')
	const lens = { kind: 'answer', concept: 'term:save', text: 'What does "save" mean in this project?' }
	assert.deepEqual([before.explained, before.explain], [false, { lens }], 'until the model explains it')
	await ask(server, { lens })
	const after = await briefOf('term:save')
	assert.equal(after.line, 'Save writes one number to the store.')
	assert.deepEqual(
		after.points.map((point: { line: string }) => point.line),
		['It takes what the core made.', 'Find it in src/store/db.ts.'],
		"the model's things to know come first, then where the code uses it",
	)
})

test('an old term note and its line numbers stay out of a brief when the quoted code is gone', async () => {
	const file = 'src/term.ts'
	const { root } = buildRepository([{ message: 'add timeout', files: { [file]: 'const timeout = 5\n' } }])
	const record = fileRecordStore(root, gitRepository(root))
	const topic = await record.append([
		{ kind: 'topic', name: 'timeout', quotes: [{ path: file, commit: 'HEAD', text: 'const timeout = 5' }] },
	])
	if (topic.kind !== 'appended' || !topic.entries[0]) assert.fail('the topic must be saved before the note')
	await record.append([{ kind: 'note', topic: topic.entries[0].entry.id, text: 'Waits five seconds.' }])
	const server = await openKen(root, readerHome())
	const read = () => json(server, '/api/brief?concept=term:timeout')
	assert.equal((await read()).note, 'Waits five seconds.')
	writeFileSync(path.join(root, file), 'const timeout = 25\n')
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'wait longer', '--', file], { cwd: root })
	const brief = await read()
	assert.deepEqual(brief.staleFiles, [file])
	assert.deepEqual([brief.note, brief.points, brief.usedIn], [undefined, [], []])
})
