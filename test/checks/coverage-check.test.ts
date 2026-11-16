import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCoverage, checkQuote, type GitQuote, type VerifiedGitQuote } from '../../src/checks/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const QUEUE = [
	'export function push(item: string) {',
	'\titems.push(item)',
	'}',
	'',
	'export function pop() {',
	'\treturn items.pop()',
	'}',
	'',
	'export function size() {',
	'\treturn items.length',
	'}',
]
const changedQueue = QUEUE.map((line, index) =>
	index === 1 ? '\titems.unshift(item)' : index === 9 ? '\treturn count' : line,
)

const { root } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/queue.ts': `${QUEUE.join('\n')}\n`,
			'src/legacy.go': 'package legacy\nfunc Old() int { return 1 }\nfunc Keep() int { return 2 }\n',
			'assets/icon.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]),
		},
	},
	{
		message: 'refactor: change the queue and drop Old',
		files: {
			'src/queue.ts': `${changedQueue.join('\n')}\n`,
			'src/legacy.go': 'package legacy\nfunc Keep() int { return 2 }\n',
			'assets/icon.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 2]),
		},
	},
])
const repo = gitRepository(root)

async function verified(quote: GitQuote): Promise<VerifiedGitQuote> {
	const result = await checkQuote(repo, quote)
	return result.kind === 'verified' ? result.quote : assert.fail(`fixture quote not verified: ${result.kind}`)
}

test('coverage marks a quoted hunk covered and lists the hunks the answer left out', async () => {
	const quotes = await Promise.all([
		verified({ path: 'src/queue.ts', commit: 'HEAD', text: '\titems.unshift(item)' }),
		verified({ path: 'src/legacy.go', commit: 'HEAD~1', text: 'func Old() int { return 1 }' }),
		// The old text of a hunk that also adds lines does not cover it: the answer must quote the code as it is now.
		verified({ path: 'src/queue.ts', commit: 'HEAD~1', text: '\treturn items.length' }),
	])
	const result = await checkCoverage(repo, { base: 'HEAD~1', head: 'HEAD' }, quotes)
	assert.deepEqual(result, {
		kind: 'ok',
		covered: [
			{
				path: 'src/legacy.go',
				oldPath: 'src/legacy.go',
				hunk: { oldStart: 2, oldLength: 1, newStart: 1, newLength: 0, lines: ['-func Old() int { return 1 }'] },
			},
			{
				path: 'src/queue.ts',
				oldPath: 'src/queue.ts',
				hunk: {
					oldStart: 2,
					oldLength: 1,
					newStart: 2,
					newLength: 1,
					lines: ['-\titems.push(item)', '+\titems.unshift(item)'],
				},
			},
		],
		uncovered: [
			{
				path: 'src/queue.ts',
				oldPath: 'src/queue.ts',
				hunk: {
					oldStart: 10,
					oldLength: 1,
					newStart: 10,
					newLength: 1,
					lines: ['-\treturn items.length', '+\treturn count'],
				},
			},
		],
		binary: ['assets/icon.png'],
	})
})

test('a quote of the line next to a deleted line does not cover the deletion', async () => {
	const quotes = [await verified({ path: 'src/legacy.go', commit: 'HEAD~1', text: 'package legacy' })]
	const result = await checkCoverage(repo, { base: 'HEAD~1', head: 'HEAD' }, quotes)
	assert.deepEqual(result.kind === 'ok' && result.uncovered.map(({ path, hunk }) => `${path}:${hunk.oldStart}`), [
		'src/legacy.go:2',
		'src/queue.ts:2',
		'src/queue.ts:10',
	])
})
