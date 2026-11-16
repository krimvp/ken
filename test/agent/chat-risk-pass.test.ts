import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import {
	type ChatRequest,
	DRAFT,
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

function answer(args: Record<string, unknown>): Turn {
	return {
		tool: 'ken__answer',
		args: { summary: 'The timeout is shorter.', statements: [STATEMENT], ...args },
	}
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

function accepted(events: ChatEvent[]) {
	const all = events.filter((event) => event.kind === 'accepted')
	assert.equal(all.length, 1, 'one answer reaches the reader')
	const [event] = all
	return event?.kind === 'accepted' ? event : assert.fail(`no answer was accepted: ${JSON.stringify(events)}`)
}

function userTexts(request: ChatRequest | undefined): string[] {
	return (request?.messages ?? [])
		.filter((message) => message.role === 'user')
		.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
}

test('log and diff over a change end with the names used elsewhere, once per question, and the accepted answer names those no quote follows', async () => {
	const { events, requests } = await ask([
		{ tool: 'ken__diff', args: { base, head } },
		{ tool: 'ken__log', args: { base, head } },
		DRAFT,
		// No work title, so the record keeps nothing that would spare the next test's change its risk pass.
		answer({ scope: { base, head }, risks: [] }),
		...nothingToRevise(0),
		{ text: 'I left out the tests.' },
	])

	const diff = toolResults(requests[1])[0] ?? ''
	assert.ok(diff.includes('TIMEOUT_MS') && diff.includes(`src/load.ts:2: ${CALL.text.trim()}`), `the diff: ${diff}`)
	assert.ok(
		!(toolResults(requests[2])[1] ?? '').includes('src/load.ts:2'),
		'the log of the same range does not repeat it',
	)
	const { change } = accepted(events).answer
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
			DRAFT,
			{
				tool: 'ken__answer',
				args: {
					scope: { base: start, head: change },
					summary: 'The timeout is shorter.',
					statements: [{ text: 'The timeout drops to 100 ms.', label: 'inferred', quotes: [quote] }],
					risks: [],
				},
			},
			...nothingToRevise(0),
			{ text: 'I left out the tests.' },
		],
		'question',
		later.root,
	)

	const pass = userTexts(requests.at(-1))[2] ?? ''
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

test('a question about a change gets its draft first: an answer sent before the draft goes back without using an attempt, ken asks for the answer once the draft ends the turn, and the answer counts the points of the draft it left out', async () => {
	const { events, requests } = await ask([
		answer({ scope: { base, head }, risks: [] }),
		DRAFT,
		answer({ scope: { base, head }, risks: [], left_out: ['the README line', 'a guess about callers'] }),
		...nothingToRevise(0),
		{ text: 'I left out the tests.' },
	])

	assert.match(toolResults(requests[1])[0] ?? '', /did not use one of your attempts[\s\S]*draft/)
	assert.deepEqual(userTexts(requests[1]).length, 1, 'the answer went back within the first turn')
	assert.deepEqual(userTexts(requests[2]).length, 2, 'once the draft ends the turn, ken asks for the answer')
	assert.equal(
		events.some((event) => event.kind === 'rejected'),
		false,
	)
	assert.equal(accepted(events).answer.leftOut, 2)
	const usage = events.find((each) => each.kind === 'usage')
	assert.deepEqual(
		usage?.kind === 'usage' && usage.fromDraft && [usage.fromDraft.inputTokens, usage.fromDraft.outputTokens],
		[2 * USAGE_PER_REPLY.prompt_tokens, 2 * USAGE_PER_REPLY.completion_tokens],
		'turning the draft into the answer took the answer and the end of its turn',
	)
})

test('a question not about a change, and a live note about one, get no draft step, no risk pass and no list of names used elsewhere', async () => {
	// Each script has one turn more than it needs, which only a risk pass would use.
	const spare: Turn = { text: 'A risk pass would get this.' }
	const now = await ask([answer({}), { text: 'Nothing left out.' }, spare])
	assert.equal(accepted(now.events).revision, null)
	assert.equal(now.requests.length, 2, 'the answer and the closing note, nothing more')

	const note = await ask(
		[{ tool: 'ken__diff', args: { base, head } }, answer({ scope: { base, head }, risks: [] }), { text: '.' }, spare],
		'note',
	)
	assert.equal(accepted(note.events).revision, null, 'the note is answered in its first turn')
	assert.equal(note.requests.length, 3)
	assert.ok(!(toolResults(note.requests[1])[0] ?? '').includes('src/load.ts:2'), 'a note reads the diff alone')
	assert.equal(userTexts(note.requests.at(-1)).length, 1)
})

test('an answer about a change is held for one risk pass: the agent gets its risks and the names no quote follows, an added risk with a false quote is refused, and the final risks come in the order the revise call gave, with the withdrawn one gone, in the answer, the record and the cost', async () => {
	const falseRisk = { ...CALLER_RISK, quotes: [{ ...CALL, text: '    return await fetchWithin(TIMEOUT_MS * 2)' }] }
	const withdraw = [{ risk: 1, reason: 'Only requests slower than 100 ms fail.', quotes: [LIMIT] }]
	const own = buildRepository(COMMITS).root
	const { events, requests } = await ask(
		[
			DRAFT,
			answer({ ...ABOUT_THE_CHANGE, risks: [FIRST_RISK, SECOND_RISK] }),
			{ text: '' },
			{ tool: 'ken__revise_answer', args: { risks: [falseRisk], order: [3, 1, 2] } },
			{ tool: 'ken__revise_answer', args: { risks: [CALLER_RISK], withdraw, order: [3, 2] } },
			{ text: 'I left out the tests.' },
		],
		'question',
		own,
	)

	const [question, , pass, ...more] = userTexts(requests.at(-1))
	assert.ok(question?.includes('What did the last commit do?'))
	assert.equal(more.length, 0, 'ken asks the risk questions once')
	for (const fact of [FIRST_RISK.text, SECOND_RISK.text, 'TIMEOUT_MS', 'src/load.ts:2']) {
		assert.ok(pass?.includes(fact), `the risk questions name ${fact}: ${pass}`)
	}
	assert.match(toolResults(requests[4]).at(-1) ?? '', /attempt 1 of 2[\s\S]*Risk 1, quote 1: .*src\/load\.ts/)
	const event = accepted(events)
	const verified = (risk: typeof FIRST_RISK, line: number) => ({
		...risk,
		quotes: risk.quotes.map((quote) => ({ ...quote, startLine: line, endLine: line })),
		checked: risk === CALLER_RISK,
	})
	assert.deepEqual(event.answer.risks, [verified(CALLER_RISK, 2), verified(SECOND_RISK, 1)], 'in the order 3, 2')
	assert.deepEqual(event.revision, { risks: [{ kind: 'added' }, { kind: 'kept', was: 2 }], decisions: 0 })
	assert.deepEqual(
		event.answer.withdrawn,
		[{ risk: verified(FIRST_RISK, 1), reason: withdraw[0]?.reason, proof: verified(FIRST_RISK, 1).quotes }],
		'the withdrawn risk is kept with the answer, with the line that rules it out',
	)
	assert.deepEqual(event.answer.change?.usedElsewhere, { followed: ['TIMEOUT_MS'], notFollowed: [] })
	const work = (await fileRecordStore(own, gitRepository(own)).read()).current.find((entry) => entry.kind === 'work')
	const stored = event.answer.risks?.map(({ checked: _, weight: __, ...risk }) => risk)
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
			usage.riskPass?.inputTokens,
			usage.riskPass?.outputTokens,
		],
		[replies(6).input, replies(6).output, replies(3).input, replies(3).output],
		'the risk pass took the last three replies, and the total counts them too',
	)
})

test('an answer about a change the record already explains gets no second look, even without work, and says why', async () => {
	const own = buildRepository(COMMITS).root
	const scoped = { scope: { base, head }, risks: [] }
	await ask([DRAFT, answer({ ...ABOUT_THE_CHANGE, risks: [] }), ...nothingToRevise(0), { text: '.' }], 'question', own)
	const again = await ask(
		[answer(scoped), { text: 'Nothing left out.' }, { text: 'A second look gets this.' }],
		'question',
		own,
	)

	assert.equal(again.requests.length, 2, 'the answer and the closing note, no second look')
	assert.equal(accepted(again.events).answer.secondLook, 'explained')
})

test('a withdrawal with no quote goes back without using an attempt, and the risk stays in the answer', async () => {
	const { events, requests } = await ask([
		DRAFT,
		answer({ scope: { base, head }, risks: [FIRST_RISK, SECOND_RISK] }),
		{ text: '' },
		{ tool: 'ken__revise_answer', args: { withdraw: [{ risk: 1, reason: 'This is not new behaviour.' }], order: [2] } },
		{ text: 'I keep both risks.' },
	])

	assert.match(toolResults(requests[4]).at(-1) ?? '', /did not use one of your attempts[\s\S]*risk 1 has no quote/)
	assert.equal(
		events.some((event) => event.kind === 'rejected'),
		false,
	)
	const shown = accepted(events).answer
	assert.deepEqual(
		shown.risks?.map((risk) => risk.text),
		[FIRST_RISK.text, SECOND_RISK.text],
	)
	assert.equal(shown.withdrawn, undefined)
	assert.equal(shown.secondLook, 'unchanged', 'ken says the second look changed nothing')
})

test('an answer with eight risks is accepted, and they reach the reader in the order the risk pass gave', async () => {
	const eight = Array.from({ length: 8 }, (_, n) => ({ ...CALLER_RISK, text: `load waits too long, case ${n + 1}.` }))
	const order = [8, 7, 6, 5, 4, 3, 2, 1]
	const { events } = await ask([
		DRAFT,
		answer({ scope: { base, head }, risks: eight }),
		{ text: '' },
		{ tool: 'ken__revise_answer', args: { order } },
		{ text: 'I left out the tests.' },
	])

	const risks = accepted(events).answer.risks?.map((risk) => risk.text)
	assert.deepEqual(
		risks,
		order.map((number) => `load waits too long, case ${number}.`),
	)
})
