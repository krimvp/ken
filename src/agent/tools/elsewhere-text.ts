import type { NotFollowed, UsedElsewhere } from '../../checks/index.ts'
import type { Range } from '../../repo/index.ts'
import { short } from './tool-edge.ts'

// The end log and diff give a change's range: the text below, or null where the question needs none or already has it.
export type Elsewhere = (range: Range, signal: AbortSignal) => Promise<string | null>

const MAX_LINE_CHARS = 160
const HOW = { added: 'adds', altered: 'alters', removed: 'removes' } as const

// What log and diff over a change end with, so the agent reads the other users of what changed before it answers.
export function elsewhereText(used: UsedElsewhere): string {
	const head = `Used elsewhere, found by search: ken took from the changed lines the names the change defines, alters or removes, and searched the head commit ${short(used.head)} for each as a whole word. A search can miss a use, and a line can name a different thing with the same name, so read each place before you rely on it.`
	const names = used.names.map(({ name, how, sites }) => ({ name, how, places: sites.length, first: sites }))
	const listed =
		names.length === 0 ? ['ken found none of these names on any line outside the change.'] : namesText(names)
	return [head, ...listed, ...leftText(used)].join('\n')
}

// Each name with the change it had and its first places, as path:line: text.
export function namesText(names: NotFollowed[]): string[] {
	return names.flatMap(({ name, how, places, first }) => {
		const shown = first.slice(0, 6)
		const more = places > shown.length ? [`  and ${places - shown.length} more; search for ${name} to see them.`] : []
		return [
			`- ${name}, which the change ${HOW[how]}, at ${places === 1 ? '1 place' : `${places} places`}:`,
			...shown.map((site) => `  ${site.path}:${site.line}: ${cut(site.text.trim())}`),
			...more,
		]
	})
}

function leftText(used: UsedElsewhere): string[] {
	const { short: tooShort, common, unsearched, unlisted } = used.left
	const parts = [
		common.length > 0 ? `${common.length} on too many lines to follow (${common.join(', ')})` : '',
		tooShort > 0 ? `${tooShort} too short to search` : '',
		unsearched > 0 ? `${unsearched} past the first ${used.searched} ken searched` : '',
		unlisted > 0 ? `${unlisted} past the first ${used.names.length} listed` : '',
	].filter((part) => part !== '')
	return parts.length === 0 ? [] : [`Names left out: ${parts.join('; ')}.`]
}

function cut(line: string): string {
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [line cut]` : line
}
