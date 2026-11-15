import type { FileDiff, Hunk } from './repository.ts'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// Paths come from `git diff --numstat -z`, which never quotes or escapes them, and hunks from the patch of the same
// diff. git writes both in the same file order, one patch block per numstat entry, so they pair up by position.
export function parseDiff(numstat: string, patch: string): FileDiff[] {
	const entries = parseNumstat(numstat)
	const blocks = splitBlocks(patch)
	if (entries.length !== blocks.length) {
		throw new Error(`git diff gave ${entries.length} files in --numstat but ${blocks.length} in the patch`)
	}
	return entries.map(({ binary, path, oldPath }, index) =>
		binary
			? { kind: 'binary', path, oldPath }
			: { kind: 'text', path, oldPath, hunks: parseHunks(blocks[index] ?? []) },
	)
}

function parseNumstat(numstat: string) {
	const tokens = numstat.split('\0')
	const entries: { binary: boolean; path: string; oldPath: string }[] = []
	for (let index = 0; index < tokens.length; index++) {
		const [added, , path = ''] = (tokens[index] ?? '').split('\t')
		if (added === undefined || added === '') continue
		// A rename leaves the path field empty and puts the old and new paths in the next two tokens.
		if (path === '') {
			entries.push({ binary: added === '-', oldPath: tokens[index + 1] ?? '', path: tokens[index + 2] ?? '' })
			index += 2
		} else {
			entries.push({ binary: added === '-', oldPath: path, path })
		}
	}
	return entries
}

function splitBlocks(patch: string): string[][] {
	const blocks: string[][] = []
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git ')) blocks.push([])
		else blocks.at(-1)?.push(line)
	}
	return blocks
}

function parseHunks(block: string[]): Hunk[] {
	const hunks: Hunk[] = []
	for (const line of block) {
		const header = HUNK_HEADER.exec(line)
		if (header) {
			const [, oldStart = '', oldLength = '1', newStart = '', newLength = '1'] = header
			hunks.push({
				oldStart: Number(oldStart),
				oldLength: Number(oldLength),
				newStart: Number(newStart),
				newLength: Number(newLength),
				lines: [],
			})
		} else if (/^[-+\\]/.test(line)) {
			hunks.at(-1)?.lines.push(line)
		}
	}
	return hunks
}
