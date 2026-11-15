import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { checkProse } from '../../scripts/check/prose.ts'

const cases: { name: string; files: Record<string, string>; expected: string[] }[] = [
	{
		name: 'plain text passes, including words that only contain a flagged phrase',
		files: { 'README.md': 'Run the tests.\nThe deep divergence between the two runs is real.' },
		expected: [],
	},
	{
		name: 'an em dash fails, with or without spaces around it',
		files: { 'notes.md': 'one\ntwo\u2014three \u2014 four' },
		expected: [
			'notes.md:2: found "\u2014", write "a comma, a colon or a period"',
			'notes.md:2: found "\u2014", write "a comma, a colon or a period"',
		],
	},
	{
		name: 'curly quotes fail',
		files: { 'src/a.ts': "const s = '\u201Cit\u2019s\u201D'" },
		expected: [
			`src/a.ts:1: found "\u2019", write "'"`,
			'src/a.ts:1: found "\u201C", write """',
			'src/a.ts:1: found "\u201D", write """',
		],
	},
	{
		name: 'a listed word or phrase fails in any case, in every checked file type',
		files: {
			'a.md': 'We Leverage git.',
			'b.yml': 'name: works in order to ship',
			'c.json': '{ "x": "a ROBUST parser" }',
		},
		expected: [
			'a.md:1: found "Leverage", write "use"',
			'b.yml:1: found "in order to", write "to"',
			'c.json:1: found "ROBUST", write "name what it withstands"',
		],
	},
	{
		name: 'skipped paths and unchecked file types pass',
		files: {
			'.agents/skills/x/SKILL.md': 'We leverage git.',
			'third_party/x.md': 'We leverage git.',
			'vendor/x.md': 'We leverage git.',
			'package-lock.json': '{ "x": "robust" }',
			'notes.txt': 'We leverage git.',
		},
		expected: [],
	},
]

const scratch = mkdtempSync(path.join(tmpdir(), 'ken-prose-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

for (const [index, { name, files, expected }] of cases.entries()) {
	test(name, () => {
		const root = path.join(scratch, String(index))
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
			writeFileSync(path.join(root, file), text)
		}
		assert.deepEqual(checkProse(root, Object.keys(files)), expected)
	})
}
