// A concept is anything the page opens a brief for, named by one string the page and the server share: "kind:rest".
// The page sends an id back as it got it, so the id is parsed here before anything reads git or the record with it.
import { createHash } from 'node:crypto'

// within is a level's paths, sorted, and empty for the whole project. n counts from 1.
export type Concept =
	| { kind: 'part'; within: string[]; name: string }
	| { kind: 'term'; name: string }
	| { kind: 'process'; id: string }
	| { kind: 'step'; process: string; n: number }
	| { kind: 'question'; id: string }
	| { kind: 'decision'; id: string }
	| { kind: 'arrow'; within: string[]; n: number }
	| { kind: 'frame' | 'store' | 'outside' | 'crossing'; id: string }

export type ConceptKind = Concept['kind']

// shortcut: a level's paths are joined by commas and end at the next colon, so a path that holds either cannot be
// named. Quote the paths if a project ever has one.
export function parseConcept(id: string): Concept | null {
	const at = id.indexOf(':')
	const [kind, rest] = at === -1 ? [id, ''] : [id.slice(0, at), id.slice(at + 1)]
	const last = rest.lastIndexOf(':')
	const count = (text: string) => (/^[1-9]\d*$/.test(text) ? Number(text) : null)
	switch (kind) {
		case 'part': {
			const colon = rest.indexOf(':')
			const name = rest.slice(colon + 1)
			return colon === -1 || name === '' ? null : { kind, within: pathsOf(rest.slice(0, colon)), name }
		}
		case 'arrow': {
			const n = count(rest.slice(last + 1))
			return last === -1 || n === null ? null : { kind, within: pathsOf(rest.slice(0, last)), n }
		}
		case 'step': {
			const n = count(rest.slice(last + 1))
			return last < 1 || n === null ? null : { kind, process: rest.slice(0, last), n }
		}
		case 'term':
			return rest === '' ? null : { kind, name: rest }
		case 'process':
		case 'question':
		case 'decision':
		case 'frame':
		case 'store':
		case 'outside':
		case 'crossing':
			return rest === '' ? null : { kind, id: rest }
		default:
			return null
	}
}

export function partId(within: string[], name: string): string {
	return `part:${within.join(',')}:${name}`
}

export function arrowId(within: string[], n: number): string {
	return `arrow:${within.join(',')}:${n}`
}

export const termId = (name: string) => `term:${name}`
export const processId = (id: string) => `process:${id}`
export const stepId = (process: string, n: number) => `step:${process}:${n}`
export const decisionId = (id: string) => `decision:${id}`

// A question is named by what it asks and about what, so the same question is one concept before and after it has an
// answer, whoever wrote it: ken's model in a brief, or the reader in the box.
export function questionId(concept: string, text: string): string {
	return `question:${shortHash([concept, text.trim().toLowerCase().replaceAll(/\s+/g, ' ')])}`
}

export function shortHash(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
}

function pathsOf(text: string): string[] {
	return text === '' ? [] : text.split(',')
}
