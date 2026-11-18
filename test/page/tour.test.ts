import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

// The page is plain JavaScript in the browser, so the test loads it by path.
const page: { replyHtml: (q: object, t: number, ui: object, options: object) => string } = await import(
	path.join(import.meta.dirname, '../../src/page/views/reply.js')
)

const HEAD = 'a'.repeat(40)
const claim = (file: string, text: string) => ({
	kind: 'claim',
	claim: {
		text: `${file} holds ${text}`,
		label: 'inferred',
		quotes: [{ path: file, commit: HEAD, startLine: 1, endLine: 1, text }],
	},
})
const stop = (name: string, paths: string[]) => ({ name, job: `${name} does its job`, paths })
const tour = {
	within: [],
	stops: [stop('Command', ['src/cli']), stop('Core', ['src/core']), stop('Store', ['src/store'])],
}
const reply = {
	items: [
		{ kind: 'step', number: 1, text: 'The command starts everything.' },
		{ kind: 'card', step: 1, card: claim('src/cli/main.ts', 'run()') },
		{ kind: 'step', number: 2, text: 'The core runs the work.' },
		{ kind: 'card', step: 2, card: claim('src/core/run.ts', 'export function run() {') },
		{ kind: 'step', number: 3, text: 'The store saves it.' },
		{ kind: 'card', step: 3, card: claim('src/store/db.ts', 'export function save() {}') },
		{ kind: 'words', text: 'That is the whole project.' },
	],
	change: null,
	topics: ['Command', 'Core', 'Store'],
	tour,
}
// The level as the server sends it, the store first, so a lit box cannot come from the order of the boxes.
const look = {
	boxes: ['Store', 'Command', 'Core'].map((name) => ({ name, paths: tour.stops.find((s) => s.name === name)?.paths })),
	arrows: [
		{ from: 'Command', to: 'Core', text: 'runs' },
		{ from: 'Core', to: 'Store', text: 'saves to' },
	],
}

function html(states: { topic: string; kind: string }[], at: number | null, wide = false) {
	const ui = {
		panel: { kind: 'checks' },
		openQuotes: new Set(),
		openDecisions: new Set(),
		unfolded: new Set(),
		changeLooks: new Map([['tour:', look]]),
		walkAt: new Map(at === null ? [] : [[0, at]]),
		wide,
	}
	return page.replyHtml({ reply, steps: [], topics: states }, 0, ui, { running: false, inThread: true })
}

const state = (topic: string, kind: string) => ({ topic, kind })
// Each line of the list as the reader sees it: the stop's number, its part, and its mark once seen.
const lines = (text: string) =>
	[...text.matchAll(/<button class="walk-head"[^>]*>(.*?)<\/button>/gs)].map((m) =>
		(m[1] ?? '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim(),
	)
const lit = (text: string) =>
	[...text.matchAll(/class="pv-cell[^"]*is-near[^>]*>.*?pv-name">([^<]+)</gs)].map((m) => m[1])

test('a tour shows which stops the reader has seen or knows, from their map, and goes on at the first one they have not seen', () => {
	const fresh = html([state('Command', 'never-met'), state('Core', 'never-met'), state('Store', 'never-met')], null)
	assert.deepEqual(lines(fresh), ['1 Command', '2 Core', '3 Store'], 'the stops go in the tour order')
	assert.match(fresh, /data-by="1"[^>]*>Start</, 'a tour nobody took starts at the first stop')

	const later = html([state('Command', 'met'), state('Core', 'unchanged'), state('Store', 'never-met')], null)
	assert.deepEqual(
		lines(later),
		['1 Command &#10003; Seen . Done.', '2 Core &#10003; You know this part . Done.', '3 Store'],
		'a stop the reader saw keeps its number, and its mark sits beside it',
	)
	assert.match(later, /You have seen 2 of the 3 stops/)
	assert.match(later, /data-by="1"[^>]*>Go on at stop 3</)

	const done = html([state('Command', 'met'), state('Core', 'met'), state('Store', 'met')], null)
	assert.match(done, /data-by="1"[^>]*>Start</, 'a tour seen to the end starts again at the first stop')
})

test('at every stop, the one highlighted line of the list and the one lit part are that stop, whatever the reader has seen', () => {
	for (const at of [1, 2, 3]) {
		const text = html([state('Command', 'met'), state('Core', 'unchanged'), state('Store', 'never-met')], at, true)
		const on = [...text.matchAll(/class="walk-step is-on[^"]*"[^>]*data-step="(\d)".*?walk-name">([^<]+)</gs)]
		assert.deepEqual(
			on.map((m) => [Number(m[1]), m[2]]),
			[[at, tour.stops[at - 1]?.name]],
		)
		assert.deepEqual(lit(text), [tour.stops[at - 1]?.name])
	}
})

test('the stop the reader is on lights its part, shows its text and the code its cards quote, and offers to mark the part known on a narrow screen', () => {
	const on = html([state('Command', 'met'), state('Core', 'never-met'), state('Store', 'never-met')], 2)
	assert.deepEqual(lit(on), ['Core'])
	assert.match(on, /The core runs the work\./, "the stop's text shows under it")
	assert.doesNotMatch(on, /The store saves it\./, 'the list shows only the title of the other stops')
	assert.match(on, /export function run\(\) \{/, "the stop's quoted lines show under it")
	assert.doesNotMatch(on, /export function save/, 'the other stops keep their code folded')
	assert.match(on, /data-act="tour-know" data-turn="0" data-step="2"[^>]*>I know this part</)

	const known = html([state('Command', 'met'), state('Core', 'unchanged'), state('Store', 'never-met')], 2)
	assert.doesNotMatch(known, /data-act="tour-know"/)
	assert.match(known, /Your map says you know Core\./)
})
