import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkQuote, type Quote } from '../../src/checks/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const RETRY = [
	'export function retry(times: number) {   ',
	'\tfor (let i = 0; i < times; i++) {',
	'\t\tattempt()',
	'\t}',
	'}',
	'',
	'export function again(times: number) {',
	'\tfor (let i = 0; i < times; i++) {',
	'\t\tattempt()',
	'\t}',
	'}',
]

const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/retry.ts': `${RETRY.join('\n')}\n`,
			'tools/sum.py': 'def total(items):\n    return sum(items)\n',
			'docs/über.md': '# Größe\n\nDie Größe wird in Bytes gezählt. 日本語のテキスト\n',
		},
	},
	{ message: 'feat: add later', files: { 'src/later.ts': 'export const later = 1\n' } },
])
const repo = gitRepository(root)
const [start = '', later = ''] = hashes

const cases: { name: string; quote: Quote; expected: unknown }[] = [
	{
		name: 'a true quote is found at its lines, and keeps the text as it stands in the file',
		quote: {
			path: 'src/retry.ts',
			commit: 'HEAD~1',
			text: 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) {',
		},
		expected: {
			kind: 'verified',
			quote: { path: 'src/retry.ts', commit: start, startLine: 1, endLine: 2, text: `${RETRY[0]}\n${RETRY[1]}` },
			alsoAt: [],
		},
	},
	{
		name: 'trailing whitespace and blank lines around a quote do not break it, in a second language',
		quote: { path: 'tools/sum.py', commit: start, text: '\ndef total(items):  \n    return sum(items)\t\n\n' },
		expected: {
			kind: 'verified',
			quote: {
				path: 'tools/sum.py',
				commit: start,
				startLine: 1,
				endLine: 2,
				text: 'def total(items):\n    return sum(items)',
			},
			alsoAt: [],
		},
	},
	{
		name: 'a quote in non-ASCII text is found at its line',
		quote: { path: 'docs/über.md', commit: 'HEAD', text: 'Die Größe wird in Bytes gezählt. 日本語のテキスト' },
		expected: {
			kind: 'verified',
			quote: {
				path: 'docs/über.md',
				commit: later,
				startLine: 3,
				endLine: 3,
				text: 'Die Größe wird in Bytes gezählt. 日本語のテキスト',
			},
			alsoAt: [],
		},
	},
	{
		name: 'a repeated text without a hint is the first, and the result names the others',
		quote: { path: 'src/retry.ts', commit: start, text: `${RETRY[1]}\n${RETRY[2]}` },
		expected: {
			kind: 'verified',
			quote: { path: 'src/retry.ts', commit: start, startLine: 2, endLine: 3, text: `${RETRY[1]}\n${RETRY[2]}` },
			alsoAt: [8],
		},
	},
	{
		name: 'a repeated text with a line hint is the occurrence nearest the hint',
		quote: { path: 'src/retry.ts', commit: start, text: `${RETRY[1]}\n${RETRY[2]}`, line: 7 },
		expected: {
			kind: 'verified',
			quote: { path: 'src/retry.ts', commit: start, startLine: 8, endLine: 9, text: `${RETRY[1]}\n${RETRY[2]}` },
			alsoAt: [2],
		},
	},
	{
		name: 'a false quote is rejected',
		quote: { path: 'src/retry.ts', commit: start, text: '\tfor (let i = 0; i <= times; i++) {' },
		expected: { kind: 'not-found', path: 'src/retry.ts', commit: start, closest: [] },
	},
	{
		name: 'a quote that lost its indentation is rejected, and points at the lines it may mean',
		quote: { path: 'src/retry.ts', commit: start, text: 'attempt()' },
		expected: {
			kind: 'not-found',
			path: 'src/retry.ts',
			commit: start,
			closest: [
				{ line: 3, text: '\t\tattempt()' },
				{ line: 9, text: '\t\tattempt()' },
			],
		},
	},
	{
		name: 'a quote of only whitespace or punctuation is rejected',
		quote: { path: 'src/retry.ts', commit: start, text: ' \n\t}\n' },
		expected: { kind: 'empty' },
	},
	{
		name: 'a quote at a commit that does not resolve is rejected',
		quote: { path: 'src/retry.ts', commit: 'main~9', text: '\t\tattempt()' },
		expected: { kind: 'no-commit', ref: 'main~9' },
	},
	{
		name: 'a quote of a file that does not exist at that commit is rejected',
		quote: { path: 'src/later.ts', commit: start, text: 'export const later = 1' },
		expected: { kind: 'no-file', path: 'src/later.ts', commit: start },
	},
]

for (const { name, quote, expected } of cases) {
	test(name, async () => {
		assert.deepEqual(await checkQuote(repo, quote), expected)
	})
}
