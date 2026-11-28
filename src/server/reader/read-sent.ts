// Reads what the page says the reader looked at. The body comes from outside, so its shape is checked here: the did,
// the paths, how long a brief stayed on screen, the level of a correction, and the commits of a change as text. The
// map decides what counts and looks the paths and commits up in git (see takeSent).
import { DID, KNOWN, type Sent } from '../../map/index.ts'
import { parsePath, type RepoPath } from '../../repo/index.ts'
import { fieldOf } from '../question-desk.ts'

const MAX_PATHS = 200

export function readSent(body: unknown): { kind: 'ok'; sent: Sent } | { kind: 'refused'; problem: string } {
	if (fieldOf(body, 'did') === 'undo') {
		const at = fieldOf(body, 'at')
		if (typeof at !== 'string') return { kind: 'refused', problem: 'Send at: the at of the line to take back.' }
		return { kind: 'ok', sent: { did: 'undo', at } }
	}
	const did = DID.find((each) => each === fieldOf(body, 'did'))
	if (!did) return { kind: 'refused', problem: `Send did: one of ${DID.join(', ')}, undo.` }
	const sent = fieldOf(body, 'paths')
	if (!Array.isArray(sent) || sent.length === 0 || sent.length > MAX_PATHS) {
		return { kind: 'refused', problem: `Send paths: a list of 1 to ${MAX_PATHS} paths in the project.` }
	}
	const paths: RepoPath[] = []
	for (const each of sent) {
		const parsed = typeof each === 'string' ? parsePath(each) : ({ kind: 'refused', reason: 'a path is text' } as const)
		if (parsed.kind !== 'ok') return { kind: 'refused', problem: `${parsed.reason}.` }
		paths.push(parsed.path)
	}
	switch (did) {
		case 'read': {
			const shown = fieldOf(body, 'shown')
			if (typeof shown !== 'number' || !Number.isFinite(shown)) {
				return { kind: 'refused', problem: 'Send shown: how long the brief stayed on screen, in milliseconds.' }
			}
			return { kind: 'ok', sent: { did, paths, shown } }
		}
		case 'set': {
			const level = KNOWN.find((each) => each === fieldOf(body, 'level'))
			if (!level) return { kind: 'refused', problem: `Send level: one of ${KNOWN.join(', ')}.` }
			return { kind: 'ok', sent: { did, paths, level } }
		}
		case 'change': {
			const change = fieldOf(body, 'change')
			const [base, head] = [fieldOf(change, 'base'), fieldOf(change, 'head')]
			if (typeof base !== 'string' || typeof head !== 'string') {
				return { kind: 'refused', problem: 'Send change: { base, head }, each a commit of this project.' }
			}
			return { kind: 'ok', sent: { did, paths, change: { base, head } } }
		}
		default:
			return { kind: 'ok', sent: { did, paths } }
	}
}
