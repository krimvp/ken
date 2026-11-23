import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

test('catch-up after a restart starts at the last personal question, even after Ken has prepared a brief', async () => {
	const file = 'src/retry.ts'
	const { root, hashes } = buildRepository([
		{ message: 'Start retries', files: { [file]: 'retry(1)\n', 'test/retry.ts': 'expectRetry()\n' } },
		{ message: 'Allow two tries', files: { [file]: 'retry(2)\n' } },
	])
	const [old, current] = hashes
	assert.ok(old && current)
	const home = readerHome()
	const model = await scriptedModel([
		{ text: 'One try.' },
		{
			tool: 'ken__show',
			args: {
				brief: {
					number: 1,
					line: 'Runs retries.',
					points: [
						{
							line: 'Two tries.',
							more: 'Allows two tries.',
							long: 'The worker allows two tries.',
							drawing: { kind: 'dot' },
							quotes: [{ path: file, text: 'retry(2)' }],
						},
					],
				},
			},
		},
		{ hang: () => {} },
	])
	execFileSync('git', ['switch', '--detach', old], { cwd: root, stdio: 'ignore' })
	const first = await openKen(root, home, model.baseUrl)
	await ask(first, { question: 'How many tries?' })
	await first.close()
	execFileSync('git', ['switch', 'main'], { cwd: root, stdio: 'ignore' })
	const record = fileRecordStore(root, gitRepository(root))
	const named = await record.append([
		{
			kind: 'layout',
			within: [],
			at: 'HEAD',
			parts: [
				{ name: 'Retries', job: 'Runs retries.', paths: [file] },
				{ name: 'Tests', job: 'Checks retries.', paths: ['test'] },
			],
			arrows: [],
		},
	])
	if (named.kind !== 'appended') assert.fail(named.problems.join(' '))
	const preparing = await openKen(root, home, model.baseUrl, { KEN_BACKGROUND: 'on' })
	const deadline = Date.now() + 12000
	while ((await json(preparing, '/api/questions')).questions.length < 2) {
		assert.ok(Date.now() < deadline, 'the autonomous brief must finish')
		await sleep(40)
	}
	await preparing.close()
	const later = await scriptedModel([{ text: 'Here is what changed.' }])
	const returning = await openKen(root, home, later.baseUrl)
	const events = await ask(returning, { lens: { kind: 'catch-up' } })
	const text = events.find((line) => line.kind === 'asked')?.question ?? ''
	assert.ok(text.includes(`last question at ${old.slice(0, 7)}`) && text.includes(current.slice(0, 7)), text)
})

test('Go deeper on an earlier reply follows that answer when the reader has since discussed another subject', async () => {
	const { root } = buildRepository([{ message: 'Start checkout', files: { 'order.ts': 'startOrder()\n' } }])
	const home = readerHome()
	const model = await scriptedModel([
		{ text: 'Receipt from the cedar printer.' },
		{ text: 'Sorter with lime labels.' },
		{ text: 'Here is the receipt.' },
	])
	const first = await openKen(root, home, model.baseUrl)
	const earlier = (await ask(first, { question: 'What happens at checkout?' })).at(-1)?.view.entry
	await first.close()
	const later = await openKen(root, home, model.baseUrl)
	await ask(later, { question: 'Describe the sorter.' })
	const deeper = (
		await ask(later, { lens: { kind: 'deeper', topics: ['checkout'], question: earlier.question }, after: earlier.id })
	).at(-1)?.view.entry
	assert.equal(deeper.thread, earlier.thread)
	assert.equal(deeper.after, earlier.id)
	const prompt = JSON.stringify(model.requests.at(-1)?.messages)
	assert.match(prompt, /cedar printer/)
	assert.doesNotMatch(prompt, /lime labels/)
})
