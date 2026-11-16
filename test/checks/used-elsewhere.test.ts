import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usedElsewhere } from '../../src/checks/index.ts'
import { gitRepository, type Repository, resolveRange } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const LIMITS = [
	'export const MAX_WAIT_MS = 500',
	'',
	'export type RetryPlan = {',
	'\ttries: number',
	'}',
	'',
	'export function backoff(attempt: number) {',
	'\treturn attempt * 2',
	'}',
	'',
	'export function legacyDelay() {',
	'\treturn 1',
	'}',
	'',
]
// The change lowers the constant, widens the type, changes the function's body, removes legacyDelay, and adds a line
// that itself calls backoff.
const CHANGED = [
	'export const MAX_WAIT_MS = 100',
	'',
	'export type RetryPlan = {',
	'\ttries: number',
	'\tjitter: boolean',
	'}',
	'',
	'export function backoff(attempt: number) {',
	'\treturn attempt * 3',
	'}',
	'export const FIRST_WAIT = backoff(1)',
	'',
]
const LOAD = [
	"import { backoff, MAX_WAIT_MS, type RetryPlan } from './limits.ts'",
	'',
	'const plan: RetryPlan = { tries: 3 }',
	'export const wait = () => Math.min(backoff(plan.tries), MAX_WAIT_MS)',
	'',
]
const JOBS = [
	'def schedule(job):',
	'    return job.at',
	'',
	'def record(job):',
	'    return job',
	'',
	'def go():',
	'    pass',
	'',
]
const JOBS_CHANGED = [
	'def schedule(job):',
	'    return job.at + 1',
	'',
	'def record(job):',
	'    return [job]',
	'',
	'def go():',
	'    return 0',
	'',
]
// record is on more lines than ken follows, so it is too common.
const BUSY = Array.from({ length: 45 }, (_, n) => `record(${n})`)

const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/limits.ts': LIMITS.join('\n'),
			'src/load.ts': LOAD.join('\n'),
			'src/old.ts': "import { legacyDelay } from './limits.ts'\nexport const delay = legacyDelay()\n",
			'app/jobs.py': JOBS.join('\n'),
			'app/run.py': 'from app.jobs import schedule, go\n\nschedule(job)\ngo()\n',
			'app/busy.py': BUSY.join('\n'),
			'docs/retry.md': 'Each retry waits `backoff(attempt)` milliseconds.\n',
		},
	},
	{
		message: 'fix: wait less, and plan jitter',
		files: { 'src/limits.ts': CHANGED.join('\n'), 'app/jobs.py': JOBS_CHANGED.join('\n') },
	},
])
const [base = '', head = ''] = hashes

async function found(repo: Repository, scope: { base: string; head: string }) {
	const range = await resolveRange(repo, scope)
	if (range.kind !== 'ok') return assert.fail(`the fixture range does not resolve: ${range.kind}`)
	const result = await usedElsewhere(repo, range.range)
	return result.kind === 'ok' ? result.used : assert.fail('the fixture change is too large to search')
}

test('a changed function, constant and type, in TypeScript and in Python, and a removed function are found with the lines elsewhere that use them, and never with a line of the change', async () => {
	const used = await found(gitRepository(root), { base, head })
	const places = Object.fromEntries(
		used.names.map(({ name, how, sites }) => [name, { how, at: sites.map((site) => `${site.path}:${site.line}`) }]),
	)

	assert.deepEqual(places, {
		legacyDelay: { how: 'removed', at: ['src/old.ts:1', 'src/old.ts:2'] },
		MAX_WAIT_MS: { how: 'altered', at: ['src/load.ts:1', 'src/load.ts:4'] },
		RetryPlan: { how: 'altered', at: ['src/load.ts:1', 'src/load.ts:3'] },
		backoff: { how: 'altered', at: ['src/load.ts:1', 'src/load.ts:4', 'docs/retry.md:1'] },
		schedule: { how: 'altered', at: ['app/run.py:1', 'app/run.py:3'] },
	})
	assert.deepEqual(used.left.common, ['record'], 'a name on more lines than ken follows is left out and named')
	assert.equal(used.left.short, 1, 'go is too short to search, and counted')
})

test('the bounds hold on a change to many names: ken searches at most 40, lists at most 20, and counts the rest', async () => {
	const names = Array.from({ length: 45 }, (_, n) => `LIMIT_NUMBER_${n}`)
	const many = buildRepository([
		{
			message: 'feat: limits',
			files: {
				'limits.py': names.map((name) => `${name} = 1`).join('\n'),
				'use.py': names.map((name) => `print(${name})`).join('\n'),
			},
		},
		{ message: 'fix: raise every limit', files: { 'limits.py': names.map((name) => `${name} = 2`).join('\n') } },
	])
	const [from = '', to = ''] = many.hashes
	const used = await found(gitRepository(many.root), { base: from, head: to })

	assert.deepEqual([used.searched, used.names.length, used.left.unsearched, used.left.unlisted], [40, 20, 5, 20])
})
