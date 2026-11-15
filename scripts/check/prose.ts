// Keeps the repository's prose plain. It fails on the em dash, curly quotes, and the stock words of machine-written text,
// and names the plain word to use instead. It cannot judge a sentence. For that, read the plain-words skill.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// What the check flags, and what to write instead. Words and phrases match whole and in any case. Add one per line.
const PLAIN: Record<string, string> = {
	'\u2014': 'a comma, a colon or a period',
	'\u2018': "'",
	'\u2019': "'",
	'\u201C': '"',
	'\u201D': '"',
	delve: 'look into',
	leverage: 'use',
	utilize: 'use',
	seamless: 'cut it, or say what happens',
	seamlessly: 'cut it, or say what happens',
	robust: 'name what it withstands',
	comprehensive: 'full, or list what it covers',
	crucial: 'needed, or cut it',
	pivotal: 'cut it',
	tapestry: 'cut it',
	testament: 'cut it',
	synergy: 'cut it',
	empower: 'let, or help',
	streamline: 'simplify, or shorten',
	holistic: 'whole',
	'cutting-edge': 'cut it, or say what is new',
	'state-of-the-art': 'cut it, or say what is new',
	'best-in-class': 'cut it, or give the measure',
	'world-class': 'cut it, or give the measure',
	'game-changer': 'say what changes',
	'game-changing': 'say what changes',
	supercharge: 'say what gets faster, and by how much',
	effortless: 'easy, or say the steps',
	effortlessly: 'easily, or say the steps',
	'blazing fast': 'give the number',
	'blazingly fast': 'give the number',
	'deep dive': 'a close look',
	'dive into': 'read, or look at',
	'under the hood': 'inside',
	'at its core': 'cut it',
	"it's worth noting": 'cut it',
	'it is worth noting': 'cut it',
	'it is important to note': 'cut it',
	'in order to': 'to',
	'needless to say': 'cut it',
}

const EXTENSIONS = new Set(['.md', '.ts', '.js', '.html', '.css', '.yml', '.json'])
// The word list and its test have to spell out the words they flag.
const SKIPPED = [
	'.agents/',
	'third_party/',
	'vendor/',
	'package-lock.json',
	'scripts/check/prose.ts',
	'test/check/prose.test.ts',
]

const RULES = Object.entries(PLAIN).map(([found, write]) => {
	const edge = (end: string) => (/\w/.test(end) ? '\\b' : '')
	const escaped = found.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return { pattern: new RegExp(`${edge(found.at(0) ?? '')}${escaped}${edge(found.at(-1) ?? '')}`, 'gi'), write }
})

export function checkProse(root: string, files: string[]): string[] {
	const findings: string[] = []
	for (const file of files) {
		if (!EXTENSIONS.has(path.extname(file)) || SKIPPED.some((skip) => file.startsWith(skip))) continue
		const fullPath = path.join(root, file)
		// git still lists a tracked file that was deleted and not yet staged.
		if (!existsSync(fullPath)) continue
		for (const [index, line] of readFileSync(fullPath, 'utf8').split('\n').entries()) {
			for (const { pattern, write } of RULES) {
				for (const [found] of line.matchAll(pattern)) {
					findings.push(`${file}:${index + 1}: found "${found}", write "${write}"`)
				}
			}
		}
	}
	return findings
}

if (import.meta.main) {
	const root = path.join(import.meta.dirname, '../..')
	// Untracked files count too, so new prose fails before its first commit.
	const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
		cwd: root,
		encoding: 'utf8',
	})
	const findings = checkProse(root, listed.split('\n').filter(Boolean))
	for (const finding of findings) console.error(finding)
	process.exitCode = findings.length > 0 ? 1 : 0
}
