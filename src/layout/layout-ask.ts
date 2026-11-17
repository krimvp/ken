// What a reader asks of the layout comes as text, from the terminal's flags or the page's query, so it is parsed here
// into commits and paths before anything reads git with it. A change is a range, a branch, or the reader's uncommitted
// work, which live mode's snapshot turns into a commit ken can diff.
import { takeSnapshot } from '../live/index.ts'
import { type CommitHash, parsePath, type Repository, resolveRange } from '../repo/index.ts'
import type { Change, LayoutAsk, LayoutSources } from './layout-look.ts'

export type RawAsk = { at?: string | undefined; within?: string[] | undefined; change?: string | undefined }

const UNCOMMITTED = 'uncommitted'
// A branch's change starts where it split from the first of these that the project has.
const MAIN_BRANCHES = ['main', 'master', 'origin/HEAD']
// The picker offers this many merges, or commits when the main line has no merge.
const RECENT = 5

export async function readLayoutAsk(
	sources: LayoutSources,
	raw: RawAsk,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; ask: LayoutAsk } | { kind: 'refused'; message: string }> {
	const { repo } = sources
	const ref = raw.at?.trim() || 'HEAD'
	const at = await repo.resolve(ref, signal)
	if (at.kind !== 'ok') return { kind: 'refused', message: `"${ref}" is not a commit of this project.` }
	const within = []
	for (const each of raw.within ?? []) {
		const parsed = parsePath(each)
		if (parsed.kind !== 'ok') return { kind: 'refused', message: `${parsed.reason}.` }
		within.push(parsed.path)
	}
	const change = raw.change?.trim() ? await changeOf(sources, raw.change.trim(), signal) : null
	if (change?.kind === 'refused') return change
	return { kind: 'ok', ask: { at: at.commit, within: [...new Set(within)].sort(), change: change?.change ?? null } }
}

async function changeOf(
	sources: LayoutSources,
	text: string,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; change: Change } | { kind: 'refused'; message: string }> {
	const { repo, snapshots, root } = sources
	if (text === UNCOMMITTED) {
		const snapshot = await takeSnapshot(snapshots, repo, root, signal)
		const head = snapshot.head
		return {
			kind: 'ok',
			change: {
				name: 'Uncommitted work',
				range: { base: head, head: snapshot.kind === 'taken' ? snapshot.commit : head },
			},
		}
	}
	const [base, head, ...rest] = text.includes('..') ? text.split('..') : [await mainBranch(repo, signal), text]
	if (base === null) {
		return {
			kind: 'refused',
			message: `ken found no main branch to compare ${text} with. Give a range such as main..${text}.`,
		}
	}
	if (!base || !head || rest.length > 0)
		return { kind: 'refused', message: `"${text}" is not a range such as main..feature.` }
	const range = await resolveRange(repo, { base, head }, signal)
	if (range.kind === 'ok') return { kind: 'ok', change: { name: text, range: range.range } }
	if (range.kind === 'unrelated') return { kind: 'refused', message: `${base} and ${head} share no history.` }
	return {
		kind: 'refused',
		message: `"${range.kind === 'no-commit' ? range.ref : text}" is not a commit of this project.`,
	}
}

async function mainBranch(repo: Repository, signal?: AbortSignal): Promise<string | null> {
	for (const name of MAIN_BRANCHES) if ((await repo.resolve(name, signal)).kind === 'ok') return name
	return null
}

// change is the text readLayoutAsk takes for it.
export type ChangeChoice = { kind: 'uncommitted' | 'merge' | 'commit' | 'branch'; change: string; name: string }

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
	const kind: ChangeChoice['kind'] = merges.length > 0 ? 'merge' : 'commit'
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
