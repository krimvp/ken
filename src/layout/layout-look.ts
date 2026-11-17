// One level of the project's layout as it looks at one commit. The boxes split the level's scope at HEAD; git's own
// ids then say which of them are the same, different or not there at the commit asked, a change is laid over them by
// its diff paths, and the reader's map marks the topics inside each. All of it is derived on every read, from git, the
// record and the map, and nothing is stored. A box opens the level whose scope is the box's paths.

import type { SnapshotStore } from '../live/index.ts'
import type { UnderstandingMap } from '../map/index.ts'
import type { RecordStore } from '../record/index.ts'
import type { CommitHash, FileDiff, ObjectId, Range, RepoPath, Repository } from '../repo/index.ts'
import { type Seed, splitScope, under } from './folder-split.ts'
import { type BoxTopic, boxTopics, type Next, nextOf } from './reader-marks.ts'

// The paths a level shows the inside of, sorted. The empty list is the whole project.
export type Scope = RepoPath[]

// name says what the change is to the reader: "Uncommitted work", a branch, or a range as they typed it.
export type Change = { name: string; range: Range }

export type LayoutAsk = { at: CommitHash; within: Scope; change: Change | null }

// repo reads the project and ken's snapshots of uncommitted work, so a change can end at a snapshot.
export type LayoutSources = {
	root: string
	repo: Repository
	snapshots: SnapshotStore
	record: RecordStore
	map: UnderstandingMap
}

export type Touched = { files: number; added: number; removed: number }

// files counts the files under the box at HEAD. opens is false for a box of one file, which has no level inside.
// state compares the box at the commit asked with HEAD. touched is null when no change is asked or this one leaves
// the box alone.
export type LookBox = Seed & {
	opens: boolean
	state: 'same' | 'changed' | 'gone'
	touched: Touched | null
	topics: BoxTopic[]
}

// loose names what sits in the scope at the commit asked and in no box, such as a folder HEAD no longer has. outside
// names the changed files no box holds.
export type LayoutLook = {
	at: CommitHash
	head: CommitHash
	within: Scope
	boxes: LookBox[]
	loose: string[]
	change: (Change & { files: number; outside: string[] }) | null
	next: Next
}

// ken's own record is not part of the project's code, as in every change fact git gives.
const RECORD = '.ken'

export async function lookAtLayout(
	sources: LayoutSources,
	ask: LayoutAsk,
	now: Date,
	signal?: AbortSignal,
): Promise<LayoutLook> {
	const { repo } = sources
	const head = await repo.resolve('HEAD', signal)
	if (head.kind !== 'ok') throw new Error(`${sources.root} has no HEAD commit to lay out`)
	const seeds = splitScope(await projectFiles(repo, head.commit, signal), ask.within)
	const places = seeds.flatMap((seed) => seed.paths)
	const [idsAtHead, idsAt, loose, diff, read, mapRead] = await Promise.all([
		repo.objectIds(head.commit, places, signal),
		ask.at === head.commit ? null : repo.objectIds(ask.at, places, signal),
		ask.at === head.commit ? [] : looseAt(repo, ask.at, ask.within, places, signal),
		ask.change && changedFiles(repo, ask.change.range, signal),
		sources.record.read(),
		sources.map.read(now, signal),
	])
	const topics = read.current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
	// No path sits in two boxes, so each box finds its ids by its paths.
	const atHead = new Map(places.map((place, i) => [place, idsAtHead[i] ?? null]))
	const atAsked = idsAt && new Map(places.map((place, i) => [place, idsAt[i] ?? null]))
	const boxes: LookBox[] = seeds.map((seed) => ({
		...seed,
		opens: seed.files > 1,
		state: atAsked ? stateAt(seed.paths, atHead, atAsked) : 'same',
		touched: diff && touchedIn(seed.paths, diff),
		topics: boxTopics(seed.paths, topics, mapRead.states),
	}))
	const change =
		ask.change && diff
			? {
					...ask.change,
					files: diff.length,
					outside: diff.map((file) => file.path).filter((file) => !places.some((place) => under(file, place))),
				}
			: null
	return { at: ask.at, head: head.commit, within: ask.within, boxes, loose, change, next: nextOf(boxes) }
}

type Ids = Map<string, ObjectId | null>

function stateAt(paths: string[], head: Ids, at: Ids): LookBox['state'] {
	if (paths.every((place) => at.get(place) === null)) return 'gone'
	return paths.every((place) => at.get(place) === head.get(place)) ? 'same' : 'changed'
}

async function projectFiles(repo: Repository, commit: CommitHash, signal?: AbortSignal): Promise<string[]> {
	const listed = await repo.listFiles(commit, signal)
	// shortcut: a project with more file names than git's output limit holds cannot be laid out. Read the tree a level
	// at a time if one ever needs to be.
	if (listed.kind !== 'ok') throw new Error(`The project at ${commit} has too many files for ken to lay out.`)
	return listed.paths.filter((file) => !under(file, RECORD))
}

// The entries of the scope at the commit, as its next path segment names them, that no box holds.
async function looseAt(
	repo: Repository,
	at: CommitHash,
	within: Scope,
	places: string[],
	signal?: AbortSignal,
): Promise<string[]> {
	const [only] = within
	const prefix = within.length === 1 && only !== undefined ? `${only}/` : ''
	const inScope = (file: string) => (within.length === 0 ? true : within.some((place) => under(file, place)))
	const entries = (await projectFiles(repo, at, signal))
		.filter((file) => inScope(file) && !places.some((place) => under(file, place)))
		.map((file) => (file.startsWith(prefix) ? `${prefix}${file.slice(prefix.length).split('/')[0]}` : file))
	return [...new Set(entries)]
}

async function changedFiles(repo: Repository, range: Range, signal?: AbortSignal): Promise<FileDiff[]> {
	const diff = await repo.diff(range, signal)
	if (diff.kind !== 'ok') throw new Error(`The change ${range.base}..${range.head} is too large for ken to lay out.`)
	return diff.files
}

function touchedIn(paths: string[], diff: FileDiff[]): Touched | null {
	const files = diff.filter((file) => paths.some((place) => under(file.path, place)))
	if (files.length === 0) return null
	const lines = files.flatMap((file) => (file.kind === 'text' ? file.hunks.flatMap((hunk) => hunk.lines) : []))
	return {
		files: files.length,
		added: lines.filter((line) => line.startsWith('+')).length,
		removed: lines.filter((line) => line.startsWith('-')).length,
	}
}
