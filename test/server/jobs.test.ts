import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import type { KenServer } from '../../src/server/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const FILES = {
	'src/cli/main.ts': "import { run } from '../core/run.ts'\nrun()\n",
	'src/core/run.ts': 'export function run() {\n\treturn 1\n}\n',
}
const BACKGROUND = { KEN_BACKGROUND: 'on' }
// Built here, so each folder goes only after the server that reads it has closed.
const fresh = buildRepository([{ message: 'feat: start', files: FILES }])
const namedRepo = buildRepository([{ message: 'feat: start', files: FILES }])
const asking = buildRepository([{ message: 'feat: start', files: FILES }])
const homes = [readerHome(), readerHome(), readerHome()]

type Job = { key: string; title: string; by: string; state: { kind: string; skipped?: boolean }; place: number | null }

// GET /api/jobs as the page reads it: one list of jobs a line, a new line each time a job changes.
function jobLines(server: KenServer) {
	const lines: Job[][] = []
	const url = new URL('/api/jobs', server.url)
	const req = httpRequest(url, { headers: { origin: url.origin } })
	req.on('response', (res) => {
		let rest = ''
		res.on('data', (chunk) => {
			rest += chunk
			const whole = rest.split('\n')
			rest = whole.pop() ?? ''
			for (const line of whole) if (line.trim()) lines.push(JSON.parse(line).jobs)
		})
	})
	req.on('error', () => {})
	req.end()
	return { lines, close: () => req.destroy() }
}

async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean): Promise<T> {
	for (let tries = 0; tries < 400; tries += 1) {
		const value = await read()
		if (done(value)) return value
		await sleep(25)
	}
	throw new Error('gave up waiting')
}

const brief = (line: string, file: keyof typeof FILES, quoted: string, questions?: string[]): Turn => ({
	tool: 'ken__show',
	args: {
		brief: {
			number: 1,
			line,
			...(questions ? { questions } : {}),
			points: [
				{
					line,
					more: `${line} More.`,
					long: `${line} Long.`,
					drawing: { kind: 'dot' },
					quotes: [{ path: file, text: quoted }],
				},
			],
		},
	},
})

test('on a first open the server itself starts naming the parts, as the first job, and the page can read it', async () => {
	const { root } = fresh
	const model = await scriptedModel([{ hang: () => {} }])
	const server = await openKen(root, homes[0] ?? '', model.baseUrl, BACKGROUND)
	const [first] = await until(
		async () => (await json(server, '/api/jobs', { looking: { brief: null, within: null } })).jobs as Job[],
		(jobs) => jobs[0]?.state.kind === 'running',
	)
	assert.deepEqual([first?.key, first?.title, first?.by], ['parts:', 'Naming the main parts', 'ken'])
	await until(
		() => model.requests.length,
		(n) => n === 1,
	)
	assert.match(JSON.stringify(model.requests[0]?.messages), /Name the main parts of this project/)
})

test("ken explains each part by itself in tour order; a part the reader presses stops ken's run, goes first, and ken's run comes back after", async () => {
	const { root } = namedRepo
	const record = fileRecordStore(root, gitRepository(root))
	const named = await record.append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			parts: [
				{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
				{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
			],
			arrows: [
				{
					from: 'Command',
					to: 'Core',
					text: 'runs',
					quotes: [{ path: 'src/cli/main.ts', commit: 'HEAD', text: "import { run } from '../core/run.ts'" }],
				},
			],
		},
	])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	const model = await scriptedModel([
		{ hang: () => {} },
		brief('Starts a run when a person types the command.', 'src/cli/main.ts', 'run()'),
		brief('Runs the work and gives back one.', 'src/core/run.ts', '\treturn 1'),
	])
	const server = await openKen(root, homes[1] ?? '', model.baseUrl, BACKGROUND)
	const stream = jobLines(server)
	await until(
		() => model.requests.length,
		(n) => n === 1,
	)
	const before = stream.lines.at(-1) ?? []
	assert.deepEqual(
		before.map((job) => [job.key, job.state.kind, job.place]),
		[
			['explain:part::Core', 'running', null],
			['explain:part::Command', 'waiting', 1],
		],
		'ken took the parts in tour order, one at a time',
	)

	const looking = await json(server, '/api/jobs', { looking: { brief: 'part::Command', within: [] } })
	assert.deepEqual(
		looking.jobs.map((job: Job & { rank: number }) => [job.key, job.rank]),
		[
			['explain:part::Core', 4],
			['explain:part::Command', 2],
		],
		'the part whose brief the reader opened is nearer than the rest of the level behind the drawer',
	)

	const pressed = await ask(server, { lens: { kind: 'explain', within: [], part: 'Command' } })
	assert.match(pressed.find((line) => line.kind === 'asked').question, /^Explain Command, a part of this project/)
	assert.equal(pressed.at(-1).kind, 'saved')
	assert.match(JSON.stringify(model.requests[1]?.messages), /Explain Command/, "the reader's part went next")

	const done = await until(
		() => stream.lines.at(-1) ?? [],
		(jobs) => jobs.length === 2 && jobs.every((job) => job.state.kind === 'done'),
	)
	stream.close()
	assert.deepEqual(
		done.map((job) => [job.key, job.by]),
		[
			['explain:part::Core', 'ken'],
			['explain:part::Command', 'reader'],
		],
	)
	assert.match(JSON.stringify(model.requests[2]?.messages), /Explain Core/, "ken's run of Core came back")
	const states = stream.lines.map((jobs) => jobs.find((job) => job.key === 'explain:part::Core')?.state.kind)
	const changes = states.filter((state, at) => state !== states[at - 1])
	assert.deepEqual(changes, ['running', 'waiting', 'running', 'done'], 'the stream showed each change of the job')
	const rows = (await json(server, '/api/questions')).questions
	assert.deepEqual(
		rows.map((row: { question: string; outcome: string }) => [row.question.split('\n')[0], row.outcome]),
		[
			['Explain Command, a part of this project', 'answered'],
			['Explain Core, a part of this project', 'answered'],
		],
		'the run that gave way left nothing in the history',
	)
	assert.equal((await json(server, '/api/brief?concept=part%3A%3ACore')).line, 'Runs the work and gives back one.')
})

test('ken answers ahead only the first two questions a brief lists, and answering one does not bring in the third', async () => {
	const { root } = asking
	const record = fileRecordStore(root, gitRepository(root))
	const parts = [
		{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
		{ name: 'Command', job: 'The command a person types', paths: ['src/cli'] },
	]
	const named = await record.append([{ kind: 'layout', within: [], at: 'HEAD', parts, arrows: [] }])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	const asked = ['What does run give back?', 'Who calls run?', 'Why does run give back one?']
	const home = homes[2] ?? ''
	const first = await scriptedModel([
		brief('Runs the work and gives back one.', 'src/core/run.ts', '\treturn 1', asked),
		brief('Starts a run when a person types the command.', 'src/cli/main.ts', 'run()'),
	])
	const before = await openKen(root, home, first.baseUrl)
	for (const part of ['Core', 'Command']) await ask(before, { lens: { kind: 'explain', within: [], part } })
	const model = await scriptedModel([brief('Run gives back one.', 'src/core/run.ts', '\treturn 1'), { hang: () => {} }])
	const server = await openKen(root, home, model.baseUrl, BACKGROUND)
	const answers = async () =>
		((await json(server, '/api/jobs', { looking: { brief: null, within: null } })).jobs as Job[]).filter((job) =>
			job.key.startsWith('answer:'),
		)
	const after = await until(answers, (jobs) => jobs[0]?.title.includes(asked[1] ?? '') === true)
	assert.deepEqual(
		after.map((job) => [job.title, job.state.kind]),
		[
			[`Answering "${asked[1]}"`, 'running'],
			[`Answering "${asked[0]}"`, 'done'],
		],
		'with the first answered, the third question never joins the line',
	)
})
