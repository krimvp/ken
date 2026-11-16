// What one `claude -p --output-format json` run gave back, read into the assistant turn ken gets, or the reason it
// cannot be used. Only the shape is checked here: ken checks every tool call's arguments itself.
import { isObject, type Parsed, type Tool } from './chat-request.ts'

export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number }

export type Reply = { text: string; toolCalls: { name: string; arguments: Record<string, unknown> }[] }

export type RunOutcome =
	| { kind: 'reply'; reply: Reply; usage: Usage | null }
	| { kind: 'unusable'; problem: string; usage: Usage | null }
	| { kind: 'failed'; message: string }

export function readCliResult(stdout: string, stderr: string, tools: Tool[]): RunOutcome {
	let result: unknown
	try {
		result = JSON.parse(stdout)
	} catch {
		return { kind: 'failed', message: `claude printed no JSON result. ${stderr.trim() || stdout.trim()}`.trim() }
	}
	if (!isObject(result)) return { kind: 'failed', message: 'claude printed JSON that is not a result object' }
	if (result.is_error === true) {
		const said = typeof result.result === 'string' ? result.result : JSON.stringify(result.errors ?? result.subtype)
		return { kind: 'failed', message: `claude failed: ${said}` }
	}
	const usage = usageOf(result.modelUsage)
	const reply = replyOf(result.structured_output, tools)
	return reply.ok ? { kind: 'reply', reply: reply.value, usage } : { kind: 'unusable', problem: reply.problem, usage }
}

function replyOf(output: unknown, tools: Tool[]): Parsed<Reply> {
	if (!isObject(output)) return { ok: false, problem: 'the reply had no structured output' }
	if (typeof output.text !== 'string') return { ok: false, problem: 'text must be a string' }
	if (!Array.isArray(output.tool_calls)) return { ok: false, problem: 'tool_calls must be a list' }
	const names = new Set(tools.map((tool) => tool.name))
	const toolCalls: Reply['toolCalls'] = []
	for (const [index, call] of output.tool_calls.entries()) {
		if (!isObject(call) || typeof call.name !== 'string' || !isObject(call.arguments)) {
			return { ok: false, problem: `tool_calls[${index}] needs a name and an arguments object` }
		}
		const name = toolName(call.name, [...names])
		if (name === null) {
			return {
				ok: false,
				problem: `tool_calls[${index}] calls ${call.name}, which is not one of the tools: ${[...names].join(', ')}`,
			}
		}
		toolCalls.push({ name, arguments: call.arguments })
	}
	return { ok: true, value: { text: output.text, toolCalls } }
}

// ken's prompts name a tool without its plugin's prefix ("call revise_answer"), and a model reading tools from a
// prompt may call it that way. Such a call goes to the one tool of that name, so the model is not told the tool is
// missing.
function toolName(called: string, names: string[]): string | null {
	if (names.includes(called)) return called
	const matches = names.filter((name) => name.endsWith(`__${called}`))
	return matches.length === 1 ? (matches[0] ?? null) : null
}

// modelUsage holds one entry per model the run used, so the sum is what the run cost.
function usageOf(modelUsage: unknown): Usage | null {
	if (!isObject(modelUsage) || Object.keys(modelUsage).length === 0) return null
	const usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
	for (const entry of Object.values(modelUsage)) {
		if (!isObject(entry)) return null
		usage.input += numberOf(entry.inputTokens)
		usage.cacheRead += numberOf(entry.cacheReadInputTokens)
		usage.cacheWrite += numberOf(entry.cacheCreationInputTokens)
		usage.output += numberOf(entry.outputTokens)
	}
	return usage
}

function numberOf(value: unknown): number {
	return typeof value === 'number' ? value : 0
}
