import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { type ChatRequest, scriptedModel, type Turn } from '../fixtures/scripted-model.ts'

const names = (look: { boxes: { name: string }[] }) => look.boxes.map((box) => box.name)

// What one question sent the model: the indexes ken starts it with, then the question.
function prompt(request: ChatRequest | undefined): string {
	const message = request?.messages.findLast((each) => each.role === 'user')
	return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content)
}

// A commit made now. The fixture's own commits are dated in January 2026 and are the owner's.
function commitNow(root: string, file: string, text: string, by = 'bo@example.com'): string {
	writeFileSync(path.join(root, file), text)
	const env = { ...process.env, GIT_AUTHOR_EMAIL: by, GIT_COMMITTER_EMAIL: by }
	execFileSync('git', ['add', '--all'], { cwd: root })
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', `edit ${file}`], {
		cwd: root,
		env,
	})
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

test('back to the picture before shows the parts as they were before a redraw, back again shows the redraw, and a level with one picture has none to go back to', async () => {
	const folders = ['a', 'b', 'c', 'd']
	const { root } = buildRepository([
		{ message: 'feat: start', files: Object.fromEntries(folders.map((each) => [`src/${each}/x.ts`, `${each}\n`])) },
	])
	const record = fileRecordStore(root, gitRepository(root))
	const part = (name: string, ...inside: string[]) => ({
		name,
		job: `does ${inside.join(' and ')}`,
		paths: inside.map((each) => `src/${each}`),
	})
	const draw = async (picture: { parts: ReturnType<typeof part>[]; about?: string; asked?: string }) => {
		const before = (await record.read()).current.findLast((entry) => entry.kind === 'layout')
		const drawn = await record.append([
			{ kind: 'layout', within: [], at: 'HEAD', arrows: [], ...picture, replaces: before?.id },
		])
		if (drawn.kind !== 'appended') assert.fail(drawn.problems.join(' '))
	}
	const server = await openKen(root, readerHome())

	const first = { parts: folders.map((each) => part(`Part ${each}`, each)), about: 'Four folders.', asked: 'one each' }
	await draw(first)
	const refused = await call(server, '/api/layout/back', { within: [] })
	assert.equal(refused.status, 409, refused.text)

	await draw({ parts: [part('Front', 'a', 'b'), part('Back', 'c', 'd')] })
	assert.deepEqual(names((await json(server, '/api/layout')).look), ['Front', 'Back'])

	const back = await json(server, '/api/layout/back', { within: [] })
	const firstNames = first.parts.map((each) => each.name)
	assert.deepEqual(names(back.look), firstNames)
	assert.ok(Array.isArray(back.changes), 'it answers as the layout does')
	const { look } = await json(server, '/api/layout')
	assert.deepEqual(names(look), firstNames, 'the earlier picture is the one that shows from now on')
	assert.deepEqual([look.named.about, look.named.asked], [first.about, first.asked])
	assert.equal(back.wayIn.facts.learn, '4 parts', 'a named level counts its parts, where a folder level counts folders')

	const again = await json(server, '/api/layout/back', { within: [] })
	assert.deepEqual(names(again.look), ['Front', 'Back'])
})

test("what landed since the reader's last commit leads the changes the layout offers, and picking it lays those commits over the picture", async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } }])
	const server = await openKen(root, readerHome())
	const kinds = async () => (await json(server, '/api/layout')).changes.map((each: { kind: string }) => each.kind)
	assert.equal((await kinds())[0], 'uncommitted', 'nothing landed, so there is nothing to catch up on')

	const head = commitNow(root, 'src/a/y.ts', 'y\n')
	const { changes } = await json(server, '/api/layout')
	assert.deepEqual(
		{ kind: changes[0].kind, change: changes[0].change, commits: changes[0].commits },
		{ kind: 'since', change: `${hashes[0]}..${head}`, commits: 1 },
	)
	assert.deepEqual(
		(await kinds()).slice(0, 3),
		['since', 'since', 'uncommitted'],
		'since the last commit and the last 7 days come before the changes the layout offered already',
	)
	const { look } = await json(server, `/api/layout?change=${encodeURIComponent(changes[0].change)}`)
	assert.equal(look.change.files, 1)
})

test('ken suggests learning to a reader it has not met, catching up once commits landed after their last question, and review while they have uncommitted work, with a fact for each way in', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'docs/d.md': 'd\n' } }])
	const model = await scriptedModel([{ text: 'It has code and docs.' }])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const wayIn = async () => (await json(server, '/api/layout')).wayIn

	const fresh = await wayIn()
	assert.equal(fresh.suggested, 'learn')
	assert.deepEqual(fresh.facts, { learn: '2 folders', 'catch-up': null, review: null })

	commitNow(root, 'src/a/w.ts', 'w\n')
	await ask(server, { question: 'What is here?' })
	const met = await wayIn()
	assert.equal(met.suggested, 'learn', 'a commit landed in the last days, but before the question')
	assert.notEqual(met.why, fresh.why, 'the reason no longer says ken has not met the reader')
	assert.match(met.facts['catch-up'], /^1 commit /, 'the fact still shows what landed in the last days')

	commitNow(root, 'src/a/y.ts', 'y\n')
	commitNow(root, 'src/a/z.ts', 'z\n')
	const landed = await wayIn()
	assert.equal(landed.suggested, 'catch-up')
	assert.match(landed.why, /\b2 commits\b/)
	assert.match(landed.facts['catch-up'], /^2 commits since /)
	assert.equal(landed.facts.review, 'Newest commit: edit src/a/z.ts')

	writeFileSync(path.join(root, 'src/a/x.ts'), 'x\nnot committed\n')
	const working = await wayIn()
	assert.equal(working.suggested, 'review')
	assert.match(working.why, /\b1 file\b/)
	assert.equal(working.facts.review, '1 file uncommitted')
	assert.match(working.facts['catch-up'], /^2 commits since /, 'each way in keeps its fact, whichever ken suggests')
})

test("ken suggests catching up on what landed since the reader's own last commit, though they never asked ken a question", async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } }])
	const server = await openKen(root, readerHome())
	commitNow(root, 'src/a/y.ts', 'y\n', OWNER.email)
	commitNow(root, 'src/a/z.ts', 'z\n')

	const { wayIn } = await json(server, '/api/layout')
	assert.equal(wayIn.suggested, 'catch-up')
	assert.match(wayIn.why, /\b1 commit\b/)
})

test('on a branch ahead of main ken suggests review, and says which branch and how many commits', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n' } }])
	execFileSync('git', ['checkout', '--quiet', '-b', 'feature-x'], { cwd: root })
	commitNow(root, 'src/a/y.ts', 'y\n')
	commitNow(root, 'src/a/z.ts', 'z\n')
	const server = await openKen(root, readerHome())

	const { wayIn } = await json(server, '/api/layout')
	assert.equal(wayIn.suggested, 'review')
	assert.match(wayIn.why, /feature-x.*\b2 commits\b/)
	assert.equal(wayIn.facts.review, '2 commits on feature-x')
})

test('a walk asked through the change lens is about that change though the model names none: the reply and its row carry the range and the steps, and a change with nothing in it never reaches the model', async () => {
	const retry = (body: string) => `export function retry() {\n${body}}\n`
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': retry('\tattempt()\n') } },
		{ message: 'feat: wait between attempts', files: { 'src/retry.ts': retry('\tattempt()\n\tsleep(100)\n') } },
	])
	const [base = '', head = ''] = hashes
	const step = (number: number, text: string, line: string): Turn => ({
		tool: 'ken__show',
		args: {
			step: { number, text },
			claims: [
				{
					text: 'retry.ts holds it.',
					label: 'inferred',
					quotes: [{ path: 'src/retry.ts', commit: 'HEAD', text: line }],
				},
			],
		},
	})
	const model = await scriptedModel([
		step(1, 'Each attempt now sleeps.', '\tsleep(100)'),
		step(2, 'The attempt itself is as it was.', '\tattempt()'),
		{ text: '' },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)

	const nothing = await call(server, '/api/questions', {
		lens: { kind: 'change', change: 'uncommitted', want: 'story' },
	})
	assert.equal(nothing.status, 422, nothing.text)

	const lines = await ask(server, { lens: { kind: 'change', change: `${base}..${head}`, want: 'walk' } })
	const [title, ...forAgent] = lines[0].question.split('\n')
	assert.ok(title.includes('feat: wait between attempts'), `the question names the change by its subject: ${title}`)
	assert.ok(forAgent.join(' ').includes(`${base.slice(0, 7)} to ${head.slice(0, 7)}`), 'the agent is told the range')
	const kinds = lines.map((line) => line.kind)
	assert.ok(
		kinds.includes('change') && kinds.indexOf('change') < kinds.indexOf('item'),
		'the page learns the range first',
	)
	const replied = lines.find((line) => line.kind === 'replied')
	assert.deepEqual([replied.reply.change.base, replied.reply.change.head], [base, head])

	const [row] = (await json(server, '/api/questions')).questions
	assert.deepEqual([row.change, row.steps], [{ base, head }, 2])
})

test('a level the reader asks to see another way is stored with their own words when the model draws it again, and the layout then shows the new parts and those words', async () => {
	const { root } = buildRepository([
		{
			message: 'feat: start',
			files: {
				'src/server/serve.ts': 'export const port = 80\n',
				'src/agent/answer.ts': 'export function answer() {}\n',
				'src/store/save.ts': 'export function save() {}\n',
			},
		},
	])
	const layout = {
		within: ['src'],
		parts: [
			{ name: 'Front', job: 'serves and answers', paths: ['src/server', 'src/agent'] },
			{ name: 'Store', job: 'saves', paths: ['src/store'] },
		],
	}
	const model = await scriptedModel([{ tool: 'ken__show', text: 'Two parts now.', args: { layout } }, { text: '' }])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const view = (text: string) => ({ lens: { kind: 'view', text, within: ['src'], name: null } })
	assert.equal((await call(server, '/api/questions', view(' '))).status, 400, 'the reader said nothing')
	assert.equal((await call(server, '/api/questions', view('x'.repeat(301)))).status, 400)

	const words = 'fewer parts, by what runs together'
	const lines = await ask(server, view(words))
	assert.ok(lines[0].question.split('\n')[0].endsWith(words), "the question leads with the reader's words")
	const { look } = await json(server, '/api/layout?within=src')
	assert.deepEqual(names(look), ['Front', 'Store'])
	assert.equal(look.named.asked, words)
})

test('a note the model keeps when the reader says how they want things shown is listed for the reader and starts each later question, until the reader removes it', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'src/a/x.ts': 'x\n', 'src/b/y.ts': 'y\n' } }])
	const note = 'Explain with examples from the tests.'
	const model = await scriptedModel([
		{ tool: 'ken__remember', args: { note }, text: 'I will keep that.' },
		{ text: 'From now on I explain with examples from the tests.' },
		{ text: 'a holds x.' },
		{ text: 'b holds y.' },
	])
	const server = await openKen(root, readerHome(), model.baseUrl)
	assert.deepEqual((await json(server, '/api/notes')).notes, [])

	await ask(server, { lens: { kind: 'view', text: 'explain with examples from the tests', within: [] } })
	const { notes } = await json(server, '/api/notes')
	assert.deepEqual(
		notes.map((each: { text: string }) => each.text),
		[note],
	)
	await ask(server, { question: 'What does a hold?' })
	assert.ok(prompt(model.requests[2]).includes(note), 'the next question starts with the note')

	const removed = await json(server, '/api/notes', { remove: notes[0].id })
	assert.deepEqual(removed.notes, [])
	await ask(server, { question: 'And b?' })
	assert.ok(!prompt(model.requests[3]).includes(note), 'a removed note no longer starts a question')
})
