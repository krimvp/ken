import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { request } from 'node:http'
import path from 'node:path'
import { after, test } from 'node:test'
import { startClaudeEndpoint } from '../../scripts/claude-endpoint/claude-endpoint.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { cliResult, fakeClaude } from '../fixtures/fake-claude/fake-claude.ts'

const endpoint = await startClaudeEndpoint(0)
after(endpoint.close)

const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'ken__read_file',
			description: 'Read a file at a commit',
			parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
		},
	},
	{ type: 'function', function: { name: 'ken__log', description: 'List commits', parameters: { type: 'object' } } },
]

function ask(messages: object[], headers: Record<string, string> = {}) {
	return fetch(`${endpoint.url}/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify({ model: 'opus', stream: true, messages, tools: TOOLS }),
	})
}

const QUESTION = [
	{ role: 'system', content: 'You are ken. Quote only lines you read.' },
	{ role: 'user', content: 'What does app.py do?' },
]

// fetch does not let a caller set Host, so this request goes through node:http.
function statusFor(headers: Record<string, string>): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		const url = new URL(`${endpoint.url}/chat/completions`)
		const body = JSON.stringify({ model: 'opus', stream: true, messages: QUESTION })
		request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
			res.resume()
			resolve(res.statusCode)
		})
			.on('error', reject)
			.end(body)
	})
}

// The chunks of a chat-completions stream, without the closing [DONE].
async function chunksOf(response: Response) {
	assert.equal(response.status, 200, await response.clone().text())
	const lines = (await response.text()).split('\n\n').filter((line) => line.startsWith('data: {'))
	return lines.map((line) => JSON.parse(line.slice('data: '.length)))
}

test('a request reaches claude as one run with no tools, settings or saved session, and the conversation in order', async () => {
	const claude = fakeClaude([cliResult({ text: 'It adds the items.', tool_calls: [] })])
	await chunksOf(
		await ask([
			...QUESTION,
			{
				role: 'assistant',
				content: 'Reading it.',
				tool_calls: [
					{ id: 'call_7', type: 'function', function: { name: 'ken__read_file', arguments: '{"path":"app.py"}' } },
				],
			},
			{ role: 'tool', tool_call_id: 'call_7', content: 'app.py, lines 1-2:\ndef total(items):\n    return sum(items)' },
		]),
	)

	const [call, ...more] = claude.calls()
	assert.ok(call)
	assert.equal(more.length, 0, 'one request runs claude once')
	const option = (name: string) => call.args[call.args.indexOf(name) + 1]
	assert.equal(option('--model'), 'opus', 'the model from the request')
	assert.equal(option('--tools'), '', 'no built-in tool of the CLI')
	assert.equal(option('--setting-sources'), '', 'no settings or instruction files')
	assert.ok(call.args.includes('--strict-mcp-config'), 'no MCP servers')
	assert.ok(call.args.includes('--no-session-persistence'), 'no saved session')
	assert.ok(call.args.includes('-p') && call.args.includes('--json-schema'), 'one printed run with structured output')
	assert.deepEqual(call.cwdEntries, [], 'it runs in an empty folder')
	assert.match(call.systemPrompt, /You are ken\. Quote only lines you read\./)
	assert.match(call.systemPrompt, /ken__read_file[\s\S]*"required":\["path"\]/, 'each tool with its parameters')
	const order = [
		'What does app.py do?',
		'Reading it.',
		'<tool_call id="call_7" name="ken__read_file">{"path":"app.py"}',
		'<tool_result id="call_7" name="ken__read_file">',
		'    return sum(items)',
	].map((text) => call.stdin.indexOf(text))
	assert.ok(
		order.every((at, index) => at >= 0 && at > (order[index - 1] ?? -1)),
		`the conversation in order:\n${call.stdin}`,
	)
})

test('a turn with two tool calls comes back as two streamed tool calls, with the usage claude reported', async () => {
	fakeClaude([
		cliResult(
			{
				text: 'Reading both.',
				tool_calls: [
					{ name: 'ken__log', arguments: {} },
					{ name: 'ken__read_file', arguments: { path: 'app.py' } },
				],
			},
			{ inputTokens: 900, cacheReadInputTokens: 80, cacheCreationInputTokens: 20, outputTokens: 30 },
		),
	])
	const chunks = await chunksOf(await ask(QUESTION))

	const delta = chunks[0].choices[0].delta
	assert.equal(delta.content, 'Reading both.')
	assert.deepEqual(
		delta.tool_calls.map((call: { index: number; function: object }) => [call.index, call.function]),
		[
			[0, { name: 'ken__log', arguments: '{}' }],
			[1, { name: 'ken__read_file', arguments: '{"path":"app.py"}' }],
		],
	)
	assert.notEqual(delta.tool_calls[0].id, delta.tool_calls[1].id, 'each call has its own id for its result')
	assert.equal(chunks[1].choices[0].finish_reason, 'tool_calls')
	assert.deepEqual(chunks[2].usage, {
		prompt_tokens: 1000,
		completion_tokens: 30,
		prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 20 },
	})
})

// ken's prompts say "call revise_answer", and a model once called it so: the endpoint refused the call, and the model
// told the reader the tool was not available.
test('a call by the bare name the prompts use, without the plugin prefix, reaches ken as that tool', async () => {
	fakeClaude([cliResult({ text: '', tool_calls: [{ name: 'read_file', arguments: { path: 'app.py' } }] })])
	const chunks = await chunksOf(await ask(QUESTION))

	assert.deepEqual(chunks[0].choices[0].delta.tool_calls[0].function, {
		name: 'ken__read_file',
		arguments: '{"path":"app.py"}',
	})
})

test('a turn with only text comes back as text that ends the turn', async () => {
	fakeClaude([cliResult({ text: 'total adds the items.', tool_calls: [] })])
	const chunks = await chunksOf(await ask(QUESTION))

	assert.deepEqual(chunks[0].choices[0].delta, { role: 'assistant', content: 'total adds the items.' })
	assert.equal(chunks[1].choices[0].finish_reason, 'stop')
})

test('a reply that is not a turn is run once more with the problem, then comes back as an error', async () => {
	const notATurn = cliResult({ text: 'Reading.', tool_calls: [{ name: 'Bash', arguments: { command: 'ls' } }] })
	const claude = fakeClaude([notATurn, notATurn, cliResult({ text: 'never asked for', tool_calls: [] })])
	const response = await ask(QUESTION)

	assert.equal(response.status, 502)
	assert.match(await response.text(), /Bash, which is not one of the tools/)
	const calls = claude.calls()
	assert.equal(calls.length, 2, 'one retry, no more')
	assert.match(calls[1]?.stdin ?? '', /Your last reply could not be used: .*Bash, which is not one of the tools/)
})

test('a request that is not JSON or not addressed to 127.0.0.1 is refused without running claude', async () => {
	const claude = fakeClaude([cliResult({ text: 'never asked for', tool_calls: [] })])

	assert.equal((await ask(QUESTION, { 'content-type': 'text/plain' })).status, 415)
	assert.equal(await statusFor({ host: 'attacker.example' }), 403)
	assert.equal((await ask(QUESTION)).status, 200, 'the same request, addressed right, is answered')
	assert.equal(claude.calls().length, 1)
})

test('ken ask --json on a repository ends in an accepted answer when claude answers through the endpoint', async () => {
	const { root, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
		{ message: 'fix: add the items', files: { 'app.py': 'def total(items):\n    return sum(items)\n' } },
	])
	const [base = '', head = ''] = hashes
	const quote = { path: 'app.py', commit: head, text: '    return sum(items)' }
	fakeClaude([
		cliResult({ text: 'Before, total returned 0. Now it adds the items.', tool_calls: [] }),
		cliResult({
			text: 'The diff is one line.',
			tool_calls: [
				{
					name: 'ken__answer',
					arguments: {
						scope: { base, head },
						work: { title: 'Fix total' },
						summary: 'total now adds the items.',
						statements: [{ text: 'total returns the sum of the items.', label: 'inferred', quotes: [quote] }],
						risks: [],
					},
				},
			],
		}),
		cliResult({ text: '', tool_calls: [] }),
		cliResult({ text: '', tool_calls: [{ name: 'ken__revise_answer', arguments: {} }] }),
		cliResult({ text: 'Nothing was left out.', tool_calls: [] }),
	])
	const env = {
		...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('KEN_'))),
		KEN_MODEL: 'opus',
		KEN_BASE_URL: endpoint.url,
		KEN_API_KEY_ENV: 'KEN_LOCAL_KEY',
		KEN_LOCAL_KEY: 'not-a-key',
	}
	const ken = path.join(import.meta.dirname, '../../src/cli/main.ts')
	const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
		execFile('node', [ken, 'ask', 'What did the fix do?', '--repo', root, '--json'], { env }, (_, stdout, stderr) =>
			resolve({ stdout, stderr }),
		)
	})

	const result = JSON.parse(stdout || '{}')
	assert.equal(result.outcome, 'answered', `${stderr}${stdout}`)
	assert.deepEqual(result.rejected, [])
	assert.deepEqual(result.answer.statements[0].quotes, [{ ...quote, startLine: 2, endLine: 2 }])
	assert.equal(result.note, 'Nothing was left out.')
	assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [5000, 150], 'five runs of claude, summed')
})
