import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cardsIn, replyIn } from '../fixtures/chat-events.ts'
import {
	type ChatRequest,
	nothingToRevise,
	scriptedModel,
	type Turn,
	toolResults,
	USAGE_PER_REPLY,
} from '../fixtures/scripted-model.ts'

// The change lowers a limit. A caller in a file the change did not touch still waits twice the limit.
const CALLER = 'export async function load() {\n\treturn await fetchWithin(TIMEOUT_MS * 2)\n}\n'
// The fixture dates every commit, so a copy has the same hashes. A test that records a piece of work uses its own copy:
// the record would then explain the change for the tests after it.
const COMMITS = [
	{ message: 'feat: start', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 500\n', 'src/load.ts': CALLER } },
	{ message: 'fix: time out sooner', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 100\n' } },
]
const { root, hashes } = buildRepository(COMMITS)
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const LIMIT = { path: 'src/limits.ts', commit: head, text: 'export const TIMEOUT_MS = 100' }
const CALL = { path: 'src/load.ts', commit: head, text: '\treturn await fetchWithin(TIMEOUT_MS * 2)' }
const STATEMENT = { text: 'The timeout drops from 500 ms to 100 ms.', label: 'inferred', quotes: [LIMIT] }
const FIRST_RISK = {
	text: 'Every request now fails five times sooner.',
	label: 'inferred',
	quotes: [LIMIT],
	weight: 'minor',
}
const SECOND_RISK = { text: 'A slow network now times out.', label: 'inferred', quotes: [LIMIT], weight: 'serious' }
const CALLER_RISK = {
	text: 'load still waits 200 ms, twice the new limit.',
	label: 'inferred',
	quotes: [CALL],
	weight: 'serious',
}

function show(args: Record<string, unknown>): Turn {
	return { tool: 'ken__show', text: 'The timeout is shorter.', args: { claims: [STATEMENT], ...args } }
}
const ABOUT_THE_CHANGE = { scope: { base, head }, work: { title: 'Time out sooner' } }

async function ask(script: Turn[], as: 'question' | 'note' = 'question', directory = root) {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory,
		model: { model: 'scripted', baseUrl: model.baseUrl, apiKeyEnv: KEY_ENV },
		env: {},
	})
	if (started.kind !== 'ok') throw new Error(started.message)
	const events: ChatEvent[] = []
	for await (const event of started.chat.ask('What did the last commit do?', undefined, as)) events.push(event)
	await started.chat.close()
	return { events, requests: model.requests }
}

function risks(events: ChatEvent[]) {
	return cardsIn(events).flatMap((card) => (card.kind === 'risk' ? [card.risk] : []))
}

function withdrawn(events: ChatEvent[]) {
	return cardsIn(events).flatMap((card) => (card.kind === 'withdrawn' ? [card.withdrawn] : []))
}

const SECOND_LOOK = 'ken checked the risks you sent'

function userTexts(request: ChatRequest | undefined): string[] {
	return (request?.messages ?? [])
		.filter((message) => message.role === 'user')
		.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
}

test('log and diff over a change end with the names used elsewhere, once per question, and the reply names those no quote follows', async () => {
	const { events, requests } = await ask([
		{ tool: 'ken__diff', args: { base, head } },
		{ tool: 'ken__log', args: { base, head } },
		// No work title, so the record keeps nothing that would spare the next test's change its second look.
		show({ scope: { base, head } }),
		{ text: '' },
	])

	const diff = toolResults(requests[1])[0] ?? ''
	assert.ok(diff.includes('TIMEOUT_MS') && diff.includes(`src/load.ts:2: ${CALL.text.trim()}`), `the diff: ${diff}`)
	assert.ok(
		!(toolResults(requests[2])[1] ?? '').includes('src/load.ts:2'),
		'the log of the same range does not repeat it',
	)
	const { change } = replyIn(events)
	assert.deepEqual(change?.usedElsewhere, {
		followed: [],
		notFollowed: [
			{ name: 'TIMEOUT_MS', how: 'altered', places: 1, first: [{ path: 'src/load.ts', line: 2, text: CALL.text }] },
		],
	})
})

test('log over a change and the second look list the later commits on its files: a later fix comes first, with the first lines of its message', async () => {
	const later = buildRepository([
		{ message: 'feat: start', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 500\n', 'README.md': 'Limits.\n' } },
		{ message: 'fix: time out sooner', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 100\n' } },
		{ message: 'feat: name the limit', files: { 'src/limits.ts': '// The limit.\nexport const TIMEOUT_MS = 100\n' } },
		{
			message: 'fix: wait longer on a slow network',
			body: 'A limit of 100 ms timed out every request on a slow network.\nThe limit is 300 ms now.',
			files: { 'src/limits.ts': '// The limit.\nexport const TIMEOUT_MS = 300\n' },
		},
		{ message: 'fix: a typo in the README', files: { 'README.md': 'The limits.\n' } },
	])
	const [start = '', change = ''] = later.hashes
	const quote = { path: 'src/limits.ts', commit: change, text: 'export const TIMEOUT_MS = 100' }
	const { requests } = await ask(
		[
			{ tool: 'ken__log', args: { base: start, head: change } },
			{
				tool: 'ken__show',
				args: {
					scope: { base: start, head: change },
					claims: [{ text: 'The timeout drops to 100 ms.', label: 'inferred', quotes: [quote] }],
					risks: [{ text: 'A slow network times out.', label: 'inferred', quotes: [quote], weight: 'serious' }],
				},
			},
			{ text: '' },
			...nothingToRevise(1),
		],
		'question',
		later.root,
	)

	const pass = userTexts(requests.at(-1)).find((text) => text.includes(SECOND_LOOK)) ?? ''
	const seen: [string, string][] = [
		['the log of the change', toolResults(requests[1])[0] ?? ''],
		['the second look', pass],
	]
	for (const [what, text] of seen) {
		const fix = text.indexOf('fix: wait longer on a slow network')
		assert.ok(fix > 0 && fix < text.indexOf('feat: name the limit'), `${what} lists the later fix first: ${text}`)
		assert.ok(text.includes('A limit of 100 ms timed out every request on a slow network.'), `${what}: ${text}`)
		assert.ok(!text.includes('a typo in the README'), `${what} leaves out a later commit on other files`)
	}
})

test('risks of a question not about a change, and of a live note about one, show at once with no second look, and a note gets no list of names used elsewhere', async () => {
	// Each script has one turn more than it needs, which only a second look would use.
	const spare: Turn = { text: 'A second look would get this.' }
	const now = await ask([show({ risks: [FIRST_RISK] }), { text: '' }, spare])
	assert.equal(now.requests.length, 2, 'the reply and the end of its turn, nothing more')
	assert.deepEqual(
		risks(now.events).map((risk) => risk.text),
		[FIRST_RISK.text],
	)

	const note = await ask(
		[
			{ tool: 'ken__diff', args: { base, head } },
			show({ scope: { base, head }, risks: [FIRST_RISK] }),
			{ text: '.' },
			spare,
		],
		'note',
	)
	assert.equal(note.requests.length, 3)
	assert.equal(risks(note.events).length, 1)
	assert.ok(!(toolResults(note.requests[1])[0] ?? '').includes('src/load.ts:2'), 'a note reads the diff alone')
	assert.equal(userTexts(note.requests.at(-1)).length, 1)
})

test('the risks of a change are held for one second look: the model gets them and the names no quote follows, an added risk with a false quote is refused, and the reader gets the final risks in the order revise_risks gave, the withdrawn one shown with its proof, in the reply, the record and the cost', async () => {
	const falseRisk = { ...CALLER_RISK, quotes: [{ ...CALL, text: '    return await fetchWithin(TIMEOUT_MS * 2)' }] }
	const withdraw = [{ risk: 1, reason: 'Only requests slower than 100 ms fail.', quotes: [LIMIT] }]
	const own = buildRepository(COMMITS).root
	const { events, requests } = await ask(
		[
			show({ ...ABOUT_THE_CHANGE, risks: [FIRST_RISK, SECOND_RISK] }),
			{ text: '' },
			{ tool: 'ken__revise_risks', args: { risks: [falseRisk], order: [3, 1, 2] } },
			{ tool: 'ken__revise_risks', args: { risks: [CALLER_RISK], withdraw, order: [3, 2] } },
			{ text: 'The second look took one risk out.' },
		],
		'question',
		own,
	)

	const [question, pass, ...more] = userTexts(requests.at(-1))
	assert.ok(question?.includes('What did the last commit do?'))
	assert.equal(more.length, 0, 'ken asks the risk questions once')
	for (const fact of [FIRST_RISK.text, SECOND_RISK.text, 'TIMEOUT_MS', 'src/load.ts:2']) {
		assert.ok(pass?.includes(fact), `the risk questions name ${fact}: ${pass}`)
	}
	assert.match(toolResults(requests[3]).at(-1) ?? '', /attempt 1 of 2[\s\S]*Risk 3, quote 1: .*src\/load\.ts/)
	const verified = (risk: typeof FIRST_RISK, line: number) => ({
		...risk,
		quotes: risk.quotes.map((quote) => ({ ...quote, startLine: line, endLine: line })),
		checked: risk === CALLER_RISK,
	})
	assert.deepEqual(risks(events), [verified(CALLER_RISK, 2), verified(SECOND_RISK, 1)], 'in the order 3, 2')
	assert.deepEqual(
		withdrawn(events),
		[{ risk: verified(FIRST_RISK, 1), reason: withdraw[0]?.reason, proof: verified(FIRST_RISK, 1).quotes }],
		'the withdrawn risk shows with the line that rules it out',
	)
	assert.deepEqual(
		replyIn(events).items.map((item) => (item.kind === 'words' ? item.text : item.card.kind)),
		['The timeout is shorter.', 'claim', 'risk', 'risk', 'withdrawn', 'The second look took one risk out.'],
	)
	assert.deepEqual(replyIn(events).change?.usedElsewhere, { followed: ['TIMEOUT_MS'], notFollowed: [] })
	const work = (await fileRecordStore(own, gitRepository(own)).read()).current.find((entry) => entry.kind === 'work')
	const stored = risks(events).map(({ checked: _, weight: __, ...risk }) => risk)
	assert.deepEqual(
		work?.kind === 'work' && work.risks,
		stored,
		'the record keeps the merged risks, without the mark and the weight',
	)
	const usage = events.find((each) => each.kind === 'usage')
	const replies = (n: number) => ({
		input: n * USAGE_PER_REPLY.prompt_tokens,
		output: n * USAGE_PER_REPLY.completion_tokens,
	})
	assert.deepEqual(
		usage?.kind === 'usage' && [
			usage.inputTokens,
			usage.outputTokens,
			usage.secondLook?.inputTokens,
			usage.secondLook?.outputTokens,
		],
		[replies(5).input, replies(5).output, replies(3).input, replies(3).output],
		'the second look took the last three replies, and the total counts them too',
	)
})

test('the risks of a change the record already explains show at once, with no second look', async () => {
	const own = buildRepository(COMMITS).root
	await ask([show({ ...ABOUT_THE_CHANGE, risks: [FIRST_RISK] }), { text: '' }, ...nothingToRevise(1)], 'question', own)
	const again = await ask(
		[show({ scope: { base, head }, risks: [SECOND_RISK] }), { text: '' }, { text: 'A second look gets this.' }],
		'question',
		own,
	)

	assert.equal(again.requests.length, 2, 'the reply and the end of its turn, no second look')
	assert.deepEqual(
		risks(again.events).map((risk) => risk.text),
		[SECOND_RISK.text],
	)
})

test('a withdrawal with no quote goes back without using an attempt, and the risk still reaches the reader', async () => {
	const { events, requests } = await ask([
		show({ scope: { base, head }, risks: [FIRST_RISK, SECOND_RISK] }),
		{ text: '' },
		{ tool: 'ken__revise_risks', args: { withdraw: [{ risk: 1, reason: 'This is not new behaviour.' }], order: [2] } },
		{ text: 'I keep both risks.' },
	])

	assert.match(toolResults(requests[3]).at(-1) ?? '', /did not use one of your attempts[\s\S]*risk 1 has no quote/)
	assert.deepEqual(
		risks(events).map((risk) => risk.text),
		[FIRST_RISK.text, SECOND_RISK.text],
	)
	assert.deepEqual(withdrawn(events), [])
})

test('eight risks reach the reader in the order the second look gave', async () => {
	const eight = Array.from({ length: 8 }, (_, n) => ({ ...CALLER_RISK, text: `load waits too long, case ${n + 1}.` }))
	const order = [8, 7, 6, 5, 4, 3, 2, 1]
	const { events } = await ask([
		show({ scope: { base, head }, risks: eight }),
		{ text: '' },
		{ tool: 'ken__revise_risks', args: { order } },
		{ text: '' },
	])

	assert.deepEqual(
		risks(events).map((risk) => risk.text),
		order.map((number) => `load waits too long, case ${number}.`),
	)
})
