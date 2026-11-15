import type { JsonObject, ToolResult } from 'aigent/plugin'

// aigent checks each call against the tool's schema before the tool runs, so a value of the wrong type here means the
// schema and this reader disagree. That is a bug in ken, not a mistake by the model.
export function readArgs(args: JsonObject, tool: string) {
	const wrong = (name: string, type: string) =>
		new Error(`${tool}: argument "${name}" is not ${type}, so its schema and its reader disagree`)
	const text = (name: string) => {
		const value = args[name]
		if (typeof value !== 'string') throw wrong(name, 'a string')
		return value
	}
	return {
		text,
		// Models fill optional fields with "" as often as they leave them out, so "" means not given.
		optionalText(name: string): string | undefined {
			return args[name] === undefined || args[name] === '' ? undefined : text(name)
		},
		optionalLine(name: string): number | undefined {
			const value = args[name]
			if (value === undefined) return undefined
			if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw wrong(name, 'a line number')
			return value
		},
	}
}

export function reply(text: string): ToolResult {
	return { content: [{ type: 'text', text }] }
}

export function refuse(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true }
}

export function short(commit: string): string {
	return commit.slice(0, 12)
}
