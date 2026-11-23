// Start a question about where a value goes with a few lines from the revision the reader is looking at.
import { type CommitHash, directImports, namedExports, type Repository } from '../../repo/index.ts'

const ASKS_FOR_USES =
	/\b(?:callers?|consumers?|downstream|call sites?|used by|called by)\b|\b(?:where|who|what|which)\b[^.!?\n]{0,80}\b(?:calls?|uses?|used|called|consumes?|consumed|receives?|go(?:es)? next|flows?)\b/i

export async function sourceUses(
	repo: Repository,
	commit: CommitHash,
	path: string,
	lines: string[],
	start: number,
	end: number,
	question: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!ASKS_FOR_USES.test(question)) return ''
	const names = namedExports(path, lines, start, end)
	const named = names.filter((name) => new RegExp(`\\b${name}\\b`).test(question))
	const implicit =
		/\b(?:this|these|here|it|its|that|the (?:return|value|result|function))\b/i.test(question) ||
		/^(?:show (?:me )?)?(?:callers?|consumers?|downstream)[?.!]?$/i.test(question.trim())
	const name = named.length === 1 ? named[0] : implicit && names.length === 1 ? names[0] : undefined
	if (!name) return ''
	const outer = lines.slice(Math.max(0, start - 61), end).findLast((line) => /^\S/.test(line))
	// If the selected page cuts through a function, its nearby return explains what its callers receive.
	let following = ''
	if (
		outer &&
		/\{\s*$/.test(outer) &&
		new RegExp(`^export\\s+(?:async\\s+)?function\\s*\\*?\\s*${name}\\b`).test(outer)
	) {
		for (let index = end; index < Math.min(lines.length, end + 8); index++) {
			const line = lines[index] ?? ''
			if (/^\S/.test(line) && !/^}[;,]?\s*$/.test(line)) break
			const row = `${index + 1}\t${JSON.stringify(line)}\n`
			if (following.length + row.length > 500) break
			following += row
			if (line.startsWith('}')) break
		}
	}
	const tail = following ? `The selected function continues in the same file:\n${following}` : ''
	const found = await directImports(repo, commit, path, name, signal)
	let shown = ''
	for (const hit of found.lines) {
		const row = `${JSON.stringify(hit.path)}:${hit.line}\t${hit.text === null ? '[long line: open the file]' : JSON.stringify(hit.text)}\n`
		if (shown.length + row.length <= 1500) shown += row
	}
	if (!shown)
		return `${tail}The single-line relative import lookup provided no examples for ${name}. Search this revision for other references before drawing a conclusion.\n`
	return `${tail}At the same commit these files import ${name} from the selected file. The lines below are examples to trace. An import alone does not show where a value goes. Cite the lines that use the value with show.\n${shown}\n`
}
