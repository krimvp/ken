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
import { type BoxMap, type BoxTopic, boxMap, boxTopics, type Next, nextOf } from './reader-marks.ts'
import { type TourStop, tourOrder } from './tour-order.ts'

// The paths a level shows the inside of, sorted. The empty list is the whole project.
export type Scope = RepoPath[]

// kind says how the change was asked for: the reader's uncommitted work, a branch against the main branch, or a range
// of commits, which a span of time is too. name says what the change is to the reader: "Uncommitted work", a branch,
// a range as they typed it, or a span such as "In the last 14 days". asked is the text that asks for this change again.
export type Change = { kind: 'uncommitted' | 'branch' | 'range'; name: string; asked: string; range: Range }

export type LayoutAsk = { at: CommitHash; within: Scope; change: Change | null }

// repo reads the project and ken's snapshots of uncommitted work, so a change can end at a snapshot.
export type LayoutSources = {
	root: string
	repo: Repository
	snapshots: SnapshotStore
	record: RecordStore
	map: UnderstandingMap
}

// What a change did to one box. paths lists its changed files, at most MAX_PATHS, and morePaths counts the rest.
export type Touched = {
	files: number
	added: number
	removed: number
	paths: { path: string; added: number; removed: number }[]
	morePaths: number
}

// A commit of the change laid over the picture, as the page lists it.
export type LandedCommit = { hash: CommitHash; subject: string; author: string; date: string }

// The page shows a change with no model, so it lists what git knows, up to what a reader scans.
const MAX_COMMITS = 50
const MAX_PATHS = 20

// job is the model's one line on a part it named, null for a folder. files counts the files under the box at HEAD for
// a folder and at the commit asked for a part. opens is false for a box of one file, which has no level inside. state
// compares the box at an older commit with HEAD, and a named part at HEAD with the commit it was named at. touched is
// null when no change is asked or this one leaves the box alone.
export type LookBox = Seed & {
	job: string | null
	opens: boolean
	state: 'same' | 'changed' | 'gone'
	touched: Touched | null
	topics: BoxTopic[]
	map: BoxMap
}

// A level ken's model named: the record entry, the commit it was named at, and what no longer fits there. added names
// what sits in the scope at the commit asked, in no part, and was not there when the model named the parts. stale says
// the drawing no longer fits: a part changed or went, or something was added in no part. about is the model's sentence
// or two on the level as a whole, and asked the reader's own words when ken drew it because they asked for another way
// to show it. Each is null when the entry has none.
export type Named = {
	id: EntryId
	drawnAt: CommitHash
	added: string[]
	stale: boolean
	about: string | null
	asked: string | null
}

// An arrow is possibly stale when the part it starts at changed since the model named the parts, since its lines may
// have changed with it.
export type LookArrow = Stored['arrows'][number] & { stale: boolean }

type Stored = Extract<RecordEntry, { kind: 'layout' }>

// loose names what sits in the scope at the commit asked and in no box, such as a folder HEAD no longer has or one the
// model left out of its parts. Of a change, files counts the changed files in the level's scope and outside names
// those no box holds. commits are its commits, newest first, without merges, since the commits a merge brings are
// listed themselves. It lists at most MAX_COMMITS, and moreCommits counts the rest.
export type LayoutLook = {
	at: CommitHash
	head: CommitHash
	within: Scope
	named: Named | null
	boxes: LookBox[]
	arrows: LookArrow[]
	loose: string[]
	change: (Change & { files: number; outside: string[]; commits: LandedCommit[]; moreCommits: number }) | null
	next: Next
	tour: TourStop[] | null
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
	const versions = versionsOf(read.entries, ask.within)
	const level =
		versions.length > 0
			? await namedLevel(repo, versions, ask, head.commit, signal)
			: await folderLevel(repo, ask, head.commit, signal)
	const places = level.boxes.flatMap((box) => box.paths)
	const [diff, commits, mapRead] = await Promise.all([
		ask.change && changedFiles(repo, ask.change.range, signal),
		ask.change && landedCommits(repo, ask.change.range, signal),
		sources.map.read(now, signal),
	])
	const topics = read.current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
	const boxes: LookBox[] = level.boxes.map((box) => {
		const marks = boxTopics(box.paths, topics, mapRead.states)
		return {
			...box,
			opens: box.files > 1,
			touched: diff && touchedIn(box.paths, diff),
			topics: marks,
			map: boxMap(marks),
		}
	})
	// Inside a part, the change is what it did to that part: a file changed elsewhere is not this level's to count.
	const inScope = (diff ?? [])
		.map((file) => file.path)
		.filter((file) => ask.within.length === 0 || ask.within.some((place) => under(file, place)))
	const change =
		ask.change && commits
			? {
					...ask.change,
					files: inScope.length,
					outside: inScope.filter((file) => !places.some((place) => under(file, place))),
					commits: commits.slice(0, MAX_COMMITS),
					moreCommits: Math.max(0, commits.length - MAX_COMMITS),
				}
			: null
	const tour = level.named
		? tourOrder(
				boxes.filter((box) => box.state !== 'gone'),
				level.arrows,
			)
		: null
	return { at: ask.at, head: head.commit, within: ask.within, ...level, boxes, change, next: nextOf(boxes), tour }
}

type Level = {
	named: Named | null
	boxes: (Seed & { job: string | null; state: LookBox['state'] })[]
	arrows: LookArrow[]
	loose: string[]
}

// Which stored version of the level shows. At the commit checked out it is the newest, so a redraw with fewer parts
// shows as drawn. At an older commit it is the version with the largest share of its parts the same there, the newest
// on a tie: the one that fit the code then.
async function namedLevel(
	repo: Repository,
	versions: Stored[],
	ask: LayoutAsk,
	head: CommitHash,
	signal?: AbortSignal,
): Promise<Level> {
	const places = [
		...new Set(versions.flatMap((version) => version.parts.flatMap((part) => part.places)).map((p) => p.path)),
	]
	const [ids, files] = await Promise.all([repo.objectIds(ask.at, places, signal), projectFiles(repo, ask.at, signal)])
	const idAt = new Map(places.map((place, i) => [place, ids[i] ?? null]))
	const stateOf = (part: Stored['parts'][number]): LookBox['state'] => {
		if (part.places.every((place) => idAt.get(place.path) === null)) return 'gone'
		return part.places.every((place) => idAt.get(place.path) === place.id) ? 'same' : 'changed'
	}
	const share = (version: Stored) =>
		version.parts.filter((part) => stateOf(part) === 'same').length / version.parts.length
	const chosen =
		ask.at === head
			? newest(versions)
			: versions.reduce((best, version) => {
					const [a, b] = [share(version), share(best)]
					return a > b || (a === b && version.at >= best.at) ? version : best
				})
	// At HEAD a part says whether it changed since it was named. At an older commit it says, as a folder does, whether it
	// was different then from now, which is what the reader looking back wants to know.
	const headIds = ask.at === head ? null : await repo.objectIds(head, places, signal)
	const atHead = new Map(places.map((place, i) => [place, headIds?.[i] ?? null]))
	const boxes = chosen.parts.map((part) => {
		const paths = part.places.map((place) => place.path)
		const state = headIds ? stateAt(paths, atHead, idAt) : stateOf(part)
		return { name: part.name, job: part.job, paths, files: countUnder(files, paths), state }
	})
	const loose = looseIn(
		files,
		ask.within,
		boxes.flatMap((box) => box.paths),
	)
	const thenIds = await repo.objectIds(chosen.drawnAt, loose as RepoPath[], signal)
	const added = loose.filter((_, i) => thenIds[i] === null)
	const changed = new Set(chosen.parts.filter((part) => stateOf(part) !== 'same').map((part) => part.name))
	return {
		named: {
			id: chosen.id,
			drawnAt: chosen.drawnAt,
			added,
			stale: changed.size > 0 || added.length > 0,
			about: chosen.about ?? null,
			asked: chosen.asked ?? null,
		},
		boxes,
		arrows: chosen.arrows.map((arrow) => ({ ...arrow, text: fromStart(arrow.text), stale: changed.has(arrow.from) })),
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

// An arrow starts at the part whose lines name the other, and the page reads it as "start, verb, end". A verb saved the
// other way round, such as "is used by", would say the opposite, so it reads as "uses".
function fromStart(verb: string): string {
	return /^(is|are|gets?)\b|\bby$/i.test(verb.trim()) ? 'uses' : verb
}

// The picture of a level that shows at the commit checked out, and the one "back to the picture before" brings back:
// the newest version older than the first one drawn the same as the shown one, so going back again walks further back.
// null when no version is older.
export function pictureBefore(entries: RecordEntry[], within: Scope): { shown: Stored; before: Stored } | null {
	const versions = oldestFirst(versionsOf(entries, within))
	const shown = versions.at(-1)
	if (!shown) return null
	const drawn = (version: Stored) => JSON.stringify([version.parts, version.arrows])
	const before = versions[versions.findIndex((version) => drawn(version) === drawn(shown)) - 1]
	return before ? { shown, before } : null
}

function versionsOf(entries: RecordEntry[], within: Scope): Stored[] {
	return entries.flatMap((entry) => (entry.kind === 'layout' && sameScope(entry, within) ? [entry] : []))
}

// A merge of two clones' records can put a newer line before an older one, so the order goes by when ken wrote each,
// and by the order in the file only between two written in the same moment.
function newest(versions: Stored[]): Stored {
	return versions.reduce((best, version) => (version.at >= best.at ? version : best))
}

function oldestFirst(versions: Stored[]): Stored[] {
	return versions.toSorted((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
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

async function landedCommits(repo: Repository, range: Range, signal?: AbortSignal): Promise<LandedCommit[]> {
	const logged = await repo.log(range, signal)
	if (logged.kind !== 'ok') {
		throw new Error(`The change ${range.base}..${range.head} has too many commits for ken to lay out.`)
	}
	return logged.commits
		.filter((commit) => commit.parents.length < 2)
		.map(({ hash, subject, author, date }) => ({ hash, subject, author, date }))
}

function touchedIn(paths: string[], diff: FileDiff[]): Touched | null {
	const files = diff
		.filter((file) => paths.some((place) => under(file.path, place)))
		.map((file) => {
			const lines = file.kind === 'text' ? file.hunks.flatMap((hunk) => hunk.lines) : []
			const count = (sign: string) => lines.filter((line) => line.startsWith(sign)).length
			return { path: file.path, added: count('+'), removed: count('-') }
		})
	if (files.length === 0) return null
	return {
		files: files.length,
		added: files.reduce((sum, file) => sum + file.added, 0),
		removed: files.reduce((sum, file) => sum + file.removed, 0),
		paths: files.slice(0, MAX_PATHS),
		morePaths: Math.max(0, files.length - MAX_PATHS),
	}
}
