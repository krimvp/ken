import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { readModelConfig } from '../../src/agent/index.ts'
import { openMap } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { nothingToRevise, scriptedModel } from '../fixtures/scripted-model.ts'

const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
// The fixture dates every commit, so a copy has the same hashes. The first test records a piece of work, so a test that
// needs the second look uses its own copy: the record would explain the change there.
const COMMITS = [
	{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	{ message: 'fix: add the items', files: { 'app.py': 'def total(items):\n    return sum(items)\n' } },
]
const { root, hashes } = buildRepository(COMMITS)
const [base = '', head = ''] = hashes
const NO_KEN_VARIABLES = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('KEN_')))

// Async, because the scripted model answers from this process while ken runs.
function ken(args: string[], env: Record<string, string | undefined>) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		execFile('node', [KEN, ...args], { env }, (error, stdout, stderr) => {
			resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
		})
	})
}

const SUM = { path: 'app.py', commit: head, text: '    return sum(items)' }

test('ken ask --json prints the reply, words and checked cards in order, and what it recorded, and ken record reads it back with no model', async () => {
	const model = await scriptedModel([
		{
			text: 'total now adds the items.',
			tool: 'ken__show',
			args: {
				scope: { base, head },
				work: { title: 'Fix total' },
				claims: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
				risks: [
					{
						text: 'A caller that passes text now gets a TypeError.',
						label: 'inferred',
						quotes: [SUM],
						weight: 'minor',
					},
				],
				diagrams: [
					{
						kind: 'component',
						title: 'What total uses',
						label: 'found-by-search',
						boxes: [{ name: 'total' }, { name: 'sum' }],
						arrows: [
							{ from: 'total', to: 'sum', text: 'calls', quotes: [SUM] },
							{ from: 'sum', to: 'total', text: 'returns to', quotes: [SUM] },
						],
					},
				],
				decisions: [
					{
						question: 'How does total add the items?',
						chosen: "Python's built-in sum",
						reason: 'The built-in is the shortest way to add a list.',
						reason_quotes: [],
						rejected: [],
						undo: 'easy',
						needs_owner: false,
						quotes: [SUM],
					},
				],
			},
		},
		{ text: '' },
		...nothingToRevise(1),
	])
	const env = {
		...NO_KEN_VARIABLES,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: model.baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_KEY',
		KEN_TEST_KEY: 'scripted-model-key',
	}
	const { code, stdout, stderr } = await ken(['ask', 'What did the fix do?', '--repo', root, '--json'], env)

	assert.equal(code, 0, `${stderr}${stdout}`)
	const result = JSON.parse(stdout)
	assert.equal(result.outcome, 'answered')
	const { items, change } = result.reply
	assert.deepEqual(
		items.map((item: { kind: string; text?: string; card?: { kind: string } }) => item.text ?? item.card?.kind),
		['total now adds the items.', 'diagram', 'claim', 'decision', 'risk'],
	)
	const verified = [{ path: 'app.py', commit: head, startLine: 2, endLine: 2, text: '    return sum(items)' }]
	assert.deepEqual(items[2].card.claim.quotes, verified)
	assert.deepEqual(items[4].card.risk, {
		text: 'A caller that passes text now gets a TypeError.',
		label: 'inferred',
		quotes: verified,
		weight: 'minor',
		checked: false,
	})
	assert.deepEqual(
		change.commits.map((commit: { subject: string }) => commit.subject),
		['fix: add the items'],
	)
	assert.deepEqual(change.uncovered, [])
	const { diagram } = items[1].card
	assert.deepEqual(
		[diagram.kind, diagram.arrows[0].number, diagram.arrows[0].label],
		['component', 3, 'found-by-search'],
	)
	assert.match(diagram.mermaid, /^flowchart LR\n.*"3\. calls"/s, 'the JSON carries the Mermaid text that draws it')
	assert.deepEqual(
		result.recorded.map((entry: { kind: string }) => entry.kind),
		['work', 'decision'],
	)

	const listed = await ken(['record', '--repo', root, '--json'], NO_KEN_VARIABLES)
	assert.equal(listed.code, 0, listed.stderr)
	assert.deepEqual(JSON.parse(listed.stdout), result.recorded)
	const decision = result.recorded[1]
	const one = await ken(['record', decision.id, '--repo', root, '--json'], NO_KEN_VARIABLES)
	assert.deepEqual(JSON.parse(one.stdout), decision)
	assert.equal(decision.label, 'inferred')
	assert.equal((await ken(['record', 'no-such-id', '--repo', root], NO_KEN_VARIABLES)).code, 1)
})

function withModel(baseUrl: string) {
	return {
		...NO_KEN_VARIABLES,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_KEY',
		KEN_TEST_KEY: 'scripted-model-key',
	}
}

test('ken ask prints the words, then the cards in the order the reply gives them, each risk with its weight', async () => {
	const risk = (text: string, weight: string) => ({ text, label: 'inferred', quotes: [SUM], weight })
	const model = await scriptedModel([
		{
			tool: 'ken__show',
			text: 'total returned 0 for every list. It now adds the items.',
			args: {
				scope: { base, head },
				claims: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
				risks: [
					risk('A caller that passes text now gets a TypeError.', 'minor'),
					risk('Every report that showed a total of 0 now shows a different number.', 'serious'),
					risk('A list of floats now gets a rounding error in its total.', 'minor'),
					risk('An export that summed the items itself now counts them twice.', 'serious'),
				],
			},
		},
		{ text: '' },
		...nothingToRevise(4),
	])
	const { code, stdout, stderr } = await ken(
		['ask', 'What did the fix do?', '--repo', buildRepository(COMMITS).root],
		withModel(model.baseUrl),
	)

	assert.equal(code, 0, `${stderr}${stdout}`)
	const lines = stdout.split('\n')
	const at = (start: string) => lines.findIndex((line) => line.includes(start))
	const shown = [
		'total returned 0 for every list',
		'total returns the sum',
		'A caller that passes',
		'Every report that',
		'A list of floats',
		'An export that',
	].map(at)
	assert.ok((shown[0] ?? -1) >= 0, `the reply is printed: ${stdout}`)
	assert.deepEqual(
		[...shown].sort((a, b) => a - b),
		shown,
		`the words, then the cards in the reply's order, the minor first risk first: ${stdout}`,
	)
	assert.deepEqual(
		shown.slice(2).map((line) => /\[(serious|minor), by ken's model\]/.exec(lines[line] ?? '')?.[1]),
		['minor', 'serious', 'minor', 'serious'],
		'each risk carries the weight the model gave it',
	)
})

// The fix branched from inside the change and was merged after it, so the change's head does not reach it.
test('ken ask prints a brief in the order the page shows it: the line, each thing to know with its drawing named and its quoted lines, the terms, then the questions', async () => {
	const model = await scriptedModel([
		{
			tool: 'ken__show',
			args: {
				brief: {
					number: 1,
					line: 'Adds up a list of items.',
					points: [
						{
							line: 'total hands the list to sum.',
							more: 'total returns what sum makes of the items.',
							long: 'total does no adding of its own. It returns what sum makes of the list.',
							drawing: { kind: 'fanin', label: 'sum' },
							quotes: [{ path: 'app.py', text: '    return sum(items)' }],
						},
					],
					terms: [
						{ name: 'items', means: 'The list total adds up.', quote: { path: 'app.py', text: 'def total(items):' } },
					],
					questions: ['What does total return for an empty list?'],
				},
			},
		},
		{ text: 'That is all of it.' },
	])
	const { code, stdout, stderr } = await ken(['ask', 'Explain total', '--repo', buildRepository(COMMITS).root], {
		...withModel(model.baseUrl),
		KEN_HOME: mkdtempSync(path.join(tmpdir(), 'ken-home-')),
	})
	assert.equal(code, 0, stderr)
	const order = [
		'Brief 1. Adds up a list of items.',
		'  1. total hands the list to sum.',
		'drawn as fanin, "sum"',
		'total returns what sum makes of the items.',
		'total does no adding of its own. It returns what sum makes of the list.',
		'    return sum(items)',
		'  Terms',
		'    items: The list total adds up.',
		'def total(items):',
		'  Questions worth asking',
		'    - What does total return for an empty list?',
		'That is all of it.',
	]
	const at = order.map((text) => stdout.indexOf(text))
	assert.ok(
		at.every((place, k) => place > (at[k - 1] ?? -1)),
		`each part of the brief prints, in order: ${at}\n${stdout}`,
	)
})

test('ken ask marks a risk that quotes a later commit as fixed since in that commit, even when the fix branched from inside the change', async () => {
	const later = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
		{ message: 'fix: add the items', files: { 'app.py': 'def total(items):\n    return sum(items)\n' } },
		{ message: 'docs: say what total does', files: { 'README.md': 'total adds the items.\n' } },
		{
			message: 'fix: skip text in total',
			body: 'A caller that passed text got a TypeError.',
			files: { 'text.py': 'def numbers(items):\n    return [i for i in items if not isinstance(i, str)]\n' },
			parent: 1,
		},
		{ message: 'Merge the text fix', files: {}, parent: 2, merge: 3 },
	])
	const [from = '', , to = '', fix = ''] = later.hashes
	const sum = { path: 'app.py', commit: to, text: '    return sum(items)' }
	const fixed = {
		text: 'A caller that passes text gets a TypeError.',
		label: 'inferred',
		quotes: [{ path: null, commit: fix, text: 'A caller that passed text got a TypeError.' }],
		weight: 'serious',
	}
	const open = { text: 'A list of floats gets a rounding error.', label: 'inferred', quotes: [sum], weight: 'minor' }
	const model = await scriptedModel([
		{
			tool: 'ken__show',
			text: 'total returned 0 for every list. It now adds the items.',
			args: {
				scope: { base: from, head: to },
				claims: [{ text: 'total returns the sum of the items.', label: 'inferred', quotes: [sum] }],
				risks: [fixed, open],
			},
		},
		{ text: '' },
		...nothingToRevise(2),
	])
	const { code, stdout, stderr } = await ken(
		['ask', 'What did the fix do?', '--repo', later.root],
		withModel(model.baseUrl),
	)

	assert.equal(code, 0, `${stderr}${stdout}`)
	const [stillOpen, wasFixed] = [open.text, fixed.text].map((text) =>
		stdout.split('\n').find((line) => line.includes(text)),
	)
	assert.match(wasFixed ?? '', new RegExp(`A caller that passes text.*\\[Fixed since, in ${fix.slice(0, 7)}\\]`))
	assert.doesNotMatch(stillOpen ?? '', /Fixed since/, `the open risk has no such mark: ${stdout}`)
})

test('ken ask prints a risk the second look withdrew with the line that rules it out, apart from the risks, and the search ken made for what a card says is missing', async () => {
	const risk = (text: string) => ({ text, label: 'inferred', quotes: [SUM], weight: 'minor' })
	const model = await scriptedModel([
		{
			tool: 'ken__show',
			text: 'total returned 0 for every list. It now adds the items.',
			args: {
				scope: { base, head },
				claims: [{ text: 'No test covers total.', label: 'inferred', quotes: [SUM], absent: { text: 'test_total' } }],
				risks: [risk('An empty list now fails.'), risk('A caller that passes text now gets a TypeError.')],
			},
		},
		{ text: '' },
		{
			tool: 'review__revise_risks',
			args: { withdraw: [{ risk: 1, reason: 'sum of an empty list is 0.', quotes: [SUM] }], order: [2] },
		},
		{ text: 'The second look took one risk out.' },
	])
	const { code, stdout, stderr } = await ken(
		['ask', 'What did the fix do?', '--repo', buildRepository(COMMITS).root],
		withModel(model.baseUrl),
	)

	assert.equal(code, 0, `${stderr}${stdout}`)
	assert.match(
		stdout,
		/Withdrawn by the second look: An empty list now fails\.\n {3}Ruled out: sum of an empty list is 0\.\n {3}app\.py @ \w{7}, line 2\n.*return sum\(items\)/,
		stdout,
	)
	assert.doesNotMatch(stdout, /Risk: An empty list now fails/, 'the withdrawn risk is not among the risks')
	assert.match(stdout, /Risk: A caller that passes text/)
	assert.match(stdout, /No test covers total\.[^\n]*\n {3}ken searched for `test_total` at \w{7} and found nothing\./)
})

test('ken refuses to start without a model, and says what to set', async () => {
	const cases = [
		{ env: NO_KEN_VARIABLES, names: ['KEN_MODEL', 'KEN_BASE_URL', 'KEN_API_KEY_ENV'] },
		{
			env: {
				...NO_KEN_VARIABLES,
				KEN_MODEL: 'm',
				KEN_BASE_URL: 'http://127.0.0.1:9/v1',
				KEN_API_KEY_ENV: 'KEN_NO_KEY',
			},
			names: ['KEN_NO_KEY'],
		},
		{
			env: {
				...NO_KEN_VARIABLES,
				KEN_MODEL: 'm',
				KEN_BASE_URL: 'http://127.0.0.1:9/v1',
				KEN_API_KEY_ENV: 'KEN_SHORT_KEY',
				KEN_SHORT_KEY: 'abc',
			},
			names: ['KEN_SHORT_KEY'],
		},
	]
	for (const { env, names } of cases) {
		const { code, stdout, stderr } = await ken(['ask', 'What changed?', '--repo', root], env)
		assert.equal(code, 2, stderr)
		assert.equal(stdout, '')
		for (const name of names) assert.ok(stderr.includes(name), `the message names ${name}: ${stderr}`)
		assert.doesNotMatch(stderr, /^\s+at /m, 'a plain message, not a stack trace')
	}
})

test('with no model set, ken gives a line to copy for each common setup, and each line sets a model ken accepts', async () => {
	const { code, stderr } = await ken(['ask', 'What changed?', '--repo', root], NO_KEN_VARIABLES)

	assert.equal(code, 2, stderr)
	for (const setup of [/Ollama Cloud/, /LiteLLM/, /Claude Code[^\n]*Run ken-claude-endpoint/])
		assert.match(stderr, setup)
	const lines = stderr.split('\n').flatMap((line) => line.match(/^\s+export (.+)$/)?.slice(1) ?? [])
	assert.equal(lines.length, 3, stderr)
	for (const line of lines) {
		const env: Record<string, string | undefined> = Object.fromEntries(
			line.split(' ').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
		)
		// The reader puts their own key in the variable the line names.
		env[env.KEN_API_KEY_ENV ?? ''] ??= 'a-key-of-some-length'
		assert.equal(readModelConfig({}, env).kind, 'ok', line)
	}
})

test('ken catch-up lists the topics whose code changed since the reader understood them, with no model', async () => {
	const project = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(project.root)
	const record = fileRecordStore(project.root, repo)
	const at = { path: 'app.py', commit: 'HEAD' }
	await record.append(
		[
			{ kind: 'topic', name: 'totals', quotes: [{ ...at, text: '    return 0' }] },
			{ kind: 'topic', name: 'naming', quotes: [{ ...at, text: 'def total(items):' }] },
		],
		'project',
	)
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	await opened.map.learn('know', ['totals', 'naming'], new Date())
	writeFileSync(path.join(project.root, 'app.py'), 'def total(items):\n    return sum(items)\n')
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', 'fix: add them'], {
		cwd: project.root,
	})

	const { code, stdout, stderr } = await ken(['catch-up', '--repo', project.root], {
		...NO_KEN_VARIABLES,
		KEN_HOME: home,
	})

	assert.equal(code, 2, 'no model, so nothing explains the list')
	assert.match(stdout, /^- You understood totals .*changed since: app\.py line 2\.$/m)
	assert.doesNotMatch(stdout, /naming/, 'a topic whose code did not change is not listed')
	assert.match(stderr, /KEN_MODEL/)
})

test('ken follow-up prints what is open with no model: the decision that needs the owner, and the topic a collaborator changed with their commit', async () => {
	const project = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(project.root)
	const record = fileRecordStore(project.root, repo)
	const zero = { path: 'app.py', commit: 'HEAD', text: '    return 0' }
	await record.append(
		[
			{ kind: 'topic', name: 'totals', quotes: [zero] },
			{
				kind: 'decision',
				question: 'What does an empty cart cost?',
				chosen: 'Zero',
				reason: { text: 'Nothing bought costs nothing.', quotes: [] },
				rejected: [],
				undo: 'easy',
				needsOwner: true,
				quotes: [zero],
				work: null,
			},
		],
		'project',
	)
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the repository has commits')
	await opened.map.learn('know', ['totals'], new Date())
	writeFileSync(path.join(project.root, 'app.py'), 'def total(items):\n    return sum(items)\n')
	const bo = { NAME: 'Bo Helper', EMAIL: 'bo@example.com' }
	const as = Object.fromEntries(
		['AUTHOR', 'COMMITTER'].flatMap((who) => Object.entries(bo).map(([key, value]) => [`GIT_${who}_${key}`, value])),
	)
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '--message', 'fix: add them'], {
		cwd: project.root,
		env: { ...process.env, ...as },
	})
	const hash = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: project.root, encoding: 'utf8' }).trim()

	const { code, stdout, stderr } = await ken(['follow-up', '--repo', project.root], {
		...NO_KEN_VARIABLES,
		KEN_HOME: home,
	})

	assert.equal(code, 2, 'no model, so nothing explains the list')
	assert.match(stdout, /^- A decision needs your call: What does an empty cart cost\? What was chosen: "Zero/m)
	assert.match(
		stdout,
		new RegExp(`^- totals changed since .*: app\\.py line 2\\. .*${hash} by Bo Helper \\(a collaborator\\)`, 'm'),
	)
	assert.match(stderr, /KEN_MODEL/)
})
