import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { checkCoverage, verifyGitQuote } from '../../src/checks/index.ts'
import { lookAtLayout, readLayoutAsk } from '../../src/layout/index.ts'
import { openSnapshots } from '../../src/live/index.ts'
import { openMap, openSeen } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

// The page is plain JavaScript in the browser, so the test loads it by path.
const page: { replyHtml: (q: object, t: number, ui: object, options: object) => string } = await import(
	path.join(import.meta.dirname, '../../src/page/views/reply.js')
)

// Three folders of src, one whose name starts like another's, and a README outside src.
const { root, hashes } = buildRepository([
	{
		message: 'feat: start',
		files: {
			'src/retry/loop.ts': 'retry()\n',
			'src/clock/wait.ts': 'wait()\n',
			'src/retryx/old.ts': 'old()\n',
			'README.md': '# demo\n',
		},
	},
	{
		message: 'feat: wait between attempts',
		files: { 'src/retry/loop.ts': 'retry()\nsleep(100)\n', 'src/retryx/old.ts': 'older()\n' },
	},
])
const [base = '', head = ''] = hashes
const repo = gitRepository(root)
const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
after(() => rmSync(home, { recursive: true, force: true }))

async function lookAndChange() {
	const record = fileRecordStore(root, repo)
	const [opened, looked] = await Promise.all([openMap(home, repo, record), openSeen(home, repo)])
	if (opened.kind !== 'ok' || looked.kind !== 'ok') assert.fail('the fixture has commits')
	const snapshots = await openSnapshots(home, repo, root)
	const sources = { root, repo, snapshots, record, map: opened.map, seen: looked.seen }
	const asked = await readLayoutAsk(sources, { within: ['src'], change: `${base}..${head}` }, new Date())
	if (asked.kind !== 'ok') assert.fail(asked.message)
	const look = await lookAtLayout(sources, asked.ask, new Date())
	const coverage = await checkCoverage(repo, { base, head }, [])
	if (coverage.kind !== 'ok') assert.fail('the fixture diff reads')
	return { look, hunks: coverage.uncovered }
}

async function claimOn(file: string, text: string) {
	const verified = await verifyGitQuote(repo, { path: file, commit: head, text })
	if (verified.kind !== 'verified') assert.fail(`the fixture holds ${text}`)
	return { kind: 'claim', claim: { text: `${file} says ${text}`, label: 'inferred', quotes: [verified.quote] } }
}

function uiAt(look: object, step: number | null, wide: boolean) {
	return {
		panel: { kind: 'checks' },
		openQuotes: new Set(),
		openDecisions: new Set(),
		unfolded: new Set(),
		changeLooks: new Map([[`${base}..${head}`, look]]),
		walkAt: new Map(step === null ? [] : [[0, step]]),
		wide,
	}
}

test('the step the reader is on lights the parts its quotes fall in and opens its changed lines as a diff under it, and a step that quotes outside every part and every hunk lights none and opens no diff', async () => {
	const { look, hunks } = await lookAndChange()
	const loop = hunks.find((each) => each.path === 'src/retry/loop.ts')
	const old = hunks.find((each) => each.path === 'src/retryx/old.ts')
	const change = {
		base,
		head,
		commits: [],
		covered: hunks,
		uncovered: [],
		binary: [],
		messages: null,
		usedElsewhere: null,
		stepHunks: [
			{ step: 1, hunks: [loop] },
			{ step: 2, hunks: [old] },
			{ step: 3, hunks: [] },
		],
	}
	const reply = {
		items: [
			{ kind: 'words', text: 'The retry now waits.' },
			{ kind: 'step', number: 2, text: 'An old helper changed too. Its call is renamed.' },
			{ kind: 'card', step: 2, card: await claimOn('src/retryx/old.ts', 'older()') },
			{ kind: 'step', number: 1, text: 'The loop sleeps. It waits a tenth of a second.' },
			{ kind: 'card', step: 1, card: await claimOn('src/retry/loop.ts', 'sleep(100)') },
			{ kind: 'step', number: 3, text: 'The README says nothing new.' },
			{ kind: 'card', step: 3, card: await claimOn('README.md', '# demo') },
		],
		change,
		topics: [],
	}
	const html = (step: number | null) =>
		page.replyHtml({ reply, steps: [] }, 0, uiAt(look, step, false), { running: false, inThread: true })
	const nameOf = (box: string) => look.boxes.find((each) => each.paths.some((place) => place === box))?.name ?? ''
	const litBoxes = (text: string) =>
		[...text.matchAll(/class="pv-cell[^"]*is-near[^>]*>.*?pv-name">([^<]+)</gs)].map((m) => m[1])

	const first = html(1)
	assert.ok(first.indexOf('The loop sleeps') < first.indexOf('An old helper changed too'), 'steps go by number')
	assert.match(first, /It waits a tenth of a second\./, "the step's words after its title show under it")
	assert.equal(first.match(/The loop sleeps/g)?.length, 1, 'its first sentence is its title, and is said once')
	assert.doesNotMatch(first, /Its call is renamed\./, 'the other steps show only their title')
	assert.deepEqual(litBoxes(first), [nameOf('src/retry')], 'step 1 lights the part of src/retry/loop.ts')
	assert.match(first, /src\/retry\/loop\.ts<\/code>, line 2 after the change/)
	assert.match(first, /<span class="ln"><\/span><span class="ln">2<\/span><span class="lc add">.*sleep\(100\)/)

	const second = html(2)
	assert.deepEqual(litBoxes(second), [nameOf('src/retryx')], 'a file of src/retryx is not in src/retry')
	assert.match(second, /<span class="ln">1<\/span><span class="ln"><\/span><span class="lc del">.*old\(\)/)

	const third = html(3)
	assert.deepEqual(litBoxes(third), [], 'a quote outside every part lights none')
	assert.match(third, /no diff to show/)

	const none = html(null)
	assert.deepEqual(litBoxes(none), [], 'before the reader picks a step, no part is lit')
	assert.doesNotMatch(none, /sleep\(100\)/, "a step's cards and diff wait until the reader is on it")
})

test('a reply saved before ken had steps still opens with its words and cards, and offers the walkthrough', async () => {
	const { look, hunks } = await lookAndChange()
	const saved = {
		steps: [],
		reply: {
			items: [
				{ kind: 'words', text: 'The retry now waits.' },
				{ kind: 'card', card: await claimOn('src/retry/loop.ts', 'sleep(100)') },
			],
			change: {
				base,
				head,
				commits: [],
				covered: hunks,
				uncovered: [],
				binary: [],
				messages: null,
				usedElsewhere: null,
			},
			topics: [],
		},
	}
	const html = page.replyHtml(saved, 0, uiAt(look, null, true), { running: false, inThread: true })

	assert.match(html, /The retry now waits\./)
	assert.match(html, /src\/retry\/loop\.ts says sleep\(100\)/)
	assert.match(html, /Walk me through it/)
	assert.doesNotMatch(html, /step by step/)
})
