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
	const value = schema.type === 'array' || schema.type === 'object' ? parsedText(raw) : raw
	if (value === undefined) {
		problems.push(`${where} is text that is not JSON. Send it as ${schema.type === 'array' ? 'a list' : 'an object'}.`)
		return raw
	}
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
			for (const name of schema.required ?? []) {
				if (value[name] === undefined) problems.push(`${where} needs "${name}".`)
			}
			const read: Record<string, JsonValue> = {}
			for (const [name, item] of Object.entries(value)) {
				const property = schema.properties?.[name]
				if (property) read[name] = readValue(property, item, `${where}, ${name}`, problems)
				else if (schema.additionalProperties === false) problems.push(`${where} has "${name}", which it does not take.`)
				else read[name] = item
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

// undefined means the value was text that does not parse as JSON.
function parsedText(value: JsonValue): JsonValue | undefined {
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !isList(value)
}

// Array.isArray does not narrow a readonly array out of a union, so it gets this guard.
function isList(value: JsonValue | undefined): value is readonly JsonValue[] {
	return Array.isArray(value)
}
