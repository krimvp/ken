import path from 'node:path'
import type { Refused, RepoPath } from './repository.ts'

export function parsePath(raw: string): { kind: 'ok'; path: RepoPath } | Refused {
	if (raw.includes('\0')) return { kind: 'refused', reason: 'the path contains a NUL byte' }
	if (path.posix.isAbsolute(raw)) {
		return { kind: 'refused', reason: `"${raw}" is absolute. Give the path from the repository root.` }
	}
	const normal = path.posix.normalize(raw).replace(/\/$/, '')
	if (normal.startsWith('-')) return { kind: 'refused', reason: `"${raw}" starts with "-"` }
	if (normal === '.' || normal === '..' || normal.startsWith('../')) {
		return { kind: 'refused', reason: `"${raw}" does not name a file inside the repository` }
	}
	return { kind: 'ok', path: normal as RepoPath }
}
