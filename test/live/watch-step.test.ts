import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	type Observation,
	PACE,
	startWatch,
	type WatchAction,
	type WatchEvent,
	type WatchState,
	watchStep,
} from '../../src/live/index.ts'
import type { CommitHash } from '../../src/repo/index.ts'

const commit = (name: string) => name.padEnd(40, '0') as CommitHash
const [H1, H2, H3, S1] = [commit('a1'), commit('a2'), commit('a3'), commit('5a')]
const clean = (head: CommitHash, landed = { base: H1, commits: 0 }): WatchEvent => ({
	kind: 'observed',
	head,
	tree: null,
	landed,
})
const edited = (tree: string, head = H1): WatchEvent => ({
	kind: 'observed',
	head,
	tree,
	landed: { base: head, commits: 0 },
})
const landed = (head: CommitHash, commits = 1): WatchEvent => clean(head, { base: H1, commits })
const SECOND = 1000

// Feeds the events in order, each at its time in seconds, and returns every action that was not "none".
function drive(
	events: [number, WatchEvent][],
	first: Observation = { head: H1, tree: null, landed: { base: H1, commits: 0 } },
) {
	let state: WatchState = startWatch(first, 0)
	const actions: [number, WatchAction][] = []
	for (const [at, event] of events) {
		const step = watchStep(state, event, at * SECOND)
		state = step.state
		if (step.action.kind !== 'none') actions.push([at, step.action])
	}
	return { actions, state }
}

test('a commit landing asks for a note about those commits', () => {
	const { actions } = drive([
		[2, clean(H1)],
		[4, landed(H2, 2)],
		[6, landed(H2, 2)],
	])
	assert.deepEqual(actions, [[4, { kind: 'note', about: { kind: 'commits', base: H1, head: H2 } }]])
})

test('edits that keep changing ask for nothing, and once they go quiet ask for one snapshot and one note', () => {
	const busy = Array.from({ length: 20 }, (_, i): [number, WatchEvent] => [i * 5, edited(`tree-${i}`)])
	const quiet = 19 * 5 + PACE.quietMs / SECOND
	const { actions } = drive([
		...busy,
		[quiet - 2, edited('tree-19')],
		[quiet, edited('tree-19')],
		[quiet + 1, { kind: 'snapshot', taken: { snapshot: S1, head: H1, changed: 12 } }],
		[quiet + 30, { kind: 'noted' }],
		[quiet + 200, edited('tree-19')],
	])
	assert.deepEqual(
		actions.map(([at, action]) => [at, action.kind]),
		[
			[quiet, 'snapshot'],
			[quiet + 1, 'note'],
		],
	)
	const note = actions[1]?.[1]
	assert.deepEqual(
		note?.kind === 'note' && note.about.kind === 'uncommitted' && [note.about.base, note.about.snapshot],
		[H1, S1],
	)
})

test('a quiet edit of fewer lines than the pace asks for no note', () => {
	const { actions } = drive([
		[0, edited('small')],
		[PACE.quietMs / SECOND, edited('small')],
		[PACE.quietMs / SECOND + 1, { kind: 'snapshot', taken: { snapshot: S1, head: H1, changed: PACE.minLines - 1 } }],
		[PACE.quietMs / SECOND + 90, edited('small')],
	])
	assert.deepEqual(
		actions.map(([, action]) => action.kind),
		['snapshot'],
	)
})

test('the gap between notes and the cap per hour hold, and commits that wait are explained together', () => {
	const gap = PACE.gapMs / SECOND
	const events: [number, WatchEvent][] = [
		[0, landed(H2)],
		[1, { kind: 'noted' }],
		[gap - 10, clean(H3, { base: H2, commits: 1 })],
		[gap - 1, clean(H3, { base: H2, commits: 1 })],
		[gap, clean(H3, { base: H2, commits: 1 })],
	]
	const { actions } = drive(events)
	assert.deepEqual(
		actions.map(([at, action]) => [at, action.kind === 'note' && action.about]),
		[
			[0, { kind: 'commits', base: H1, head: H2 }],
			[gap, { kind: 'commits', base: H2, head: H3 }],
		],
	)

	// One commit after another, each as soon as the gap allows: the hour holds PACE.perHour notes, then waits.
	let state = startWatch({ head: H1, tree: null, landed: { base: H1, commits: 0 } }, 0)
	const written: number[] = []
	for (let at = 0; at < 3600; at += gap) {
		const head = commit(`c${at}`)
		const step = watchStep(state, clean(head, { base: state.noted.head, commits: 1 }), at * SECOND)
		if (step.action.kind === 'note') written.push(at)
		state = watchStep(step.state, { kind: 'noted' }, (at + 1) * SECOND).state
	}
	assert.equal(written.length, PACE.perHour)
	const later = watchStep(state, clean(commit('late'), { base: state.noted.head, commits: 1 }), 3600 * SECOND)
	assert.equal(later.action.kind, 'note', 'once the first note of the hour is an hour old, the next may come')
})

test('pause holds every note until the owner resumes, and the note then covers what landed meanwhile', () => {
	const { actions } = drive([
		[0, { kind: 'pause' }],
		[5, landed(H2)],
		[90, landed(H3, 2)],
		[100, { kind: 'resume' }],
	])
	assert.deepEqual(actions, [[100, { kind: 'note', about: { kind: 'commits', base: H1, head: H3 } }]])
})

test('while paused, "Write a note now" still writes one, and the pause holds the notes after it', () => {
	const { actions } = drive([
		[0, { kind: 'pause' }],
		[5, landed(H2)],
		[6, { kind: 'note-now' }],
		[30, { kind: 'noted' }],
		[200, clean(H3, { base: H2, commits: 1 })],
	])
	assert.deepEqual(actions, [[6, { kind: 'note', about: { kind: 'commits', base: H1, head: H2 } }]])
})

test('a note in progress holds the next, which comes when it ends', () => {
	const gap = PACE.gapMs / SECOND
	const { actions } = drive([
		[0, landed(H2)],
		[gap + 5, clean(H3, { base: H2, commits: 1 })],
		[gap + 20, { kind: 'noted' }],
	])
	assert.deepEqual(
		actions.map(([at, action]) => [at, action.kind]),
		[
			[0, 'note'],
			[gap + 20, 'note'],
		],
	)
})

test('"Write a note now" skips the wait for quiet and the gap, and says when nothing changed', () => {
	const { actions } = drive([
		[0, landed(H2)],
		[1, { kind: 'noted' }],
		[2, edited('fresh', H2)],
		[3, { kind: 'note-now' }],
		[4, { kind: 'snapshot', taken: { snapshot: S1, head: H2, changed: 1 } }],
		[5, { kind: 'noted' }],
		[6, { kind: 'note-now' }],
	])
	assert.deepEqual(
		actions.map(([at, action]) => [at, action.kind]),
		[
			[0, 'note'],
			[3, 'snapshot'],
			[4, 'note'],
			[6, 'nothing-new'],
		],
	)
})
