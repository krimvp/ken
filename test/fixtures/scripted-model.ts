import { createServer } from 'node:http'
import { after } from 'node:test'

// One scripted reply per chat request: text, one tool call with the text the model writes before it, or no reply at
// all. hang is called when that request arrives, and the request then stays open until the caller gives up on it. A
// reply with held waits for that promise before it is sent, so a test can keep a model call running.
export type Turn =
	| (({ text: string } | { tool: string; args: Record<string, unknown>; text?: string }) & { held?: Promise<unknown> })
	| { hang: () => void }

export type ChatRequest = { messages: { role: string; content: unknown }[] }

// Each reply reports this usage, so a test can check the sum over a question.
export const USAGE_PER_REPLY = { prompt_tokens: 100, completion_tokens: 10 }

// What a model sends after ken holds its answer about a change, when the risk pass finds nothing to change: it ends the
// question's turn, then calls revise_answer with only the order of the answer's risks, as they were. The closing note
// comes after. A script that stops after the answer leaves the risk pass no reply, so the pass fails and the answer ken
// held stands, as it would for a model that failed there.
export function nothingToRevise(risks: number): Turn[] {
	const order = Array.from({ length: risks }, (_, at) => at + 1)
	return [{ text: '' }, { tool: 'ken__revise_answer', args: { order } }]
}

// A local OpenAI-compatible endpoint that streams the script, one turn per request, because aigent reaches a model
// only over HTTP. The server closes when the test file ends.
export async function scriptedModel(script: Turn[]): Promise<{ baseUrl: string; requests: ChatRequest[] }> {
	const requests: ChatRequest[] = []
	const chunk = (body: object) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', ...body })}\n\n`
	const server = createServer(async (req, res) => {
		let raw = ''
		for await (const part of req) raw += part
		const turn = script[requests.length]
		if (!turn) return void res.writeHead(500).end('the script has no turn for this request')
		requests.push(JSON.parse(raw))
		if ('hang' in turn) return turn.hang()
		await turn.held
		const delta = !('tool' in turn)
			? { role: 'assistant', content: turn.text }
			: {
					role: 'assistant',
					...(turn.text === undefined ? {} : { content: turn.text }),
					tool_calls: [
						{
							index: 0,
							id: `call_${requests.length}`,
							type: 'function',
							function: { name: turn.tool, arguments: JSON.stringify(turn.args) },
						},
					],
				}
		res.writeHead(200, { 'content-type': 'text/event-stream' })
		res.end(
			chunk({ choices: [{ index: 0, delta, finish_reason: null }] }) +
				chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool' in turn ? 'tool_calls' : 'stop' }] }) +
				chunk({ choices: [], usage: USAGE_PER_REPLY }) +
				'data: [DONE]\n\n',
		)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	after(() => {
		server.closeAllConnections()
		server.close()
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('the scripted model has no TCP port')
	return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests }
}

// The text of every tool result the model was sent, in order.
export function toolResults(request: ChatRequest | undefined): string[] {
	return (request?.messages ?? [])
		.filter((message) => message.role === 'tool')
		.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
}
