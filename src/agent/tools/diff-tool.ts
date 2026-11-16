import type { Tool } from 'aigent/plugin'
import type { FileDiff, Hunk, Repository } from '../../repo/index.ts'
import type { Elsewhere } from './elsewhere-text.ts'
import { pathOf, rangeAt } from './exploration-tools.ts'
import { readArgs, refuse, reply, short } from './tool-edge.ts'

const MAX_DIFF_CHARS = 60_000
const MAX_OVERVIEW_FILES = 200

// A diff that fits is shown whole. A larger one first comes as a list of files and hunk headers, and the model asks
// for one file at a time, so a big change never floods its context. The diff of a whole range ends with what elsewhere
// gives, the other places that use what changed; one file's diff does not.
export function diffTool(repo: Repository, elsewhere: Elsewhere): Tool {
	return {
		name: 'diff',
		description: `Show what changed from base to head, hunk by hunk, with line numbers. A diff over ${MAX_DIFF_CHARS} characters comes as a list of files and hunks; then ask for one file with path.`,
		parameters: {
			type: 'object',
			properties: {
				base: { type: 'string', description: 'The commit the change starts from, such as main or a merge commit^1' },
				head: { type: 'string', description: 'The last commit of the change, such as HEAD or a branch' },
				path: { type: 'string', description: 'Show only this file' },
			},
			required: ['base', 'head'],
			additionalProperties: false,
		},
		async execute(args, ctx) {
			const read = readArgs(args, 'diff')
			const range = await rangeAt(repo, read.text('base'), read.text('head'), ctx.signal)
			if (range.kind !== 'ok') return range.result
			const rawPath = read.optionalText('path')
			const only = rawPath === undefined ? undefined : pathOf(rawPath)
			if (only !== undefined && only.kind !== 'ok') return only.result
			const diff = await repo.diff(range, ctx.signal)
			if (diff.kind === 'too-large') return refuse('The diff is too large to read. Ask for a shorter range.')

			const files = only
				? diff.files.filter((file) => file.path === only.path || file.oldPath === only.path)
				: diff.files
			if (only && files.length === 0) return refuse(`${only.path} did not change in this range.`)
			const hunks = files.reduce((sum, file) => sum + (file.kind === 'text' ? file.hunks.length : 0), 0)
			const header = [
				`Diff ${short(range.base)}..${short(range.head)}: ${files.length} files, ${hunks} hunks.`,
				`Lines with + are at head ${short(range.head)}. Lines with - are at base ${short(range.base)}. Quote either without the sign and the number.`,
			].join('\n')
			const full = files.map(renderFile).join('\n\n')
			if (only) {
				const cut = full.length > MAX_DIFF_CHARS ? `\n[cut at ${MAX_DIFF_CHARS} characters]` : ''
				return reply(`${header}\n\n${full.slice(0, MAX_DIFF_CHARS)}${cut}`)
			}
			const used = await elsewhere(range, ctx.signal)
			const tail = used === null ? '' : `\n\n${used}`
			if (full.length <= MAX_DIFF_CHARS) return reply(`${header}\n\n${full}${tail}`)
			const overview = files.slice(0, MAX_OVERVIEW_FILES).map(renderOverview).join('\n')
			const more = files.length > MAX_OVERVIEW_FILES ? `\n... and ${files.length - MAX_OVERVIEW_FILES} more files` : ''
			return reply(
				`${header}\nThe whole diff is ${full.length} characters, too long to show. Files and hunks:\n${overview}${more}\nCall diff again with path for each file you need, all in one turn.${tail}`,
			)
		},
	}
}

function renderFile(file: FileDiff): string {
	const name = file.oldPath === file.path ? file.path : `${file.path} (renamed from ${file.oldPath})`
	if (file.kind === 'binary') return `${name}: binary file, no lines to show`
	if (file.hunks.length === 0) return `${name}: no lines changed`
	return [name, ...file.hunks.flatMap(renderHunk)].join('\n')
}

function renderHunk(hunk: Hunk): string[] {
	let oldLine = hunk.oldStart
	let newLine = hunk.newStart
	const rows = hunk.lines.map((line) => {
		if (line.startsWith('+')) return `+${String(newLine++).padStart(6)}\t${line.slice(1)}`
		if (line.startsWith('-')) return `-${String(oldLine++).padStart(6)}\t${line.slice(1)}`
		return line
	})
	return [hunkHeader(hunk), ...rows]
}

function renderOverview(file: FileDiff): string {
	const name = file.oldPath === file.path ? file.path : `${file.path} (renamed from ${file.oldPath})`
	if (file.kind === 'binary') return `${name}: binary file`
	const added = file.hunks.reduce((sum, hunk) => sum + hunk.newLength, 0)
	const removed = file.hunks.reduce((sum, hunk) => sum + hunk.oldLength, 0)
	return [
		`${name}: ${file.hunks.length} hunks, +${added} -${removed}`,
		...file.hunks.map((h) => `  ${hunkHeader(h)}`),
	].join('\n')
}

export function hunkHeader(hunk: Hunk): string {
	return `@@ -${hunk.oldStart},${hunk.oldLength} +${hunk.newStart},${hunk.newLength} @@`
}
