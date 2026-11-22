import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

const names = (look: { boxes: { name: string }[] }) => look.boxes.map((box) => box.name)

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

	await ask(server, { question: 'What is here?' })
	const met = await wayIn()
	assert.equal(met.suggested, 'learn', 'nothing landed since the question')
	assert.notEqual(met.why, fresh.why, 'the reason no longer says ken has not met the reader')

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
