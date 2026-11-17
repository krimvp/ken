import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { CARD_KINDS, type Card, type CardKind } from '../../src/agent/index.ts'
import { verifyGitQuote } from '../../src/checks/index.ts'
import { drawn } from '../../src/diagram/index.ts'
import { lookAtLayout, readLayoutAsk } from '../../src/layout/index.ts'
import { openSnapshots } from '../../src/live/index.ts'
import { openMap } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

// The page is plain JavaScript in the browser, so the test loads it by path and says what it expects to find.
const page: { replyHtml: (q: object, t: number, ui: object, options: object) => string } = await import(
	path.join(import.meta.dirname, '../../src/page/views/reply.js')
)

const { root } = buildRepository([{ message: 'feat: start', files: { 'src/retry.ts': 'retry()\n\t\tsleep(100)\n' } }])
const verified = await verifyGitQuote(gitRepository(root), {
	path: 'src/retry.ts',
	commit: 'HEAD',
	text: '\t\tsleep(100)',
})
if (verified.kind !== 'verified') throw new Error('the fixture quote is in the fixture repository')
const { quote } = verified
const claim = { text: 'The loop sleeps after each attempt.', label: 'inferred' as const, quotes: [quote] }
const risk = { ...claim, text: 'A caller that needs an answer at once now waits.', weight: 'serious' as const }
const box = (number: number, name: string) => ({ number, name, group: null, quotes: [] })
const arrow = { number: 3, from: 'retry', to: 'sleep', text: 'calls', label: 'inferred' as const, quotes: [quote] }

// One card of every kind, each with a text the reader must see. The compiler asks for a new kind here.
const SAMPLES: { [K in CardKind]: { card: Extract<Card, { kind: K }>; text: string } } = {
	claim: { card: { kind: 'claim', claim }, text: claim.text },
	risk: { card: { kind: 'risk', risk }, text: risk.text },
	decision: {
		card: {
			kind: 'decision',
			decision: {
				kind: 'decision',
				question: 'How long does a retry wait?',
				chosen: 'A fixed 100 ms',
				reason: { text: 'One fixed wait is the simplest.', quotes: [] },
				rejected: [],
				undo: 'easy',
				needsOwner: false,
				label: 'inferred',
				quotes: [quote],
				work: null,
				topic: null,
				answer: null,
			},
		},
		text: 'How long does a retry wait?',
	},
	diagram: {
		card: {
			kind: 'diagram',
			diagram: drawn({
				kind: 'component',
				title: 'What retry does between attempts',
				label: 'inferred',
				boxes: [box(1, 'retry'), box(2, 'sleep')],
				arrows: [arrow, { ...arrow, number: 4, from: 'sleep', to: 'retry', text: 'returns to' }],
			}),
		},
		text: 'What retry does between attempts',
	},
	layout: {
		card: {
			kind: 'layout',
			layout: {
				kind: 'layout',
				within: [],
				drawnAt: quote.commit,
				parts: [
					{ name: 'Retry loop', job: 'tries a call again after a wait', places: [] },
					{ name: 'Clock', job: 'waits', places: [] },
				],
				arrows: [{ from: 'Retry loop', to: 'Clock', text: 'sleeps on', quotes: [quote] }],
			},
		},
		text: 'tries a call again after a wait',
	},
	topic: {
		card: { kind: 'topic', topic: { name: 'retry logic', note: 'retry sleeps.', quotes: [quote], replaces: null } },
		text: 'retry logic',
	},
	withdrawn: {
		card: { kind: 'withdrawn', withdrawn: { risk, reason: 'Only callers slower than 100 ms wait.', proof: [quote] } },
		text: 'Only callers slower than 100 ms wait.',
	},
}

test('the page shows a card of every kind ken can send, boxed and with its text, after the words', () => {
	const items = CARD_KINDS.map((kind) => ({ kind: 'card', card: SAMPLES[kind].card }))
	const q = { reply: { items: [{ kind: 'words', text: 'Here is what I found.' }, ...items], change: null, topics: [] } }
	const ui = {
		panel: { kind: 'checks' },
		openQuotes: new Set(),
		openDecisions: new Set(),
		openParts: new Set(),
		openElements: new Set(),
		tooWide: new Set(),
		drawingsShown: new Set(),
		unfolded: new Set(),
		mapSaid: null,
		wide: true,
	}
	const html = page.replyHtml(q, 0, ui, { running: false, inThread: true })

	assert.ok(!html.includes('cannot show'), 'every kind has a renderer')
	assert.equal(html.match(/class="card card-/g)?.length, CARD_KINDS.length, 'each card is boxed')
	const at = CARD_KINDS.map((kind) => html.indexOf(SAMPLES[kind].text))
	assert.ok(
		at.every((place) => place > html.indexOf('Here is what I found.')),
		`each card's text follows the words: ${at}`,
	)
	assert.deepEqual(
		[...at].sort((a, b) => a - b),
		at,
		'the cards keep the order the reply gives them',
	)
})

test('a reply about a change opens on the change card, before the words: the parts it touched with files and lines, the others not touched, and its commits', async () => {
	const { root: project, hashes } = buildRepository([
		{ message: 'feat: start', files: { 'src/retry/loop.ts': 'retry()\n', 'src/clock/wait.ts': 'wait()\n' } },
		{ message: 'feat: wait between attempts', files: { 'src/retry/loop.ts': 'retry()\nsleep(100)\nsleep(200)\n' } },
	])
	const [base = '', head = ''] = hashes
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const repo = gitRepository(project)
	const record = fileRecordStore(project, repo)
	const opened = await openMap(home, repo, record)
	if (opened.kind !== 'ok') assert.fail('the fixture has commits')
	const sources = { root: project, repo, snapshots: await openSnapshots(home, repo, project), record, map: opened.map }
	const asked = await readLayoutAsk(sources, { within: ['src'], change: `${base}..${head}` })
	if (asked.kind !== 'ok') assert.fail(asked.message)
	const look = await lookAtLayout(sources, asked.ask, new Date())
	const range = asked.ask.change?.range
	const log = range && (await repo.log(range))
	if (log?.kind !== 'ok') assert.fail('the fixture log reads')

	const change = { base, head, commits: log.commits }
	const words = 'Each retry now waits before the next attempt.'
	const q = { reply: { items: [{ kind: 'words', text: words }], change, topics: [] } }
	const ui = { panel: { kind: 'checks' }, unfolded: new Set(), changeLooks: new Map([[`${base}..${head}`, look]]) }
	const html = page.replyHtml(q, 0, ui, { running: false, inThread: true })

	const card = html.indexOf('What this change touched')
	assert.ok(card >= 0 && card < html.indexOf(words), 'the change card comes before the words')
	const shown = html.slice(card, html.indexOf(words))
	assert.match(shown, /retry<\/span><span class="cc-touched">1 file: 2 lines added, 0 removed/)
	assert.match(shown, /clock<\/span><span class="cc-quiet">Not touched/)
	assert.match(shown, /feat: wait between attempts/)
	assert.match(html, /Ask what could go wrong/)
})
