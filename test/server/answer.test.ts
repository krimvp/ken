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

// A core that saves to a store.
const FILES = {
	'src/core/run.ts': "import { save } from '../store/db.ts'\nexport function run() {\n\tsave()\n}\n",
	'src/store/db.ts': 'export function save() {\n\tthrow new Error("full")\n}\n',
}
const { root } = buildRepository([{ message: 'feat: start', files: FILES }])
const named = await fileRecordStore(root, gitRepository(root)).append([
	{
		kind: 'layout',
		within: [],
		at: 'HEAD',
		parts: [
			{ name: 'Core', job: 'Runs the work', paths: ['src/core'] },
			{ name: 'Store', job: 'Saves what the core makes', paths: ['src/store'] },
		],
		arrows: [],
	},
])
if (named.kind !== 'appended') assert.fail(named.problems.join(' '))

const point = (line: string, file: keyof typeof FILES, quoted: string) => ({
	line,
	more: `${line} More.`,
	long: `${line} Long.`,
	drawing: { kind: 'gate' },
	quotes: [{ path: file, text: quoted }],
})
const brief = (line: string, rest: object): Turn[] => [
	{ tool: 'ken__show', args: { brief: { number: 1, line, ...rest } } },
]

const WRITTEN = 'What happens when a save fails?'
const OWN = `I am new to TypeScript. ${'I want to follow the path from the user request to the store. '.repeat(6)}Can a run save twice?`
const note = 'You are new to TypeScript.'
const model = await scriptedModel([
	...brief('Runs one piece of work and saves it.', {
		points: [point('A run saves once.', 'src/core/run.ts', '\tsave()')],
		questions: [WRITTEN, 'Why does a run save once?', 'What would a second store break?'],
	}),
	{ tool: 'ken__remember', args: { note } },
	...brief('The run stops with the error of the store.', {
		points: [point('The store throws when it is full.', 'src/store/db.ts', '\tthrow new Error("full")')],
	}),
	{ tool: 'ken__remember', args: { note } },
	...brief('No: run calls save one time.', {
		points: [point('run holds one call to save.', 'src/core/run.ts', '\tsave()')],
	}),
])
const home = readerHome()
const server = await openKen(root, home, model.baseUrl)
const briefOf = async (concept: string, from = server) =>
	await json(from, `/api/brief?concept=${encodeURIComponent(concept)}`)
type Question = { id: string; text: string; answered: boolean }

await ask(server, { lens: { kind: 'explain', within: [], part: 'Core' } })
const before: Question[] = (await briefOf('part::Core')).questions
const written = before.find((each) => each.text === WRITTEN)
if (!written) assert.fail('the brief lists the question ken wrote')

test('a question ken wrote and nobody asked opens with no answer and with the lens that asks it', async () => {
	const open = await briefOf(written.id)
	assert.deepEqual([open.kind, open.name, open.explained, open.points], ['question', WRITTEN, false, []])
	assert.deepEqual(open.about, { id: 'part::Core', name: 'Core' })
	assert.deepEqual(open.explain, { lens: { kind: 'answer', concept: 'part::Core', text: WRITTEN } })
	assert.equal(open.trust, "ken found this in git. ken's model has not explained it yet.")
})

test('an answer is kept as a brief: the saved row names it, the question opens as its answer, and the concept lists it as answered', async () => {
	const refused = await call(server, '/api/questions', {
		lens: { kind: 'answer', concept: 'part::Nowhere', text: WRITTEN },
	})
	assert.equal(refused.status, 400, 'a question about a concept ken does not have never reaches the model')

	const lines = await ask(server, { lens: { kind: 'answer', concept: 'part::Core', text: WRITTEN } })
	assert.match(lines.find((line) => line.kind === 'asked').question, /^What happens when a save fails\?\n/)
	assert.equal(lines.at(-1).view.brief, written.id, 'the saved row names the brief of the question the reader pressed')
	const rows: { brief: string | null }[] = (await json(server, '/api/questions')).questions
	assert.deepEqual(
		rows.map((row) => row.brief),
		['part::Core', written.id],
		'the run that explained one part names that part, and the answer names its question',
	)

	assert.deepEqual((await json(server, '/api/notes')).notes, [], 'a suggested question cannot set reader notes')
	const answer = await briefOf(written.id)
	assert.deepEqual(
		[answer.kind, answer.name, answer.line, answer.explained, answer.explain],
		['question', WRITTEN, 'The run stops with the error of the store.', true, null],
	)
	assert.deepEqual(
		answer.points.map((each: { line: string; drawing: object; quotes: { path: string; startLine: number }[] }) => [
			each.line,
			each.drawing,
			each.quotes.map((quote) => [quote.path, quote.startLine]),
		]),
		[['The store throws when it is full.', { kind: 'gate' }, [['src/store/db.ts', 2]]]],
	)
	assert.deepEqual(answer.about, { id: 'part::Core', name: 'Core' })
	assert.deepEqual(answer.lit, ['Store'], 'its picture lights the part its answer quotes')
	assert.deepEqual(
		[answer.sideways.uses.map((each: { name: string }) => each.name), answer.deeper?.within],
		[['Store'], 'src/store/db.ts'],
		'Sideways goes to the part its answer quotes, and Deeper to the file',
	)
	assert.ok(
		answer.questions.every((each: { id: string }) => each.id !== written.id) && answer.questions.length > 0,
		'its Questions are the other questions about Core',
	)
	assert.equal(answer.trust, "ken's model wrote the words. ken found each quoted line in git.")

	const after: Question[] = (await briefOf('part::Core')).questions
	assert.deepEqual(
		after.map((each) => [each.text, each.answered]),
		before.map((each) => [each.text, each.text === WRITTEN]),
		'only the question that was asked has an answer',
	)
})

test("a question the reader asks in their own words is listed under the concept as answered, after the ones ken's model wrote", async () => {
	await json(server, '/api/seen', { did: 'set', paths: ['src/core'], level: 'new' })
	const { knows } = await briefOf('part::Core')
	const lines = await ask(server, { lens: { kind: 'answer', concept: 'part::Core', text: `  ${OWN}  `, typed: true } })
	assert.ok(lines.find((line) => line.kind === 'asked').question.includes(knows.why), 'ken uses the corrected map')
	assert.deepEqual(
		(await json(server, '/api/notes')).notes.map((row: { text: string }) => row.text),
		[note],
	)
	const listed: Question[] = (await briefOf('part::Core')).questions
	assert.deepEqual(
		[listed.length, listed.at(-1)],
		[before.length + 1, { id: lines.at(-1).view.brief, text: OWN, answered: true }],
	)
	await server.close()
	const later = await openKen(root, home)
	const saved = listed.at(-1)?.id ?? ''
	assert.equal((await briefOf(saved, later)).line, 'No: run calls save one time.', 'with no model')
	const file = 'src/core/run.ts'
	const change = (text: string) => {
		writeFileSync(path.join(root, file), text)
		execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'edit core', '--', file], { cwd: root })
	}
	change(`// Moved down a line.\n${FILES[file]}`)
	assert.equal((await briefOf(saved, later)).staleFiles, undefined, 'moving a quote keeps the answer current')
	change(FILES[file].replace('save()', 'save(42)'))
	const stale = await briefOf(saved, later)
	assert.deepEqual(stale.staleFiles, [file], 'the saved answer names the file whose quote no longer matches')
	assert.deepEqual(stale.explain, { lens: { kind: 'answer', concept: 'part::Core', text: OWN } })
	assert.equal(stale.points[0].quotes[0].text, '\tsave()', 'the old answer keeps its original evidence')
	assert.deepEqual((await briefOf('part::Core', later)).staleFiles, [file])
	assert.equal((await briefOf(written.id, later)).staleFiles, undefined, 'another answer still matches the code')
})

test('a proposed tool call cannot answer a scoped question or complete its job', async () => {
	const proposed = '```json\n{"name":"ken__read_file","arguments":{"path":"src/core/run.ts"}}\n```'
	const provider = await scriptedModel([
		{ text: proposed },
		{ text: proposed },
		{ text: proposed },
		...brief('The code does not decide the delivery date.', {
			points: [point('The store throws when full.', 'src/store/db.ts', '\tthrow new Error("full")')],
		}),
	])
	const fresh = await openKen(root, readerHome(), provider.baseUrl)
	const lens = { kind: 'answer', concept: 'part::Core', text: 'When does it deliver?', typed: true }
	const first = await ask(fresh, { lens })
	const failed = first.find((line) => line.kind === 'saved').view
	assert.equal(failed.entry.outcome, 'incomplete')
	assert.equal(failed.brief, null)
	assert.deepEqual(failed.entry.retry, lens)
	assert.equal(provider.requests.length, 2, 'one repair attempt')
	assert.ok(!first.some((line) => line.kind === 'replied' || line.kind === 'item' || line.kind === 'text'))
	const jobs = await json(fresh, '/api/jobs', { looking: { brief: null, within: null } })
	assert.equal(jobs.jobs[0].state.kind, 'failed')
	const again = await ask(fresh, { lens: failed.entry.retry })
	assert.equal(again.at(-1).view.entry.outcome, 'answered')
	assert.equal(again.at(-1).view.entry.reply.items[0].text, 'The code does not decide the delivery date.')
	assert.equal(provider.requests.length, 4)
})

test('correcting a brief replaces a heading whose only quote failed', async () => {
	const model = await scriptedModel([
		...brief('Delivery takes two days.', {
			points: [point('It takes two days.', 'src/store/db.ts', 'return 2')],
		}),
		...brief('The code leaves delivery open.', {
			points: [point('The store throws when full.', 'src/store/db.ts', '\tthrow new Error("full")')],
		}),
	])
	const fresh = await openKen(root, readerHome(), model.baseUrl)
	const lines = await ask(fresh, { lens: { kind: 'answer', concept: 'part::Core', text: 'When does it deliver?' } })
	const headings = lines.flatMap((line) => (line.item?.kind === 'step' ? [line.item.text] : []))
	assert.deepEqual(headings, ['The code leaves delivery open.'])
	assert.equal(lines.at(-1).view.entry.reply.items[0].text, headings[0])
})
