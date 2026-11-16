// A chat-completions request, read from the HTTP body, and the prompt that carries it to one `claude -p` run.
// The CLI holds no conversation of its own, so every run gets the whole transcript, as ken sends it.

type Text = string
type ToolCall = { id: string; name: string; arguments: string }

export type Message =
	| { role: 'system'; content: Text }
	| { role: 'user'; content: Text }
	| { role: 'assistant'; content: Text; toolCalls: ToolCall[] }
	| { role: 'tool'; toolCallId: string; content: Text }

export type Tool = { name: string; description: string; parameters: unknown }

export type ChatRequest = { model: string; messages: Message[]; tools: Tool[] }

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string }

export function parseChatRequest(body: unknown): Parsed<ChatRequest> {
	if (!isObject(body)) return fail('the body is not a JSON object')
	if (typeof body.model !== 'string' || body.model === '') return fail('model must be a non-empty string')
	if (body.stream !== true) return fail('this endpoint only streams: send "stream": true')
	if (!Array.isArray(body.messages)) return fail('messages must be an array')
	const messages: Message[] = []
	for (const [index, raw] of body.messages.entries()) {
		const message = parseMessage(raw)
		if (typeof message === 'string') return fail(`messages[${index}]: ${message}`)
		messages.push(message)
	}
	const tools: Tool[] = []
	for (const [index, raw] of (Array.isArray(body.tools) ? body.tools : []).entries()) {
		const fn = isObject(raw) && isObject(raw.function) ? raw.function : undefined
		if (!fn || typeof fn.name !== 'string') return fail(`tools[${index}] is not a function tool with a name`)
		tools.push({
			name: fn.name,
			description: typeof fn.description === 'string' ? fn.description : '',
			parameters: fn.parameters ?? {},
		})
	}
	return { ok: true, value: { model: body.model, messages, tools } }
}

function parseMessage(raw: unknown): Message | string {
	if (!isObject(raw)) return 'not an object'
	const content = textOf(raw.content)
	if (content === undefined) return 'content must be text or a list of text parts'
	switch (raw.role) {
		case 'system':
		case 'developer':
			return { role: 'system', content }
		case 'user':
			return { role: 'user', content }
		case 'tool':
			if (typeof raw.tool_call_id !== 'string') return 'a tool message needs tool_call_id'
			return { role: 'tool', toolCallId: raw.tool_call_id, content }
		case 'assistant': {
			const toolCalls: ToolCall[] = []
			for (const call of Array.isArray(raw.tool_calls) ? raw.tool_calls : []) {
				const fn = isObject(call) && isObject(call.function) ? call.function : undefined
				if (!isObject(call) || typeof call.id !== 'string' || !fn || typeof fn.name !== 'string') {
					return 'a tool call needs an id and a function name'
				}
				toolCalls.push({
					id: call.id,
					name: fn.name,
					arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
				})
			}
			return { role: 'assistant', content, toolCalls }
		}
		default:
			return `role ${JSON.stringify(raw.role)} is not one this endpoint knows`
	}
}

// null content is how an assistant turn with only tool calls arrives.
function textOf(content: unknown): string | undefined {
	if (content === null || content === undefined) return ''
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return undefined
	const texts = content.map((part) => (isObject(part) && part.type === 'text' ? part.text : undefined))
	return texts.every((text) => typeof text === 'string') ? texts.join('\n') : undefined
}

// What the model must send back: one assistant turn, as structured output the CLI checks against this schema.
export const REPLY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['text', 'tool_calls'],
	properties: {
		text: { type: 'string' },
		tool_calls: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'arguments'],
				properties: { name: { type: 'string' }, arguments: { type: 'object' } },
			},
		},
	},
}

export function systemPromptFor(request: ChatRequest): string {
	const instructions = request.messages.filter((message) => message.role === 'system').map((message) => message.content)
	const tools = request.tools.map(
		(tool) =>
			`<tool name="${tool.name}">\n${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}\n</tool>`,
	)
	return `You are the model behind a chat API. A program sends you a conversation and runs the tools you call. You cannot run anything yourself.

Write one assistant turn as your structured output, with two fields:
- text: what you say in this turn. It may be empty.
- tool_calls: the tools you call in this turn, in order. Each has the tool's name and its arguments as a JSON object that follows the tool's parameters. Leave it empty when you have no tool to call.

The program runs the tools and sends their results in the next request, with the whole conversation so far.

The program's instructions:
<instructions>
${instructions.join('\n\n')}
</instructions>

The tools you may call:
${tools.length > 0 ? tools.join('\n') : 'none'}`
}

export function transcriptFor(request: ChatRequest): string {
	const toolNames = new Map<string, string>()
	const turns: string[] = []
	for (const message of request.messages) {
		if (message.role === 'user') turns.push(`<user>\n${message.content}\n</user>`)
		if (message.role === 'assistant') {
			const calls = message.toolCalls.map((call) => {
				toolNames.set(call.id, call.name)
				return `<tool_call id="${call.id}" name="${call.name}">${call.arguments}</tool_call>`
			})
			turns.push(`<assistant>\n${[message.content, ...calls].filter(Boolean).join('\n')}\n</assistant>`)
		}
		if (message.role === 'tool') {
			const name = toolNames.get(message.toolCallId) ?? 'unknown'
			turns.push(`<tool_result id="${message.toolCallId}" name="${name}">\n${message.content}\n</tool_result>`)
		}
	}
	return `The conversation so far, oldest first. Write the next assistant turn.\n\n${turns.join('\n\n')}`
}

function fail(problem: string): { ok: false; problem: string } {
	return { ok: false, problem }
}

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
