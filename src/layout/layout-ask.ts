// What a reader asks of the layout comes as text, from the terminal's flags or the page's query, so it is parsed here
// into commits and paths before anything reads git with it. A change is a range, a branch, a span of time up to HEAD,
// or the reader's uncommitted work, which live mode's snapshot turns into a commit ken can diff. With no change asked,
// the view shows where the reader is: their uncommitted work if there is any, else the branch HEAD is on against the
// main branch, else none.
import { sinceOf, sinceWords, timeRange } from '../follow-up/index.ts'
import { takeSnapshot } from '../live/index.ts'
import { type CommitHash, parsePath, type Repository, resolveRange } from '../repo/index.ts'
import type { Change, LayoutAsk, LayoutSources } from './layout-look.ts'

export type RawAsk = { at?: string | undefined; within?: string[] | undefined; change?: string | undefined }

const UNCOMMITTED = 'uncommitted'
// Asks for no change at all, where leaving the change out asks for the reader's own work.
const NONE = 'none'
// Starts a change asked as a span of time: "since:14d" or "since:2026-11-01".
const SINCE = 'since:'
// A branch's change starts where it split from the first of these that the project has.
const MAIN_BRANCHES = ['main', 'master', 'origin/HEAD']
// The picker offers this many merges, or commits when the main line has no merge.
const RECENT = 5

export async function readLayoutAsk(
	sources: LayoutSources,
	raw: RawAsk,
	now: Date,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; ask: LayoutAsk } | { kind: 'refused'; field: 'at' | 'within' | 'change'; message: string }> {
	const { repo } = sources
	const ref = raw.at?.trim() || 'HEAD'
	const at = await repo.resolve(ref, signal)
	if (at.kind !== 'ok') return { kind: 'refused', field: 'at', message: `"${ref}" is not a commit of this project.` }
	const within = []
	for (const each of raw.within ?? []) {
		const parsed = parsePath(each)
		if (parsed.kind !== 'ok') return { kind: 'refused', field: 'within', message: `${parsed.reason}.` }
		within.push(parsed.path)
	}
	const text = raw.change?.trim() ?? ''
	const change =
		text === NONE
			? null
			: text === ''
				? { kind: 'ok' as const, change: await ownWork(sources, signal) }
				: await changeOf(sources, text, now, signal)
	if (change?.kind === 'refused') return { ...change, field: 'change' }
	return { kind: 'ok', ask: { at: at.commit, within: [...new Set(within)].sort(), change: change?.change ?? null } }
}

async function ownWork(sources: LayoutSources, signal?: AbortSignal): Promise<Change | null> {
	const { repo, snapshots, root } = sources
	const snapshot = await takeSnapshot(snapshots, repo, root, signal)
	if (snapshot.kind === 'taken') return uncommitted(snapshot.head, snapshot.commit)
	const [branch, main] = await Promise.all([repo.branch(signal), mainBranch(repo, signal)])
	if (branch === null || main === null || branch === main) return null
	const range = await resolveRange(repo, { base: main, head: branch }, signal)
	if (range.kind !== 'ok' || range.range.base === range.range.head) return null
	return { kind: 'branch', name: branch, asked: branch, range: range.range }
}

function uncommitted(head: CommitHash, snapshot: CommitHash): Change {
	return { kind: 'uncommitted', name: 'Uncommitted work', asked: UNCOMMITTED, range: { base: head, head: snapshot } }
}

async function changeOf(
	sources: LayoutSources,
	text: string,
	now: Date,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; change: Change } | { kind: 'refused'; message: string }> {
	const { repo, snapshots, root } = sources
	if (text.startsWith(SINCE)) return await spanOf(repo, text, now, signal)
	if (text === UNCOMMITTED) {
		const snapshot = await takeSnapshot(snapshots, repo, root, signal)
		return {
			kind: 'ok',
			change: uncommitted(snapshot.head, snapshot.kind === 'taken' ? snapshot.commit : snapshot.head),
		}
	}
	const kind = text.includes('..') ? 'range' : 'branch'
	const [base, head, ...rest] = kind === 'range' ? text.split('..') : [await mainBranch(repo, signal), text]
	if (base === null) {
		return {
			kind: 'refused',
			message: `ken found no main branch to compare ${text} with. Give a range such as main..${text}.`,
		}
	}
	if (!base || !head || rest.length > 0)
		return { kind: 'refused', message: `"${text}" is not a range such as main..feature.` }
	const range = await resolveRange(repo, { base, head }, signal)
	// A change card asks by full hashes, which the reader reads more easily cut to seven characters.
	const name = text.replace(/\b[0-9a-f]{40}\b/g, (hash) => hash.slice(0, 7))
	if (range.kind === 'ok') return { kind: 'ok', change: { kind, name, asked: text, range: range.range } }
	if (range.kind === 'unrelated') return { kind: 'refused', message: `${base} and ${head} share no history.` }
	return {
		kind: 'refused',
		message: `"${range.kind === 'no-commit' ? range.ref : text}" is not a commit of this project.`,
	}
}

// A span of time is the commits that landed on the main line since it began. With none there is no change to show.
async function spanOf(
	repo: Repository,
	text: string,
	now: Date,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; change: Change } | { kind: 'refused'; message: string }> {
	const asked = text.slice(SINCE.length).trim()
	// The page offers the span since the reader's last question as a range, so here the text names it only when typed.
	if (asked === 'question') {
		return {
			kind: 'refused',
			message:
				'The layout takes no span since:question. Name a day such as since:2026-11-01, or days such as since:14d.',
		}
	}
	const since = sinceOf(asked, undefined)
	if (since.kind !== 'ok') return { kind: 'refused', message: since.problem }
	const span = await timeRange(repo, since.since, now, signal)
	if (span.kind !== 'ok') return { kind: 'refused', message: span.problem }
	const words = sinceWords(since.since)
	if (span.range.commits.length === 0) return { kind: 'refused', message: `No commit landed ${words}.` }
	const { base, head } = span.range
	const name = `${words.charAt(0).toUpperCase()}${words.slice(1)}`
	return { kind: 'ok', change: { kind: 'range', name, asked: text, range: { base, head } } }
}

async function mainBranch(repo: Repository, signal?: AbortSignal): Promise<string | null> {
	for (const name of MAIN_BRANCHES) if ((await repo.resolve(name, signal)).kind === 'ok') return name
	return null
}

// change is the text readLayoutAsk takes for it. A since choice is a span of time for catching up, with the number of
// commits it holds. The follow-up module makes those, and the server puts them before the ones made here.
export type ChangeChoice =
	| { kind: 'uncommitted' | 'merge' | 'commit' | 'branch'; change: string; name: string }
	| { kind: 'since'; change: string; name: string; commits: number }

// The changes the page offers to lay over the boxes: the reader's uncommitted work, the newest merges on the main line
// (or its newest commits when it has no merge), and the branches other than the main one.
export async function changeChoices(sources: LayoutSources, signal?: AbortSignal): Promise<ChangeChoice[]> {
	const { repo } = sources
	const head = await repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') return []
	const [line, branches, main] = await Promise.all([
		repo.mainLine(head.commit, 100, signal),
		repo.branches(signal),
		mainBranch(repo, signal),
	])
	const commits = line.kind === 'ok' ? line.commits.filter((commit) => commit.parents.length > 0) : []
	const merges = commits.filter((commit) => commit.parents.length > 1)
	const kind = merges.length > 0 ? ('merge' as const) : ('commit' as const)
	const recent = (merges.length > 0 ? merges : commits).slice(0, RECENT).map((commit) => ({
		kind,
		change: `${commit.hash}^1..${commit.hash}`,
		name: `${short(commit.hash)} ${commit.subject}`,
	}))
	return [
		{ kind: 'uncommitted', change: UNCOMMITTED, name: 'Uncommitted work' },
		...recent,
		...branches.filter((name) => name !== main).map((name) => ({ kind: 'branch' as const, change: name, name })),
	]
}

function short(hash: CommitHash): string {
	return hash.slice(0, 7)
}
