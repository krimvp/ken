import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'
import {
	NOTHING_TO_REVISE,
	scriptedModel,
	type Turn,
	toolResults,
	USAGE_PER_REPLY,
} from '../fixtures/scripted-model.ts'

const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {\n\t\tattempt()\n'
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n`, 'README.md': '# demo\n' } },
	{
		message: 'feat: wait between attempts',
		files: {
			'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n`,
			'README.md': '# demo\n\nRetries wait 100 ms.\n',
		},
	},
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

function answer(quote: { path: string; commit: string; text: string }, label = 'inferred'): Turn {
	return {
		tool: 'ken__answer',
		args: {
			scope: { base, head: 'HEAD' },
			summary: 'Each retry now waits before the next attempt.',
			statements: [{ text: 'The loop sleeps after each attempt.', label, quotes: [quote] }],
			risks: [],
		},
	}
}
const TRUE_QUOTE = { path: 'src/retry.ts', commit: 'HEAD', text: '\t\tsleep(100)' }
// Wrong indentation is the miss real models make most: the file indents with two tabs.
const FALSE_QUOTE = { path: 'src/retry.ts', commit: 'HEAD', text: '    sleep(100)' }

async function ask(script: Turn[], directory = path.join(root, 'src')) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the last commit do?')) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

test('a false quote is rejected with its reasons sent to the model, and a true quote then gets a checked answer', async () => {
	const { events, requests } = await ask([
		answer(FALSE_QUOTE),
		answer(TRUE_QUOTE),
		...NOTHING_TO_REVISE,
		{ text: 'I left out the README.' },
	])

	assert.deepEqual(
		events.filter((event) => event.kind !== 'text').map((event) => event.kind),
		['tool', 'rejected', 'tool', 'tool', 'accepted', 'usage', 'done'],
	)
	assert.equal(events.map((event) => (event.kind === 'text' ? event.delta : '')).join(''), 'I left out the README.')
	const toModel = toolResults(requests[1])[0] ?? ''
	assert.ok(toModel.includes('src/retry.ts'), `the model is told which quote failed: ${toModel}`)
	assert.ok(toModel.includes(JSON.stringify('\t\tsleep(100)')), `the model is shown the line with its tabs: ${toModel}`)
	assert.deepEqual(events.at(-1), { kind: 'done', outcome: 'answered' })
	const usage = events.find((event) => event.kind === 'usage')
	assert.deepEqual(
		[usage?.kind === 'usage' && usage.inputTokens, usage?.kind === 'usage' && usage.outputTokens],
		[5 * USAGE_PER_REPLY.prompt_tokens, 5 * USAGE_PER_REPLY.completion_tokens],
	)

	const accepted = events.find((event) => event.kind === 'accepted')
	assert.deepEqual(accepted?.kind === 'accepted' && accepted.answer, {
		summary: 'Each retry now waits before the next attempt.',
		statements: [
			{
				text: 'The loop sleeps after each attempt.',
				label: 'inferred',
				quotes: [{ path: 'src/retry.ts', commit: head, startLine: 4, endLine: 4, text: '\t\tsleep(100)' }],
			},
		],
		risks: [],
		topics: [],
		diagrams: [],
		change: {
			base,
			head,
			commits: [
				{
					hash: head,
					parents: [base],
					author: OWNER.name,
					email: OWNER.email,
					date: '2026-01-02T00:00:00.000Z',
					subject: 'feat: wait between attempts',
					coAuthors: [],
					paths: ['README.md', 'src/retry.ts'],
				},
			],
			covered: [
				{
					path: 'src/retry.ts',
					oldPath: 'src/retry.ts',
					hunk: { oldStart: 3, oldLength: 0, newStart: 4, newLength: 1, lines: ['+\t\tsleep(100)'] },
				},
			],
			uncovered: [
				{
					path: 'README.md',
					oldPath: 'README.md',
					hunk: { oldStart: 1, oldLength: 0, newStart: 2, newLength: 2, lines: ['+', '+Retries wait 100 ms.'] },
				},
			],
			binary: [],
			messages: { quoted: [], unquoted: [head] },
			usedElsewhere: { followed: [], notFollowed: [] },
		},
	})
})

test('a model that keeps sending false quotes ends with no checked answer after three rejections', async () => {
	const { events, requests } = await ask([
		answer(FALSE_QUOTE),
		answer({ ...FALSE_QUOTE, text: 'sleep(1000)' }),
		answer({ ...FALSE_QUOTE, path: 'src/missing.ts' }),
		answer(TRUE_QUOTE),
	])

	assert.deepEqual(
		events.flatMap((event) => (event.kind === 'rejected' ? [event.attempt] : [])),
		[1, 2, 3],
	)
	assert.equal(
		events.some((event) => event.kind === 'accepted'),
		false,
	)
	assert.deepEqual(events.at(-1), { kind: 'done', outcome: 'rejected' })
	assert.equal(requests.length, 3, 'the model is not asked again after the last rejection')
})

test('a label this slice does not allow is refused, and an allowed one is kept', async () => {
	const { events } = await ask([
		answer(TRUE_QUOTE, 'recorded'),
		answer(TRUE_QUOTE, 'found-by-search'),
		{ text: 'Done.' },
	])

	assert.deepEqual(
		events.filter((event) => event.kind === 'rejected' || event.kind === 'accepted').map((event) => event.kind),
		['rejected', 'accepted'],
	)
	const accepted = events.find((event) => event.kind === 'accepted')
	assert.equal(accepted?.kind === 'accepted' && accepted.answer.statements[0]?.label, 'found-by-search')
})

test('a ref or path that starts with "-" or leaves the repository is refused and never reaches git', async () => {
	const outside = path.join(path.dirname(root), `ken-outside-${path.basename(root)}.txt`)
	writeFileSync(outside, 'outside secret\n')
	after(() => rmSync(outside, { force: true }))
	const written = path.join(root, 'written-by-git.txt')
	const option = `--output=${written}`
	const calls: Turn[] = [
		{ tool: 'ken__read_file', args: { path: `../${path.basename(outside)}` } },
		{ tool: 'ken__read_file', args: { path: '-p' } },
		{ tool: 'ken__read_file', args: { path: 'src/retry.ts', commit: option } },
		{ tool: 'ken__list_files', args: { under: '..' } },
		{ tool: 'ken__search', args: { pattern: 'secret', commit: option } },
		{ tool: 'ken__search', args: { pattern: 'secret', under: '../' } },
		{ tool: 'ken__log', args: { base: option, head: 'HEAD' } },
		{ tool: 'ken__log', args: { head: option } },
		{ tool: 'ken__log', args: { base: option } },
		{ tool: 'ken__diff', args: { base: 'HEAD~1', head: option } },
		{ tool: 'ken__diff', args: { base: 'HEAD~1', head: 'HEAD', path: '-R' } },
		{ tool: 'ken__blame', args: { path: outside, start: 1, end: 1 } },
		{ tool: 'ken__resolve_ref', args: { ref: option } },
	]
	const { requests } = await ask([...calls, { text: 'Nothing to read.' }])

	const results = toolResults(requests.at(-1))
	assert.equal(results.length, calls.length)
	for (const [index, result] of results.entries()) {
		assert.match(result, /^Refused/, `call ${index + 1} is refused: ${result}`)
		assert.ok(!result.includes('outside secret'), `call ${index + 1} shows nothing from outside the repository`)
	}
	assert.equal(existsSync(written), false, 'git never ran with an option the model wrote')
})

test('an answer about a branch that is behind main covers only the hunks the branch changed', async () => {
	const branch = buildRepository([
		{ message: 'feat: start', files: { 'a.ts': 'one\n', 'b.ts': 'two\n' } },
		{ message: 'feat: the branch adds a line', files: { 'a.ts': 'one\nbranch\n' } },
		{ message: 'feat: main moves on', parent: 0, files: { 'b.ts': 'two\nmain\n' } },
	])
	const [start = '', branchTip = '', mainTip = ''] = branch.hashes
	const { events } = await ask(
		[
			{
				tool: 'ken__answer',
				args: {
					scope: { base: mainTip, head: branchTip },
					summary: 'The branch adds one line to a.ts.',
					risks: [],
					statements: [
						{
							text: 'a.ts gains a line.',
							label: 'inferred',
							quotes: [{ path: 'a.ts', commit: branchTip, text: 'branch' }],
						},
					],
				},
			},
			{ text: 'Done.' },
		],
		branch.root,
	)

	const accepted = events.find((event) => event.kind === 'accepted')
	const change = accepted?.kind === 'accepted' ? accepted.answer.change : null
	assert.equal(change?.base, start, 'the change starts where the branch split from main')
	assert.deepEqual(
		[...(change?.covered ?? []), ...(change?.uncovered ?? [])].map((hunk) => hunk.path),
		['a.ts'],
	)
})
