import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startChat } from '../../src/agent/index.ts'
import { buildRepository, type FixtureCommit } from '../fixtures/build-repository.ts'
import { scriptedModel, type Turn, toolResults } from '../fixtures/scripted-model.ts'

// The main line: a start, a pull request of two commits merged in, then 21 fixes, so the newest 20 leave out the
// merge and the start.
const commits: FixtureCommit[] = [
	{ message: 'feat: start', files: { 'a.ts': 'start\n' } },
	{ message: 'feat: the branch adds b', body: 'B comes first, since c needs it.', files: { 'b.ts': 'b\n' } },
	{ message: 'feat: the branch adds c', files: { 'c.ts': 'c\n' } },
	{ message: 'Merge pull request #7 from ada/letters', parent: 0, merge: 2, files: {} },
	...Array.from({ length: 21 }, (_, n) => ({ message: `fix: step ${n + 1}`, files: { 'a.ts': `step ${n + 1}\n` } })),
]
const { root, hashes } = buildRepository(commits)
const short = (hash: string | undefined) => (hash ?? '').slice(0, 12)
const [start, branchOne, branchTwo, merge] = hashes.map(short)
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

async function results(calls: Turn[]): Promise<string[]> {
	const model = await scriptedModel([...calls, { text: 'Done.' }])
	const started = await startChat({
		directory: root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	for await (const _event of started.chat.ask('What was the last pull request?')) {
	}
	await started.chat.close()
	return toolResults(model.requests.at(-1))
}

test('log without base lists the main line newest first, gives a merge the range it brought in, and pages to older commits; with that range it lists each commit, its files and its message by line', async () => {
	const [newest = '', older = '', range = ''] = await results([
		{ tool: 'ken__log', args: {} },
		{ tool: 'ken__log', args: { head: `${short(hashes[4])}^1` } },
		{ tool: 'ken__log', args: { base: start, head: merge } },
	])

	const listed = (text: string) => [...text.matchAll(/^([0-9a-f]{12}) /gm)].map((match) => match[1])
	assert.deepEqual(listed(newest), hashes.slice(5).reverse().map(short), 'the newest 20, newest first')
	assert.match(newest, new RegExp(`log with head ${short(hashes[5])}\\^1`), 'it says how to page to older commits')
	assert.deepEqual(listed(older), [merge, start], 'the branch commits are not on the main line')
	const mergeLine = older.split('\n').find((line) => line.startsWith(`${merge} `)) ?? ''
	assert.ok(mergeLine.includes(`${start}..${merge}`), `the merge names the range it brought in: ${mergeLine}`)
	assert.ok(!older.includes('For older commits'), 'the start is the oldest commit')

	assert.deepEqual(listed(range), [merge, branchTwo, branchOne])
	const filesAfter = (hash: string | undefined) =>
		range.split('\n')[range.split('\n').findIndex((line) => line.startsWith(`${hash} `)) + 1]
	assert.equal(filesAfter(branchTwo)?.trim(), 'c.ts', 'each commit in a range shows the files it changed')
	assert.equal(filesAfter(branchOne)?.trim(), 'b.ts')
	assert.ok(
		range.includes('  message:\n     1\tfeat: the branch adds b\n     2\t\n     3\tB comes first, since c needs it.'),
		`a commit with a body shows its whole message, numbered from the subject: ${range}`,
	)
})
