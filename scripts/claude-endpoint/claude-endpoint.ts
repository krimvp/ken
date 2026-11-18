// A chat-completions endpoint on 127.0.0.1 that answers each request from ken with one run of the `claude` command,
// so ken can work on a Claude model through the owner's Claude Code sign-in. The CLI runs as a plain model: no
// built-in tools, no settings or instruction files, no MCP servers, no saved session. ken's tools are described in
// the prompt, and the model sends its tool calls back as structured output.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type ChatRequest, parseChatRequest, REPLY_SCHEMA, systemPromptFor, transcriptFor } from './chat-request.ts'
import { type Reply, type RunOutcome, readCliResult, type Usage } from './cli-result.ts'

export const DEFAULT_PORT = 4141

export async function startClaudeEndpoint(port: number): Promise<{ url: string; close: () => void }> {
	let busy = false
	const server = createServer(async (req, res) => {
		const refusal = refusalFor(req)
		if (refusal) return sendError(res, refusal.status, refusal.message)
		// ken asks one question at a time, so a second request at once is a mistake, not a queue to keep.
		if (busy) return sendError(res, 429, 'claude is already answering a request. This endpoint runs one at a time.')
		busy = true
		try {
			let raw = ''
			for await (const part of req) raw += part
			let body: unknown
			try {
				body = JSON.parse(raw)
			} catch {
				return sendError(res, 400, 'the body is not JSON')
			}
			const request = parseChatRequest(body)
			if (!request.ok) return sendError(res, 400, request.problem)
			const stop = new AbortController()
			res.on('close', () => stop.abort())
			const answer = await answerWithClaude(request.value, stop.signal)
			if (answer.kind === 'failed') return sendError(res, 502, answer.message)
			sendReply(res, answer.reply, answer.usage)
		} finally {
			busy = false
		}
	})
	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('the endpoint has no TCP port')
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		close: () => {
			server.closeAllConnections()
			server.close()
		},
	}
}

// Only ken's own requests: the one path, JSON (so a web page cannot post here without a preflight this server refuses),
// and a Host of this machine (so a page that rebinds its name to 127.0.0.1 is refused too).
function refusalFor(req: IncomingMessage): { status: number; message: string } | null {
	if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
		return { status: 404, message: 'this endpoint serves only POST /v1/chat/completions' }
	}
	if (!req.headers['content-type']?.startsWith('application/json')) {
		return { status: 415, message: 'send the request as application/json' }
	}
	const port = req.socket.localPort
	if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
		return { status: 403, message: 'this endpoint answers only requests addressed to 127.0.0.1' }
	}
	return null
}

type Answer = { kind: 'reply'; reply: Reply; usage: Usage | null } | { kind: 'failed'; message: string }

// A reply that does not have the shape of a turn gets one more run, told what was wrong with it.
async function answerWithClaude(request: ChatRequest, signal: AbortSignal): Promise<Answer> {
	const transcript = transcriptFor(request)
	const first = await runClaude(request, transcript, signal)
	if (first.kind !== 'unusable') return first
	const retry = `${transcript}\n\nYour last reply could not be used: ${first.problem}. Write the turn again.`
	const second = await runClaude(request, retry, signal)
	if (second.kind === 'failed') return second
	if (second.kind === 'unusable') {
		return {
			kind: 'failed',
			message: `claude sent a reply that is not a turn, twice. The last problem: ${second.problem}`,
		}
	}
	return { ...second, usage: sumUsage(first.usage, second.usage) }
}

async function runClaude(request: ChatRequest, prompt: string, signal: AbortSignal): Promise<RunOutcome> {
	const dir = await mkdtemp(path.join(tmpdir(), 'ken-claude-'))
	const empty = path.join(dir, 'empty')
	const systemPrompt = path.join(dir, 'system-prompt.txt')
	await mkdir(empty)
	await writeFile(systemPrompt, systemPromptFor(request))
	const args = [
		'-p',
		'--output-format',
		'json',
		'--model',
		request.model,
		'--system-prompt-file',
		systemPrompt,
		'--tools',
		'',
		'--setting-sources',
		'',
		'--strict-mcp-config',
		'--no-session-persistence',
		'--json-schema',
		JSON.stringify(REPLY_SCHEMA),
	]
	const started = performance.now()
	try {
		const run = await runCommand('claude', args, prompt, empty, signal)
		const outcome = run.kind === 'ran' ? readCliResult(run.stdout, run.stderr, request.tools) : run
		logRun(outcome, prompt.length, (performance.now() - started) / 1000)
		return outcome
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

function runCommand(
	command: string,
	args: string[],
	stdin: string,
	cwd: string,
	signal: AbortSignal,
): Promise<{ kind: 'ran'; stdout: string; stderr: string } | { kind: 'failed'; message: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, signal, stdio: ['pipe', 'pipe', 'pipe'] })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (part) => {
			stdout += part
		})
		child.stderr.on('data', (part) => {
			stderr += part
		})
		child.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') resolve({ kind: 'failed', message: 'the claude command is not on the PATH' })
			else if (signal.aborted)
				resolve({ kind: 'failed', message: 'ken stopped waiting, so the claude run was stopped' })
			else resolve({ kind: 'failed', message: `claude could not run: ${error.message}` })
		})
		child.on('close', () => resolve({ kind: 'ran', stdout, stderr }))
		// A child that exits before reading all of stdin closes the pipe; its result says why.
		child.stdin.on('error', () => {})
		child.stdin.end(stdin)
	})
}

function sendReply(res: ServerResponse, reply: Reply, usage: Usage | null): void {
	const chunk = (body: object) =>
		`data: ${JSON.stringify({ id: 'claude', object: 'chat.completion.chunk', ...body })}\n\n`
	const toolCalls = reply.toolCalls.map((call, index) => ({
		index,
		id: `call_${randomUUID().slice(0, 8)}`,
		type: 'function',
		function: { name: call.name, arguments: JSON.stringify(call.arguments) },
	}))
	const delta = {
		role: 'assistant',
		...(reply.text === '' ? {} : { content: reply.text }),
		...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
	}
	const finish = toolCalls.length === 0 ? 'stop' : 'tool_calls'
	res.writeHead(200, { 'content-type': 'text/event-stream' })
	res.end(
		chunk({ choices: [{ index: 0, delta, finish_reason: null }] }) +
			chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }) +
			(usage ? chunk({ choices: [], usage: chatUsage(usage) }) : '') +
			'data: [DONE]\n\n',
	)
}

function chatUsage(usage: Usage) {
	return {
		prompt_tokens: usage.input + usage.cacheRead + usage.cacheWrite,
		completion_tokens: usage.output,
		prompt_tokens_details: { cached_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite },
	}
}

function sumUsage(a: Usage | null, b: Usage | null): Usage | null {
	if (!a || !b) return a ?? b
	return {
		input: a.input + b.input,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		output: a.output + b.output,
	}
}

function sendError(res: ServerResponse, status: number, message: string): void {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify({ error: { message, type: 'claude_endpoint' } }))
}

function logRun(outcome: RunOutcome, promptChars: number, seconds: number): void {
	const what =
		outcome.kind === 'reply'
			? `a turn with ${outcome.reply.toolCalls.length} tool calls`
			: outcome.kind === 'unusable'
				? `a reply that is not a turn (${outcome.problem})`
				: outcome.message
	const tokens =
		outcome.kind !== 'failed' && outcome.usage
			? `${outcome.usage.input + outcome.usage.cacheRead + outcome.usage.cacheWrite} tokens in, ${outcome.usage.output} out`
			: 'no token counts'
	process.stderr.write(`claude ran ${seconds.toFixed(1)} s on ${promptChars} characters: ${what}; ${tokens}\n`)
}

// Runs from a checkout with "npm run claude-endpoint", and as the installed command "ken-claude-endpoint".
export async function serve(args: string[]) {
	const { values } = parseArgs({ args, options: { port: { type: 'string', default: String(DEFAULT_PORT) } } })
	const port = Number(values.port)
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`--port must be a whole number from 0 to 65535, not ${values.port}`)
	}
	const { url } = await startClaudeEndpoint(port)
	process.stdout.write(
		`ken's Claude endpoint is listening on ${url}. Each request runs claude once. Press Ctrl-C to stop.\n` +
			`Set KEN_BASE_URL=${url} KEN_MODEL=opus KEN_API_KEY_ENV=KEN_LOCAL_KEY KEN_LOCAL_KEY=not-a-key\n`,
	)
}

if (import.meta.main) await serve(process.argv.slice(2))
