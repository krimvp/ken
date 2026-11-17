// Some models send a list or an object argument as JSON text: glm-5.3 sent decisions that way seven times in one run.
// aigent checks every call against the tool's schema before ken sees it, so it refused those calls. The answer tool
// therefore offers a schema that also takes text wherever it wants a list or an object, and readJsonText parses that
// text and checks the whole call against the strict schema, so the code past this edge can trust the shape.
import type { JsonObject, JsonSchema, JsonValue } from 'aigent/plugin'

// The part of JSON Schema that ken's tool schemas use.
export type Schema = {
	readonly type?: string
	readonly properties?: { readonly [name: string]: Schema }
	readonly required?: readonly string[]
	readonly additionalProperties?: boolean
	readonly items?: Schema
	readonly minItems?: number
	readonly minimum?: number
	readonly enum?: readonly string[]
}

// The schema the model sees: every list or object below the top also accepts text.
export function allowJsonText(schema: JsonSchema): JsonSchema {
	return { ...loosen(schema, false), type: 'object' }
}

function loosen(schema: JsonObject, nested: boolean): JsonObject {
	const loose: Record<string, JsonValue> = { ...schema }
	if (nested && (schema.type === 'array' || schema.type === 'object')) loose.type = [schema.type, 'string']
	if (isObject(schema.properties)) {
		const entries = Object.entries(schema.properties)
		loose.properties = Object.fromEntries(
			entries.map(([name, value]) => [name, isObject(value) ? loosen(value, true) : value]),
		)
	}
	if (isObject(schema.items)) loose.items = loosen(schema.items, true)
	return loose
}

export function readJsonText(
	schema: Schema,
	args: JsonObject,
): { kind: 'ok'; args: JsonObject } | { kind: 'refused'; problems: string[] } {
	const problems: string[] = []
	const read = readValue(schema, args, 'The answer', problems)
	if (problems.length > 0 || !isObject(read)) return { kind: 'refused', problems }
	return { kind: 'ok', args: read }
}

function readValue(schema: Schema, raw: JsonValue, where: string, problems: string[]): JsonValue {
	const parsed =
		schema.type === 'array' || schema.type === 'object' ? parsedText(raw) : ({ kind: 'ok', value: raw } as const)
	if (parsed.kind === 'refused') {
		const wanted = schema.type === 'array' ? 'a list' : 'an object'
		problems.push(`${where} is text that is not JSON (${parsed.reason}). Send it as ${wanted}, not as text.`)
		return raw
	}
	const { value } = parsed
	switch (schema.type) {
		case 'array': {
			const { items } = schema
			if (!isList(value)) problems.push(`${where} must be a list.`)
			else if (value.length < (schema.minItems ?? 0)) problems.push(`${where} needs at least ${schema.minItems}.`)
			else if (items) return value.map((item, index) => readValue(items, item, `${where}, item ${index + 1}`, problems))
			return value
		}
		case 'object': {
			if (!isObject(value)) {
				problems.push(`${where} must be an object.`)
				return value
			}
			const read: Record<string, JsonValue> = {}
			for (const [name, item] of Object.entries(value)) {
				const property = schema.properties?.[name]
				if (property) read[name] = readValue(property, item, `${where}, ${name}`, problems)
				else if (schema.additionalProperties === false) problems.push(`${where} has "${name}", which it does not take.`)
				else read[name] = item
			}
			for (const name of schema.required ?? []) {
				if (read[name] === undefined) problems.push(`${where} needs "${name}".`)
			}
			return read
		}
		case 'string':
			if (typeof value !== 'string') problems.push(`${where} must be text.`)
			else if (schema.enum && !schema.enum.includes(value)) {
				problems.push(`${where} must be one of: ${schema.enum.join(', ')}.`)
			}
			return value
		case 'boolean':
			if (typeof value !== 'boolean') problems.push(`${where} must be true or false.`)
			return value
		case 'integer':
			if (typeof value !== 'number' || !Number.isInteger(value) || value < (schema.minimum ?? value)) {
				problems.push(
					`${where} must be a whole number${schema.minimum === undefined ? '' : ` from ${schema.minimum}`}.`,
				)
			}
			return value
		default:
			return value
	}
}

function parsedText(value: JsonValue): { kind: 'ok'; value: JsonValue } | { kind: 'refused'; reason: string } {
	if (typeof value !== 'string') return { kind: 'ok', value }
	try {
		return { kind: 'ok', value: JSON.parse(escapeControls(value)) }
	} catch (error) {
		return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) }
	}
}

// A model that writes JSON inside a JSON argument often leaves the tabs and line breaks of quoted code unescaped, and
// JSON allows them between values but not inside a string. So this escapes them inside strings only; valid JSON
// passes through unchanged.
function escapeControls(text: string): string {
	let inString = false
	let afterBackslash = false
	let escaped = ''
	for (const char of text) {
		if (inString && !afterBackslash && char < ' ') {
			escaped += JSON.stringify(char).slice(1, -1)
			continue
		}
		if (afterBackslash) afterBackslash = false
		else if (char === '\\') afterBackslash = inString
		else if (char === '"') inString = !inString
		escaped += char
	}
	return escaped
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !isList(value)
}

// Array.isArray does not narrow a readonly array out of a union, so it gets this guard.
function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
	return Array.isArray(value)
}
