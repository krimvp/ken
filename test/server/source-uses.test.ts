import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { ask, call, json, openKen, readerHome } from '../fixtures/ken-server.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

test('a source question about consumers brings in lines from files that import the selection at the displayed revision', async () => {
	const { root, hashes } = buildRepository([
		{
			message: 'Add the pickup schedule',
			files: {
				'src/pickup.js': 'export function pickupDay(date) {\n  const pickup = date\n  return pickup\n}\n',
				'src/booking.js':
					"import { pickupDay } from './pickup.js'\nexport const booking = date => ({ pickup: pickupDay(date) })\n",
				'src/receipt.js':
					"import { pickupDay as day } from './pickup.js'\nexport const receipt = date => 'Pickup: ' + day(date)\n",
				'other/pickup.js': 'export function pickupDay() {}\n',
				'other/unrelated.js': "import { pickupDay } from './pickup.js'\npickupDay()\n",
			},
		},
		{ message: 'Remove the receipt', files: { 'src/receipt.js': null } },
	])
	const model = await scriptedModel([{ text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }])
	const server = await openKen(root, readerHome(), model.baseUrl)
	const focus = { path: 'src/pickup.js', commit: hashes[0], start: 1, end: 2 }
	const question = 'Can you explain what is happening here, and where that value goes next?'
	await ask(server, { question, focus })
	await ask(server, { question, focus: { ...focus, commit: hashes[1] } })
	await ask(server, { question: 'What does the function return?', focus })
	await ask(server, { question: 'Where is receiptPrinter used?', focus })
	const openings = model.requests.map(
		(request) => String(request.messages.at(-1)?.content).split('Earlier in this chat.')[0] ?? '',
	)
	assert.match(openings[0] ?? '', /3\t" {2}return pickup/)
	assert.match(openings[0] ?? '', /src\/booking\.js[\s\S]*pickup: pickupDay\(date\)/)
	assert.match(openings[0] ?? '', /src\/receipt\.js[\s\S]*Pickup: ' \+ day\(date\)/)
	assert.doesNotMatch(openings[0] ?? '', /other\/unrelated\.js/)
	assert.doesNotMatch(openings[1] ?? '', /src\/receipt\.js/)
	assert.doesNotMatch(openings[3] ?? '', /src\/booking\.js|src\/receipt\.js/)
	assert.doesNotMatch(openings[2] ?? '', /src\/booking\.js|src\/receipt\.js|return pickup/)
})

test('a reader can follow direct imports without a model, including unique TypeScript paths', async () => {
	const { root, hashes } = buildRepository([
		{
			message: 'Place the fee policy',
			files: {
				'fees/index.ts': 'export const fee = 0.1\nexport const note = "published"\n\n  // Unrelated reader note.\n',
				'quote.ts': "import { fee } from './fees'\nexport const quote = total => total * fee\n",
				'receipt.ts': "import { fee as rate } from './fees/index.js'\nexport const receipt = total => total * rate\n",
				'other.ts': "import { fee } from './another'\nexport const other = fee\n",
			},
		},
		{
			message: 'Add competing modules',
			files: { 'fees.ts': 'export const fee = 0.9\n', 'fees/index.js': 'export const fee = 0.5\n' },
		},
	])
	const server = await openKen(root, readerHome())
	const source = (commit: string | undefined) => `/api/source?path=fees/index.ts&start=1&at=${commit}`
	const page = await json(server, source(hashes[0]))
	assert.deepEqual(page.names, ['fee', 'note'])
	assert.equal(page.uses, null)
	const after = await json(server, source(hashes[0]).replace('start=1', 'start=3'))
	assert.deepEqual(after.names, [])
	const earlier = await json(server, `${source(hashes[0])}&uses=fee`)
	assert.deepEqual(
		earlier.uses.lines.map((hit: { path: string; line: number }) => [hit.path, hit.line]),
		[
			['quote.ts', 1],
			['quote.ts', 2],
			['receipt.ts', 1],
			['receipt.ts', 2],
		],
	)
	const changed = await json(server, `${source(hashes[1])}&uses=fee`)
	assert.deepEqual(changed.uses.lines, [])
	assert.equal((await call(server, `${source(hashes[0])}&uses=other`)).status, 400)
})

test('a tool request printed as the entire source reply gives the reader a way on without running it', async () => {
	const { root, hashes } = buildRepository([
		{
			message: 'Add a fee',
			files: {
				'fees.js': 'export const fee = 42\nexport const unrelated = 1\n',
				'quote.js': "import { fee } from './fees.js'\nexport const quote = fee\n",
			},
		},
	])
	const home = readerHome()
	const proposed = '```\n{\n  "name": "ken__resolve_ref",\n  "arguments": {\n    "ref": "HEAD~2"\n  }\n}\n```'
	const explained = `For example:\n${proposed}`
	const bare = JSON.stringify({ name: 'ken__resolve_ref', arguments: { ref: 'HEAD~2' } })
	const model = await scriptedModel([{ text: proposed }, { text: explained }, { text: proposed }, { text: bare }])
	const server = await openKen(root, home, model.baseUrl)
	const question = 'Where is this check actually used? Show me a caller and what a failed check would mean there.'
	const focus = { path: 'fees.js', commit: hashes[0], start: 1, end: 1 }
	const events = await ask(server, { question, focus })
	const entry = events.at(-1)?.view.entry
	assert.equal(entry.outcome, 'tool-proposal')
	assert.equal(entry.reply, undefined)
	assert.equal(
		events.some((event) => ['item', 'tool', 'replied'].includes(event.kind)),
		false,
	)
	const lead = await json(server, `/api/source?path=fees.js&at=${hashes[0]}&start=1&uses=@1`)
	assert.equal(lead.uses.name, 'fee')
	assert.deepEqual(
		lead.uses.lines.map((hit: { line: number }) => hit.line),
		[1, 2],
	)
	assert.equal(model.requests.length, 1)
	const related = await ask(server, { question: 'Explain the next part.', focus })
	assert.equal(related.at(-1)?.view.entry.reply.items[0].text, explained)
	assert.ok(!JSON.stringify(model.requests[1]?.messages.at(-1)).includes('HEAD~2'))
	const example = await ask(server, { question: 'Show an example JSON tool call.', focus })
	assert.equal(example.at(-1)?.view.entry.reply.items[0].text, proposed)
	const payload = await ask(server, { question: 'Which service receives this payload?', focus })
	assert.equal(payload.at(-1)?.view.entry.outcome, 'tool-proposal')
	// An older saved run of the same question gets the same outcome on reopen.
	const legacy = {
		...entry,
		id: 'older-source-question',
		outcome: 'unverified',
		recorded: [],
		reply: {
			items: [{ kind: 'words', text: proposed }],
			change: null,
			topics: [],
		},
	}
	await appendFile(join(home, 'projects', hashes[0] ?? '', 'history.jsonl'), `${JSON.stringify(legacy)}\n`)
	const reopened = await json(server, '/api/questions/older-source-question')
	assert.equal(reopened.entry.outcome, 'tool-proposal')
	assert.equal(reopened.entry.reply, undefined)
	assert.equal(model.requests.length, 4)
})

test('a general question answered only with adjacent tool requests has no explanation to recall', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'Add scheduling', files: { 'pickup.js': 'export const pickup = 1\n' } },
	])
	const home = readerHome()
	const question = 'Explain Schedule and help me decide what to read next.'
	const requests = ['ken__layout', 'ken__brief']
		.map((name) =>
			['```json', JSON.stringify({ name: 'core__load_skill', arguments: { name } }, null, 2), '```'].join('\n'),
		)
		.join('\n\n')
	const mixed = `Here is how a developer might load these skills.\n\n${requests}`
	const model = await scriptedModel([{ text: requests }, { text: requests }, { text: mixed }])
	const server = await openKen(root, home, model.baseUrl)
	const lines = await ask(server, { question })
	const failed = lines.at(-1)?.view.entry
	assert.equal(failed.outcome, 'tool-proposal')
	assert.equal(failed.reply, undefined)
	assert.equal(
		lines.some((event) => ['item', 'tool', 'replied'].includes(event.kind)),
		false,
	)
	assert.equal(model.requests.length, 1)
	const earlier = {
		...failed,
		id: 'earlier-schedule',
		outcome: 'answered',
		recorded: [],
		reply: {
			change: null,
			topics: [],
			items: [{ kind: 'words', text: requests }],
		},
	}
	await appendFile(join(home, 'projects', hashes[0] ?? '', 'history.jsonl'), `${JSON.stringify(earlier)}\n`)
	const reopened = await json(server, '/api/questions/earlier-schedule')
	assert.equal(reopened.entry.outcome, 'tool-proposal')
	assert.equal(reopened.entry.reply, undefined)
	assert.equal(model.requests.length, 1)
	const example = await ask(server, { question: 'Show me examples of tool calls.' })
	assert.equal(example.at(-1)?.view.entry.reply.items[0].text, requests)
	const ordinary = await ask(server, { question })
	assert.equal(ordinary.at(-1)?.view.entry.reply.items[0].text, mixed)
	assert.equal(model.requests.length, 3)
})
