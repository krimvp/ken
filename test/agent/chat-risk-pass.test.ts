import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatEvent, startChat } from '../../src/agent/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
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
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 500\n', 'src/load.ts': CALLER } },
	{ message: 'fix: time out sooner', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 100\n' } },
])
const [base = '', head = ''] = hashes
const KEY_ENV = 'KEN_TEST_MODEL_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

const LIMIT = { path: 'src/limits.ts', commit: head, text: 'export const TIMEOUT_MS = 100' }
const CALL = { path: 'src/load.ts', commit: head, text: '\treturn await fetchWithin(TIMEOUT_MS * 2)' }
const STATEMENT = { text: 'The timeout drops from 500 ms to 100 ms.', label: 'inferred', quotes: [LIMIT] }
const FIRST_RISK = { text: 'Every request now fails five times sooner.', label: 'inferred', quotes: [LIMIT] }
const SECOND_RISK = { text: 'A slow network now times out.', label: 'inferred', quotes: [LIMIT] }
const CALLER_RISK = { text: 'load still waits 200 ms, twice the new limit.', label: 'inferred', quotes: [CALL] }

function answer(args: Record<string, unknown>): Turn {
	return {
		tool: 'ken__answer',
		args: { summary: 'The timeout is shorter.', statements: [STATEMENT], ...args },
	}
}
const ABOUT_THE_CHANGE = { scope: { base, head }, work: { title: 'Time out sooner' } }

async function ask(script: Turn[], as: 'question' | 'note' = 'question') {
	const model = await scriptedModel(script)
	const started = await startChat({
		directory: root,
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

test('an answer about a change is held for one risk pass: the agent gets its risks and the names no quote follows, an eighth risk is refused with the reason and uses no attempt, an added risk with a false quote is refused, and the final risks come in the order the revise call gave, with the withdrawn one gone, in the answer, the record and the cost', async () => {
	const falseRisk = { ...CALLER_RISK, quotes: [{ ...CALL, text: '    return await fetchWithin(TIMEOUT_MS * 2)' }] }
	const six = Array.from({ length: 6 }, (_, n) => ({ ...CALLER_RISK, text: `load waits too long, case ${n + 1}.` }))
	const withdraw = [{ risk: 1, reason: 'Only requests slower than 100 ms fail.' }]
	const { events, requests } = await ask([
		answer({ ...ABOUT_THE_CHANGE, risks: [FIRST_RISK, SECOND_RISK] }),
		{ text: '' },
		{ tool: 'ken__revise_answer', args: { risks: six, order: [1, 2, 3, 4, 5, 6, 7, 8] } },
		{ tool: 'ken__revise_answer', args: { risks: [falseRisk], order: [3, 1, 2] } },
		{ tool: 'ken__revise_answer', args: { risks: [CALLER_RISK], withdraw, order: [3, 2] } },
		{ text: 'I left out the tests.' },
	])

	const [question, pass, ...more] = userTexts(requests.at(-1))
	assert.ok(question?.includes('What did the last commit do?'))
	assert.equal(more.length, 0, 'ken asks the risk questions once')
	for (const fact of [FIRST_RISK.text, SECOND_RISK.text, 'TIMEOUT_MS', 'src/load.ts:2']) {
		assert.ok(pass?.includes(fact), `the risk questions name ${fact}: ${pass}`)
	}
	const eight = toolResults(requests[3]).at(-1) ?? ''
	assert.match(eight, /8 risks, and ken shows at most 7, so the owner reads every one/)
	assert.match(eight, /did not use one of your attempts/)
	assert.match(toolResults(requests[4]).at(-1) ?? '', /attempt 1 of 2[\s\S]*Risk 1, quote 1: .*src\/load\.ts/)
	const event = accepted(events)
	const verified = (risk: typeof FIRST_RISK, line: number) => ({
		...risk,
		quotes: risk.quotes.map((quote) => ({ ...quote, startLine: line, endLine: line })),
		checked: risk === CALLER_RISK,
	})
	assert.deepEqual(event.answer.risks, [verified(CALLER_RISK, 2), verified(SECOND_RISK, 1)], 'in the order 3, 2')
	assert.deepEqual(event.revision, {
		risks: [{ kind: 'added' }, { kind: 'kept', was: 2 }],
		decisions: 0,
		withdrawn: [{ risk: verified(FIRST_RISK, 1), reason: withdraw[0]?.reason }],
	})
	assert.deepEqual(event.answer.change?.usedElsewhere, { followed: ['TIMEOUT_MS'], notFollowed: [] })
	const work = (await fileRecordStore(root, gitRepository(root)).read()).current.find((entry) => entry.kind === 'work')
	const stored = event.answer.risks?.map(({ checked: _, ...risk }) => risk)
	assert.deepEqual(work?.kind === 'work' && work.risks, stored, 'the record keeps the merged risks, without the mark')
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
		[replies(6).input, replies(6).output, replies(4).input, replies(4).output],
		'the risk pass took the last four replies, and the total counts them too',
	)
})

test('a question not about a change, and a live note about one, get no risk pass and no list of names used elsewhere', async () => {
	// Each script has one turn more than it needs, which only a risk pass would use.
	const spare: Turn = { text: 'A risk pass would get this.' }
	const now = await ask([answer({}), { text: 'Nothing left out.' }, spare])
	assert.equal(accepted(now.events).revision, null)
	assert.equal(now.requests.length, 2, 'the answer and the closing note, nothing more')

	const note = await ask(
		[{ tool: 'ken__diff', args: { base, head } }, answer({ scope: { base, head }, risks: [] }), { text: '.' }, spare],
		'note',
	)
	assert.equal(note.requests.length, 3)
	assert.ok(!(toolResults(note.requests[1])[0] ?? '').includes('src/load.ts:2'), 'a note reads the diff alone')
	assert.equal(userTexts(note.requests.at(-1)).length, 1)
})
