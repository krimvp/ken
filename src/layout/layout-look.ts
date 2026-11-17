// One level of the project's layout as it looks at one commit. The boxes are the parts ken's model named for the level's
// scope, when the record holds such a level, or else the scope's folders at HEAD. git's own ids then say which boxes
// are the same, different or not there at the commit asked, a change is laid over them by its diff paths, and the
// reader's map marks the topics inside each. All of it is derived on every read, from git, the record and the map, and
// nothing is stored here. A box opens the level whose scope is the box's paths.

import type { SnapshotStore } from '../live/index.ts'
import type { UnderstandingMap } from '../map/index.ts'
import type { EntryId, RecordEntry, RecordStore } from '../record/index.ts'
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

// job is the model's one line on a part it named, null for a folder. files counts the files under the box at HEAD for
// a folder and at the commit asked for a part. opens is false for a box of one file, which has no level inside. state
// compares the box at the commit asked with HEAD for a folder, and with the commit it was named at for a part. touched
// is null when no change is asked or this one leaves the box alone.
export type LookBox = Seed & {
	job: string | null
	opens: boolean
	state: 'same' | 'changed' | 'gone'
	touched: Touched | null
	topics: BoxTopic[]
}

// A level ken's model named: the record entry, the commit it was named at, and what no longer fits there. added names
// what sits in the scope at the commit asked, in no part, and was not there when the model named the parts. stale says
// the drawing no longer fits: a part changed or went, or something was added in no part.
export type Named = { id: EntryId; drawnAt: CommitHash; added: string[]; stale: boolean }

// An arrow is possibly stale when the part it starts at changed since the model named the parts, since its lines may
// have changed with it.
export type LookArrow = Stored['arrows'][number] & { stale: boolean }

type Stored = Extract<RecordEntry, { kind: 'layout' }>

// loose names what sits in the scope at the commit asked and in no box, such as a folder HEAD no longer has or one the
// model left out of its parts. outside names the changed files no box holds.
export type LayoutLook = {
	at: CommitHash
	head: CommitHash
	within: Scope
	named: Named | null
	boxes: LookBox[]
	arrows: LookArrow[]
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
	const read = await sources.record.read()
	const versions = read.entries.flatMap((entry) =>
		entry.kind === 'layout' && sameScope(entry, ask.within) ? [entry] : [],
	)
	const level =
		versions.length > 0
			? await namedLevel(repo, versions, ask, signal)
			: await folderLevel(repo, ask, head.commit, signal)
	const places = level.boxes.flatMap((box) => box.paths)
	const [diff, mapRead] = await Promise.all([
		ask.change && changedFiles(repo, ask.change.range, signal),
		sources.map.read(now, signal),
	])
	const topics = read.current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
	const boxes: LookBox[] = level.boxes.map((box) => ({
		...box,
		opens: box.files > 1,
		touched: diff && touchedIn(box.paths, diff),
		topics: boxTopics(box.paths, topics, mapRead.states),
	}))
	const change =
		ask.change && diff
			? {
					...ask.change,
					files: diff.length,
					outside: diff.map((file) => file.path).filter((file) => !places.some((place) => under(file, place))),
				}
			: null
	return { at: ask.at, head: head.commit, within: ask.within, ...level, boxes, change, next: nextOf(boxes) }
}

type Level = {
	named: Named | null
	boxes: (Seed & { job: string | null; state: LookBox['state'] })[]
	arrows: LookArrow[]
	loose: string[]
}

// Among every stored version of the level, the one with the most parts the same at the commit asked, the newest on a
// tie. So at an old commit the version that fit the code then wins, and at HEAD the newest that fits.
async function namedLevel(repo: Repository, versions: Stored[], ask: LayoutAsk, signal?: AbortSignal): Promise<Level> {
	const places = [
		...new Set(versions.flatMap((version) => version.parts.flatMap((part) => part.places)).map((p) => p.path)),
	]
	const [ids, files] = await Promise.all([repo.objectIds(ask.at, places, signal), projectFiles(repo, ask.at, signal)])
	const idAt = new Map(places.map((place, i) => [place, ids[i] ?? null]))
	const stateOf = (part: Stored['parts'][number]): LookBox['state'] => {
		if (part.places.every((place) => idAt.get(place.path) === null)) return 'gone'
		return part.places.every((place) => idAt.get(place.path) === place.id) ? 'same' : 'changed'
	}
	const same = (version: Stored) => version.parts.filter((part) => stateOf(part) === 'same').length
	// A merge of two clones' records can put a newer line before an older one, so ties go by when ken wrote each.
	const chosen = versions.reduce((best, version) => {
		const [a, b] = [same(version), same(best)]
		return a > b || (a === b && version.at >= best.at) ? version : best
	})
	const boxes = chosen.parts.map((part) => {
		const paths = part.places.map((place) => place.path)
		return { name: part.name, job: part.job, paths, files: countUnder(files, paths), state: stateOf(part) }
	})
	const loose = looseIn(
		files,
		ask.within,
		boxes.flatMap((box) => box.paths),
	)
	const thenIds = await repo.objectIds(chosen.drawnAt, loose as RepoPath[], signal)
	const added = loose.filter((_, i) => thenIds[i] === null)
	const changed = new Set(boxes.filter((box) => box.state !== 'same').map((box) => box.name))
	return {
		named: { id: chosen.id, drawnAt: chosen.drawnAt, added, stale: changed.size > 0 || added.length > 0 },
		boxes,
		arrows: chosen.arrows.map((arrow) => ({ ...arrow, stale: changed.has(arrow.from) })),
		loose,
	}
}

// The scope's folders at HEAD, with no model. Each is the same, changed or gone at the commit asked, against HEAD.
async function folderLevel(repo: Repository, ask: LayoutAsk, head: CommitHash, signal?: AbortSignal): Promise<Level> {
	const seeds = splitScope(await projectFiles(repo, head, signal), ask.within)
	const places = seeds.flatMap((seed) => seed.paths)
	if (ask.at === head) {
		return { named: null, boxes: seeds.map((seed) => ({ ...seed, job: null, state: 'same' })), arrows: [], loose: [] }
	}
	const [idsAtHead, idsAt, files] = await Promise.all([
		repo.objectIds(head, places, signal),
		repo.objectIds(ask.at, places, signal),
		projectFiles(repo, ask.at, signal),
	])
	const atHead = new Map(places.map((place, i) => [place, idsAtHead[i] ?? null]))
	const atAsked = new Map(places.map((place, i) => [place, idsAt[i] ?? null]))
	return {
		named: null,
		boxes: seeds.map((seed) => ({ ...seed, job: null, state: stateAt(seed.paths, atHead, atAsked) })),
		arrows: [],
		loose: looseIn(files, ask.within, places),
	}
}

function sameScope(layout: Stored, within: Scope): boolean {
	return layout.within.length === within.length && layout.within.every((place, i) => place === within[i])
}

function countUnder(files: string[], paths: string[]): number {
	return files.filter((file) => paths.some((place) => under(file, place))).length
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

// What sits in the scope in no box, each as the shortest path that holds no box: a folder beside the boxes, such as
// src/extra beside the parts src/agent and src/checks, not src.
function looseIn(files: string[], within: Scope, places: string[]): string[] {
	const entryOf = (file: string): string | null => {
		const scope = within.length === 0 ? '' : within.find((place) => under(file, place))
		if (scope === undefined) return null
		const segments = file.split('/')
		for (let depth = scope === '' ? 1 : scope.split('/').length + 1; depth <= segments.length; depth++) {
			const entry = segments.slice(0, depth).join('/')
			if (!places.some((place) => place.startsWith(`${entry}/`))) return entry
		}
		return file
	}
	const loose = files
		.filter((file) => !places.some((place) => under(file, place)))
		.flatMap((file) => entryOf(file) ?? [])
	return [...new Set(loose)]
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
