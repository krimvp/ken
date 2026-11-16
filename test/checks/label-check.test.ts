import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCoverage, checkedInCode, checkQuote } from '../../src/checks/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

// The change lowers a limit. The file that uses it is outside the change.
const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/limits.ts': 'export const TIMEOUT_MS = 500\n',
			'src/load.ts': 'export const wait = () => fetchWithin(TIMEOUT_MS * 2)\n',
		},
	},
	{ message: 'fix: time out sooner', files: { 'src/limits.ts': 'export const TIMEOUT_MS = 100\n' } },
])
const [base = '', head = ''] = hashes

test('a risk is checked in the code when a quote at the head holds a line the change did not touch, and not when its quotes hold only changed lines', async () => {
	const repo = gitRepository(root)
	const quote = async (path: string, text: string) => {
		const checked = await checkQuote(repo, { path, commit: head, text })
		return checked.kind === 'verified'
			? checked.quote
			: assert.fail(`the fixture quote does not check: ${checked.kind}`)
	}
	const coverage = await checkCoverage(repo, { base, head }, [])
	if (coverage.kind !== 'ok') return assert.fail(`the fixture range does not resolve: ${coverage.kind}`)
	const hunks = [...coverage.covered, ...coverage.uncovered]
	const limit = await quote('src/limits.ts', 'export const TIMEOUT_MS = 100')
	const caller = await quote('src/load.ts', 'export const wait = () => fetchWithin(TIMEOUT_MS * 2)')

	assert.equal(checkedInCode([limit, caller], limit.commit, hunks), true, 'the caller is outside the change')
	assert.equal(checkedInCode([limit], limit.commit, hunks), false, 'the limit is a changed line')
})
