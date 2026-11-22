// What a project says it is, in its own words: the first paragraph of prose in the README at its top. Headings,
// badges, pictures, HTML, code and tables come before it in many READMEs, so they are passed over.
import { checkQuote, type VerifiedGitQuote } from '../checks/index.ts'
import { type CommitHash, parsePath, type Repository } from '../repo/index.ts'

const README = /^readme(\.(md|markdown|rst|txt|adoc))?$/i
// A paragraph past this many lines is cut there, so Home quotes a paragraph and not a page.
const MOST_LINES = 8

// Lines that are no prose: a heading or its underline, a note set apart, a picture or badge, HTML, a fence, a table,
// a rule, a list.
const NOT_PROSE = /^\s*(#|>|<|!\[|\[!\[|```|~~~|\||[-=*_]{3,}\s*$|[-*+] |\d+\. |\.\. |:)/

export async function readmeAbout(
	repo: Repository,
	head: CommitHash,
	files: string[],
): Promise<VerifiedGitQuote | null> {
	const file = files.find((each) => README.test(each))
	const path = file === undefined ? null : parsePath(file)
	if (path?.kind !== 'ok') return null
	const read = await repo.readFile(head, path.path)
	if (read.kind !== 'ok') return null
	const lines = read.text.split('\n')
	let start = frontMatterEnd(lines)
	let fenced = false
	for (; start < lines.length; start++) {
		const line = lines[start] ?? ''
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
		else if (!fenced && line.trim() !== '' && !NOT_PROSE.test(line)) break
	}
	if (start >= lines.length) return null
	let end = start
	while (end + 1 < lines.length && end - start + 1 < MOST_LINES && (lines[end + 1] ?? '').trim() !== '') end++
	const text = lines.slice(start, end + 1).join('\n')
	const checked = await checkQuote(repo, { path: path.path, commit: head, text, line: start + 1 })
	return checked.kind === 'verified' ? checked.quote : null
}

function frontMatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0
	const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
	return close < 0 ? 0 : close + 1
}
