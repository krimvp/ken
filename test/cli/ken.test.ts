import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { openMap } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'
import { DRAFT, nothingToRevise, scriptedModel } from '../fixtures/scripted-model.ts'

const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
const { root, hashes } = buildRepository([
	{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	{ message: 'fix: add the items', files: { 'app.py': 'def total(items):\n    return sum(items)\n' } },
])
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

test('ken ask --json prints the checked answer, what it recorded and the closing note, and ken record reads it back with no model', async () => {
	const model = await scriptedModel([
		DRAFT,
		{
			text: 'Let me read the diff.',
			tool: 'ken__answer',
			args: {
				scope: { base, head },
				work: { title: 'Fix total' },
				summary: 'total now adds the items.',
				statements: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
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
		...nothingToRevise(1),
		{ text: 'Nothing was left out.' },
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
	assert.equal(result.note, 'Nothing was left out.', 'the note holds only what the agent wrote after the answer')
	const verified = [{ path: 'app.py', commit: head, startLine: 2, endLine: 2, text: '    return sum(items)' }]
	assert.deepEqual(result.answer.statements[0].quotes, verified)
	assert.deepEqual(result.answer.risks, [
		{
			text: 'A caller that passes text now gets a TypeError.',
			label: 'inferred',
			quotes: verified,
			weight: 'minor',
			checked: false,
		},
	])
	assert.deepEqual(
		result.answer.change.commits.map((commit: { subject: string }) => commit.subject),
		['fix: add the items'],
	)
	assert.deepEqual(result.answer.change.uncovered, [])
	const [diagram] = result.answer.diagrams
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

test('ken ask prints the risks in the order the answer gives them, whatever their weight, each with its weight, and says how many points of the draft it left out', async () => {
	const risk = (text: string, weight: string) => ({ text, label: 'inferred', quotes: [SUM], weight })
	const model = await scriptedModel([
		DRAFT,
		{
			tool: 'ken__answer',
			args: {
				scope: { base, head },
				summary: 'total returned 0 for every list. It now adds the items. Watch the reports that showed 0.',
				statements: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
				risks: [
					risk('A caller that passes text now gets a TypeError.', 'minor'),
					risk('Every report that showed a total of 0 now shows a different number.', 'serious'),
					risk('A list of floats now gets a rounding error in its total.', 'minor'),
					risk('An export that summed the items itself now counts them twice.', 'serious'),
				],
				left_out: ['a guess about who reads the reports'],
			},
		},
		...nothingToRevise(4),
		{ text: 'Nothing else.' },
	])
	const env = {
		...NO_KEN_VARIABLES,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: model.baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_KEY',
		KEN_TEST_KEY: 'scripted-model-key',
	}
	const { code, stdout, stderr } = await ken(['ask', 'What did the fix do?', '--repo', root], env)

	assert.equal(code, 0, `${stderr}${stdout}`)
	const lines = stdout.split('\n')
	const at = (start: string) => lines.findIndex((line) => line.includes(start))
	const shown = ['A caller that passes', 'Every report that', 'A list of floats', 'An export that'].map(at)
	assert.deepEqual(
		[...shown].sort((a, b) => a - b),
		shown,
		`the risks come in the answer's order, the minor first one first: ${stdout}`,
	)
	assert.ok((shown[0] ?? -1) > 0, `the risks are printed: ${stdout}`)
	assert.deepEqual(
		shown.map((line) => /\[(serious|minor), by ken's model\]/.exec(lines[line] ?? '')?.[1]),
		['minor', 'serious', 'minor', 'serious'],
		'each risk carries the weight the model gave it',
	)
	assert.match(stdout, /1 point of the draft had no line to quote/)
})

test('ken ask prints the risks the second look withdrew as one count, each with the line that rules it out', async () => {
	const risk = (text: string) => ({ text, label: 'inferred', quotes: [SUM], weight: 'minor' })
	const model = await scriptedModel([
		DRAFT,
		{
			tool: 'ken__answer',
			args: {
				scope: { base, head },
				summary: 'total returned 0 for every list. It now adds the items.',
				statements: [{ text: 'total returns the sum of the items instead of 0.', label: 'inferred', quotes: [SUM] }],
				risks: [risk('An empty list now fails.'), risk('A caller that passes text now gets a TypeError.')],
			},
		},
		{ text: '' },
		{
			tool: 'ken__revise_answer',
			args: {
				withdraw: [{ risk: 1, reason: 'sum of an empty list is 0.', quotes: [SUM] }],
				order: [2],
			},
		},
		{ text: 'Nothing else.' },
	])
	const env = {
		...NO_KEN_VARIABLES,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: model.baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_KEY',
		KEN_TEST_KEY: 'scripted-model-key',
	}
	const { code, stdout, stderr } = await ken(['ask', 'What did the fix do?', '--repo', root], env)

	assert.equal(code, 0, `${stderr}${stdout}`)
	assert.match(
		stdout,
		/1 risk withdrawn by the second look, with the line that rules it out:\n1\. An empty list now fails\.[^\n]*\n {3}Ruled out: sum of an empty list is 0\.\n {3}app\.py @ \w{7}, line 2\n.*return sum\(items\)/,
		stdout,
	)
	assert.match(stdout, /Risks, heaviest first \(1\):/, 'the withdrawn risk is not among the risks')
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

test('ken catch-up lists the topics whose code changed since the reader understood them, with no model', async () => {
	const project = buildRepository([
		{ message: 'feat: start', files: { 'app.py': 'def total(items):\n    return 0\n' } },
	])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(project.root)
	const record = fileRecordStore(project.root, repo)
	const at = { path: 'app.py', commit: 'HEAD' }
	await record.append([
		{ kind: 'topic', name: 'totals', quotes: [{ ...at, text: '    return 0' }] },
		{ kind: 'topic', name: 'naming', quotes: [{ ...at, text: 'def total(items):' }] },
	])
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
	await record.append([
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
	])
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
