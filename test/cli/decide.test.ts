import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'

const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
const APP = 'def total(items):\n    return sum(items)\n'
const project = () =>
	buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
		{ message: 'fix: add the items', files: { 'app.py': APP } },
	])
const { root, hashes } = project()
const head = hashes[1]

function ken(args: string[], { input, repo = root }: { input?: string; repo?: string } = {}) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		const child = execFile('node', [KEN, ...args, '--repo', repo], (error, stdout, stderr) => {
			resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
		})
		child.stdin?.end(input)
	})
}

function emptyRecord() {
	rmSync(path.join(root, '.ken'), { recursive: true, force: true })
}

const DECISION = [
	'--question',
	'How does total add the items?',
	'--chosen',
	"Python's built-in sum",
	'--reason',
	'The built-in is the shortest way to add a list.',
	'--rejected',
	'A for loop: more lines for the same result',
	'--undo',
	'easy',
	'--quote',
	'app.py:2',
	'--by',
	'claude-code',
]

test('ken decide logs a decision with a true quote, labelled recorded by the command, and ken record shows it', async () => {
	emptyRecord()
	const logged = await ken(['decide', ...DECISION])

	assert.equal(logged.code, 0, logged.stderr)
	const id = /^Logged decision (\w+) /.exec(logged.stdout)?.[1]
	const listed = await ken(['record', '--json'])
	const [{ at, ...entry }, ...others] = JSON.parse(listed.stdout)
	assert.deepEqual(others, [])
	assert.ok(!Number.isNaN(Date.parse(at)), `at is a time: ${at}`)
	assert.deepEqual(entry, {
		id,
		kind: 'decision',
		question: 'How does total add the items?',
		chosen: "Python's built-in sum",
		reason: { text: 'The built-in is the shortest way to add a list.', quotes: [] },
		rejected: [{ option: 'A for loop', reason: 'more lines for the same result' }],
		undo: 'easy',
		needsOwner: false,
		label: 'recorded',
		logged: { by: 'claude-code', head },
		quotes: [{ path: 'app.py', commit: head, startLine: 2, endLine: 2, text: '    return sum(items)' }],
		work: null,
		topic: null,
		replaces: null,
	})
	const text = await ken(['record'])
	assert.equal(text.stdout, `decision ${id} "How does total add the items?" [recorded, logged by claude-code]\n`)
})

test('a false quote, a quote of uncommitted lines, an empty reason and an unknown undo are each refused with a sentence, and nothing is written', async () => {
	const without = (option: string) => {
		const at = DECISION.indexOf(option)
		return [...DECISION.slice(0, at), ...DECISION.slice(at + 2)]
	}
	const cases = [
		{ args: [...without('--quote'), '--quote', 'app.py:3'], says: /app\.py has 2 lines at HEAD/ },
		{ args: [...without('--quote'), '--quote', 'app.py:2@no-such-commit'], says: /no commit "no-such-commit"/ },
		{ args: DECISION, edit: 'def total(items):\n    return 1\n', says: /working tree differs from HEAD at line 2/ },
		{ args: [...without('--reason'), '--reason', '  '], says: /the reason is empty/ },
		{ args: [...without('--undo'), '--undo', 'trivial'], says: /easy, some-work or hard, not "trivial"/ },
	]
	// Each case runs in a repository of its own, at the same time as the others, because each ken start takes 0.4 s.
	const runs = cases.map(async ({ args, edit, says }) => {
		const repo = project().root
		if (edit) writeFileSync(path.join(repo, 'app.py'), edit)
		return { repo, says, refused: await ken(['decide', ...args], { repo }) }
	})
	for (const { repo, says, refused } of await Promise.all(runs)) {
		assert.equal(refused.code, 1, `${says}: ${refused.stdout}`)
		assert.match(refused.stderr, says)
		assert.equal(existsSync(path.join(repo, '.ken')), false, `nothing is written for ${says}`)
	}
})

test('the decision as JSON on standard input is the same entry as the one given with options', async () => {
	emptyRecord()
	const options = await ken(['decide', ...DECISION])
	const input = JSON.stringify({
		question: 'How does total add the items?',
		chosen: "Python's built-in sum",
		reason: 'The built-in is the shortest way to add a list.',
		rejected: [{ option: 'A for loop', reason: 'more lines for the same result' }],
		undo: 'easy',
		quotes: ['app.py:2'],
		by: 'claude-code',
	})
	const json = await ken(['decide', '--json'], { input })

	assert.equal(json.code, 0, json.stderr)
	const id = /^Logged (decision \w+) /.exec(options.stdout)?.[1]
	assert.ok(id, options.stdout)
	assert.ok(json.stdout.startsWith(`The record already holds ${id} `), json.stdout)
	const lines = readFileSync(path.join(root, '.ken/record/decisions.jsonl'), 'utf8').trimEnd().split('\n')
	assert.equal(lines.length, 1)
})

test('the caller cannot set the label, as an option or in JSON', async () => {
	emptyRecord()
	const input = JSON.stringify({ question: 'Q?', chosen: 'x', reason: 'y', undo: 'easy', label: 'from-the-session' })
	const [option, json] = await Promise.all([
		ken(['decide', ...DECISION, '--label', 'inferred']),
		ken(['decide', '--json'], { input }),
	])

	assert.notEqual(option.code, 0)
	assert.match(option.stderr, /--label\. ken sets the label itself/)
	assert.equal(json.code, 1)
	assert.match(json.stderr, /ken sets the label itself, so leave "label" out/)
	assert.equal(existsSync(path.join(root, '.ken')), false)
})
