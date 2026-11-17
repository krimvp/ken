import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { buildRepository, OWNER } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn, sentBackIn } from '../fixtures/chat-events.ts'
import { reply, scriptedModel, type Turn, toolResults, USAGE_PER_REPLY } from '../fixtures/scripted-model.ts'

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

const TRUE_QUOTE = { path: 'src/retry.ts', commit: 'HEAD', text: '\t\tsleep(100)' }
// Wrong indentation is the miss real models make most: the file indents with two tabs.
const FALSE_QUOTE = { path: 'src/retry.ts', commit: 'HEAD', text: '    sleep(100)' }
const claim = (quote: typeof TRUE_QUOTE, label = 'inferred') => ({
	text: 'The loop sleeps after each attempt.',
	label,
	quotes: [quote],
})

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

test("a plain question gets the model's own words as the reply, and what it wrote while it read is a step", async () => {
	const { events } = await ask([
		{ tool: 'ken__read_file', args: { path: 'src/retry.ts' }, text: 'Let me read the retry loop.' },
		{ text: 'Each retry now waits 100 ms before the next attempt.' },
	])

	assert.deepEqual(replyIn(events).items, [
		{ kind: 'words', text: 'Each retry now waits 100 ms before the next attempt.' },
	])
	assert.deepEqual(
		events.flatMap((event) => (event.kind === 'step' ? [event.step] : [])),
		[{ kind: 'text', text: 'Let me read the retry loop.' }],
	)
	assert.deepEqual(events.at(-1), { kind: 'done', outcome: 'answered' })
	const usage = events.find((event) => event.kind === 'usage')
	assert.equal(usage?.kind === 'usage' && usage.inputTokens, 2 * USAGE_PER_REPLY.prompt_tokens)
})

test('a show call with a good card, a false quote and a label the quotes do not allow shows the good card after the words, and sends back only the bad two, each with its problem', async () => {
	const { events, requests } = await ask(
		reply('Each retry now waits before the next attempt.', {
			scope: { base, head: 'HEAD' },
			claims: [claim(TRUE_QUOTE, 'found-by-search'), claim(FALSE_QUOTE), claim(TRUE_QUOTE, 'recorded')],
		}),
	)

	assert.deepEqual(
		replyIn(events).items.map((item) => (item.kind === 'words' ? item.text : item.card.kind)),
		['Each retry now waits before the next attempt.', 'claim'],
	)
	const [shown] = cardsIn(events)
	assert.deepEqual(shown?.kind === 'claim' && shown.claim, {
		text: 'The loop sleeps after each attempt.',
		label: 'found-by-search',
		quotes: [{ path: 'src/retry.ts', commit: head, startLine: 4, endLine: 4, text: '\t\tsleep(100)' }],
	})
	assert.deepEqual(
		sentBackIn(events).map((step) => step.what),
		['Claim 2', 'Claim 3'],
	)
	const toModel = toolResults(requests[1])[0] ?? ''
	assert.match(toModel, /Claim 2 sent back/)
	assert.ok(toModel.includes(JSON.stringify('\t\tsleep(100)')), `the model is shown the line with its tabs: ${toModel}`)
	assert.match(toModel, /Claim 3 sent back/)
	assert.deepEqual(events.at(-1), { kind: 'done', outcome: 'answered' })

	const { change } = replyIn(events)
	assert.deepEqual(change, {
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
	})
})

test('after six cards sent back, show checks nothing more and says so, and the words still reach the reader', async () => {
	const bad = Array.from({ length: 7 }, () => claim(FALSE_QUOTE))
	const { events, requests } = await ask([
		{ tool: 'ken__show', args: { claims: bad } },
		{ tool: 'ken__show', args: { claims: [claim(TRUE_QUOTE)] } },
		{ text: 'The loop sleeps after each attempt, but I could not quote it.' },
	])

	assert.equal(sentBackIn(events).length, 6)
	assert.match(toolResults(requests[1])[0] ?? '', /Claim 7 was not checked\. ken has sent back 6 cards/)
	assert.match(toolResults(requests[2]).at(-1) ?? '', /checks no more/)
	assert.deepEqual(replyIn(events).items, [
		{ kind: 'words', text: 'The loop sleeps after each attempt, but I could not quote it.' },
	])
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

test('a reply about a branch that is behind main covers only the hunks the branch changed', async () => {
	const branch = buildRepository([
		{ message: 'feat: start', files: { 'a.ts': 'one\n', 'b.ts': 'two\n' } },
		{ message: 'feat: the branch adds a line', files: { 'a.ts': 'one\nbranch\n' } },
		{ message: 'feat: main moves on', parent: 0, files: { 'b.ts': 'two\nmain\n' } },
	])
	const [start = '', branchTip = '', mainTip = ''] = branch.hashes
	const { events } = await ask(
		reply('The branch adds one line to a.ts.', {
			scope: { base: mainTip, head: branchTip },
			claims: [
				{
					text: 'a.ts gains a line.',
					label: 'inferred',
					quotes: [{ path: 'a.ts', commit: branchTip, text: 'branch' }],
				},
			],
		}),
		branch.root,
	)

	const { change } = replyIn(events)
	assert.equal(change?.base, start, 'the change starts where the branch split from main')
	assert.deepEqual(
		[...(change?.covered ?? []), ...(change?.uncovered ?? [])].map((hunk) => hunk.path),
		['a.ts'],
	)
})

test('a stop pressed while the reply is being saved still ends the question, and the chat takes the next one', {
	timeout: 20_000,
}, async () => {
	// Two hundred changed files make saving the reply slow enough for the stop to land while it runs.
	const files: Record<string, string> = { 'src/retry.ts': `${RETRY}\t\tsleep(100)\n\t}\n}\n` }
	for (let at = 0; at < 200; at++) files[`src/use-${at}.ts`] = `export const wait${at} = retry(${at})\n`
	const big = buildRepository([
		{ message: 'feat: start', files: { 'src/retry.ts': `${RETRY}\t}\n}\n` } },
		{ message: 'feat: wait, and use retry everywhere', files },
	])
	const [from = '', to = ''] = big.hashes
	const sleep = { path: 'src/retry.ts', commit: to, text: '\t\tsleep(100)' }
	const model = await scriptedModel([
		{ tool: 'ken__show', args: { scope: { base: from, head: to }, claims: [claim(sleep)] } },
		{ text: 'Retries wait.' },
		{ text: 'Still here.' },
	])
	const started = await startChat({
		directory: big.root,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const stop = new AbortController()
	const stopped: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the last commit do?', stop.signal)) {
		stopped.push(event)
		// The words end the talk. The reply is saved in the tasks that follow, so the stop lands while it is saved.
		if (event.kind === 'item' && event.item.kind === 'words') setTimeout(() => stop.abort(), 0)
	}
	const next: ChatEvent[] = []
	for await (const event of started.chat.ask('Are you there?')) next.push(event)
	await started.chat.close()

	assert.ok(
		['done', 'error'].includes(stopped.at(-1)?.kind ?? ''),
		`the stopped question ends: ${stopped.map((e) => e.kind)}`,
	)
	assert.deepEqual(replyIn(next).items, [{ kind: 'words', text: 'Still here.' }])
})
