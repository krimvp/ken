// One level of the project's layout as it looks at one commit. The boxes are the parts ken's model named for the level's
// scope, when the record holds such a level, or else the scope's folders at HEAD. git's own ids then say which boxes
// are the same, different or not there at the commit asked, a change is laid over them by its diff paths, the reader's
// map marks the topics inside each, and each box says what ken thinks the reader knows of it. All of it is derived on
// every read, from git, the record, the map and what the reader looked at, and nothing is stored here. A box opens the
// level whose scope is the box's paths.

import { openDecisions } from '../follow-up/index.ts'
import type { SnapshotStore } from '../live/index.ts'
import type { ReaderSeen, UnderstandingMap } from '../map/index.ts'
import type { EntryId, RecordEntry, RecordStore } from '../record/index.ts'
import type { CommitHash, FileDiff, ObjectId, Range, RepoPath, Repository } from '../repo/index.ts'
import { type Seed, splitScope, under } from './folder-split.ts'
import { believe, type Knows, looksAt } from './reader/box-knows.ts'
import { type LandedSize, nextItems } from './reader/next-items.ts'
import { type BoxMap, type BoxTopic, boxMap, markOf, type Next, nextOf, topicsIn } from './reader/reader-marks.ts'
import { sinceLooked } from './reader/since-looked.ts'
import { toReview } from './reader/to-review.ts'
import { type TourStop, tourOrder } from './tour-order.ts'
import { type ChangedViewItem, changedViewItems } from './view-changes.ts'

// The paths a level shows the inside of, sorted. The empty list is the whole project.
export type Scope = RepoPath[]

// kind says how the change was asked for: the reader's uncommitted work, a branch against the main branch, or a range
// of commits, which a span of time is too. name says what the change is to the reader: "Uncommitted work", a branch,
// a range as they typed it, or a span such as "In the last 14 days". asked is the text that asks for this change again.
export type Change = { kind: 'uncommitted' | 'branch' | 'range'; name: string; asked: string; range: Range }

// own is the reader's own work now, whatever change they asked for: what they have not committed, else the branch
// they are on against the main branch, else null.
export type LayoutAsk = { at: CommitHash; within: Scope; change: Change | null; own: Change | null }

// repo reads the project and ken's snapshots of uncommitted work, so a change can end at a snapshot.
export type LayoutSources = {
	root: string
	repo: Repository
	snapshots: SnapshotStore
	record: RecordStore
	map: UnderstandingMap
	seen: ReaderSeen
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
// a folder and at the commit asked for a part. opens is false for a box of one file, which has no level inside. inside
// is how many parts ken's model named for the level inside the box, or null when nobody named them, so the page can
// say what opening the box shows. state compares the box at an older commit with HEAD, and a named part at HEAD with
// the commit it was named at. touched is null when no change is asked or this one leaves the box alone. knows is what
// ken thinks the reader knows of the box, and map says the same as a standing.
export type LookBox = Seed & {
	job: string | null
	opens: boolean
	inside: number | null
	state: 'same' | 'changed' | 'gone'
	touched: Touched | null
	topics: BoxTopic[]
	map: BoxMap
	knows: Knows
}

// A level ken's model named: the record entry, the commit it was named at, and what no longer fits there. added names
// what sits in the scope at the commit asked, in no part, and was not there when the model named the parts. stale says
// the drawing no longer fits: a part changed or went, or something was added in no part. about is the model's sentence
// or two on the level as a whole, and asked the reader's own words when ken drew it because they asked for another way
// to show it. Each is null when the entry has none. flows are the processes of the level the model found worth a
// diagram, each a short request the page offers to draw, and none for a level named before ken asked for them.
export type Named = {
	id: EntryId
	drawnAt: CommitHash
	added: string[]
	stale: boolean
	about: string | null
	asked: string | null
	flows: string[]
}

// An arrow is possibly stale when the part it starts at changed since the model named the parts, since its lines may
// have changed with it.
export type LookArrow = Stored['arrows'][number] & { stale: boolean }

type Stored = Extract<RecordEntry, { kind: 'layout' }>
type StoredViews = NonNullable<Stored['views']>

// "In its world" and "Where it runs", on the top level only. The project's block in the world says what the level's
// about says. drawn is the day ken kept them. Each is null when ken's model has not named it.
export type LookViews = {
	world: (NonNullable<StoredViews['world']> & { project: { line: string | null } }) | null
	runtime: StoredViews['runtime']
	drawn: string | null
	stale?: ChangedViewItem[]
}

const NO_VIEWS: LookViews = { world: null, runtime: null, drawn: null }

// loose names what sits in the scope at the commit asked and in no box, such as a folder HEAD no longer has or one the
// model left out of its parts. Of a change, files counts the changed files in the level's scope and outside names
// those no box holds. commits are its commits, newest first, without merges, since the commits a merge brings are
// listed themselves, and merges counts those merges. Uncommitted work has none: it ends at ken's snapshot, which is no
// commit of the project. It lists at most MAX_COMMITS, moreCommits counts the rest, and oldest is the date of the
// oldest commit, listed or not.
export type LayoutLook = {
	at: CommitHash
	head: CommitHash
	within: Scope
	named: Named | null
	boxes: LookBox[]
	arrows: LookArrow[]
	loose: string[]
	change:
		| (Change & {
				files: number
				outside: string[]
				commits: LandedCommit[]
				moreCommits: number
				merges: number
				oldest: string | null
		  })
		| null
	next: Next
	tour: TourStop[] | null
	views?: LookViews
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
	const [diff, commits, mapRead, seen] = await Promise.all([
		ask.change && changedFiles(repo, ask.change.range, signal),
		ask.change && (ask.change.kind === 'uncommitted' ? NO_COMMITS : landedCommits(repo, ask.change.range, signal)),
		sources.map.read(now, signal),
		sources.seen.read(),
	])
	const topics = [...read.current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : [])), ...mapRead.own]
	const drawn = level.boxes.map((box) => {
		const inBox = topicsIn(box.paths, topics, mapRead.states)
		const states = inBox.map((each) => each.state)
		return { box, inBox, looks: looksAt(box.paths, seen.lines, states) }
	})
	const sinces = await sinceLooked(repo, read, head.commit, drawn, signal)
	const boxes: LookBox[] = drawn.map(({ box, inBox, looks }, index) => {
		const knows = believe(looks, sinces[index] ?? null, head.commit, now)
		const marks = inBox.map(({ topic, state }) => ({ topic, mark: markOf(state) }))
		const within = versionsOf(read.entries, box.paths.toSorted())
		return {
			...box,
			opens: level.named ? box.files > 1 : box.files > 0 && !box.file,
			inside: within.length > 0 ? newest(within).parts.length : null,
			touched: diff && touchedIn(box.paths, diff),
			topics: marks,
			map: boxMap(knows, marks),
			knows,
		}
	})
	// Inside a part, the change is what it did to that part: a file changed elsewhere is not this level's to count.
	const inScope = (diff ?? []).filter((file) => ask.within.length === 0 || pathIn(file, ask.within) !== null)
	const change =
		ask.change && commits
			? {
					...ask.change,
					files: inScope.length,
					outside: inScope.flatMap((file) =>
						pathIn(file, places) === null ? [pathIn(file, ask.within) ?? file.path] : [],
					),
					commits: commits.commits,
					moreCommits: commits.more,
					merges: commits.merges,
					oldest: commits.oldest,
				}
			: null
	const tour = level.named ? tourOrder(boxes.filter((box) => box.state !== 'gone')) : null
	const items = nextItems({
		decisions: openDecisions(read)
			.toSorted((a, b) => b.at.localeCompare(a.at))
			.map((decision) => decision.question),
		boxes: await Promise.all(
			boxes.map(async ({ name, paths, knows }, index) => {
				const since = sinces[index]
				const stale = knows.stale && since && since !== 'gone' ? since.commit : null
				const landed = stale === null ? null : await landedIn(repo, paths, stale, head.commit, signal)
				return { name, knows, landed }
			}),
		),
		order: (tour ?? boxes).map((each) => each.name),
		toured: tour !== null,
		review: await toReview(repo, { own: ask.own, diff: sameChange(ask.own, ask.change) ? diff : null }, head.commit, {
			boxes,
			lines: seen.lines,
		}),
	})
	const { views, ...named } = level
	return {
		at: ask.at,
		head: head.commit,
		within: ask.within,
		...named,
		boxes,
		change,
		next: nextOf(boxes, items),
		tour,
		...(ask.within.length === 0 ? { views } : {}),
	}
}

// What the commits after one the reader looked at did to a box, or null when the diff is too large to read. The few
// boxes that changed since are each read once: they may have been looked at at different commits.
async function landedIn(
	repo: Repository,
	paths: string[],
	lookedAt: string,
	head: CommitHash,
	signal?: AbortSignal,
): Promise<LandedSize | null> {
	const base = await repo.resolve(lookedAt, signal)
	const diff = base.kind === 'ok' ? await repo.diff({ base: base.commit, head }, signal, paths) : null
	const touched = diff?.kind === 'ok' ? touchedIn(paths, diff.files) : null
	return touched && { files: touched.files, added: touched.added, removed: touched.removed }
}

function sameChange(a: Change | null, b: Change | null): boolean {
	return a !== null && b !== null && a.range.base === b.range.base && a.range.head === b.range.head
}

type Level = {
	named: Named | null
	boxes: (Seed & { job: string | null; state: LookBox['state'] })[]
	arrows: LookArrow[]
	loose: string[]
	views: LookViews
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
			flows: chosen.flows ?? [],
		},
		boxes,
		arrows: chosen.arrows.map((arrow) => ({ ...arrow, text: fromStart(arrow), stale: changed.has(arrow.from) })),
		loose,
		views: chosen.views
			? {
					world: chosen.views.world && { project: { line: chosen.about ?? null }, ...chosen.views.world },
					runtime: chosen.views.runtime,
					drawn: chosen.at.slice(0, 10),
					stale: await changedViewItems(repo, chosen.id, chosen.views, ask.at, signal),
				}
			: NO_VIEWS,
	}
}

// The scope's folders at HEAD, with no model. Each is the same, changed or gone at the commit asked, against HEAD.
async function folderLevel(repo: Repository, ask: LayoutAsk, head: CommitHash, signal?: AbortSignal): Promise<Level> {
	const seeds = splitScope(await projectFiles(repo, head, signal), ask.within)
	const places = seeds.flatMap((seed) => seed.paths)
	if (ask.at === head) {
		return {
			named: null,
			boxes: seeds.map((seed) => ({ ...seed, job: null, state: 'same' })),
			arrows: [],
			loose: [],
			views: NO_VIEWS,
		}
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
		views: NO_VIEWS,
	}
}

// An arrow starts at the part whose lines name the other, and the page reads it as "start, verb, end". A verb saved the
// other way round, such as "is used by", would say the opposite, so it reads as "uses".
function fromStart(arrow: Stored['arrows'][number]): string {
	const verb = arrow.text
	// A static import alone shows a dependency. A second quoted line can show what the caller does with it.
	const onlyImport = /^\s*import\s+(?:[\w$*,\s{}]+\s+from\s*)?["'][^"'\n]+["']\s*;?\s*$/
	if (
		arrow.quotes.length &&
		arrow.quotes.every((q) => /\.[cm]?[jt]sx?$/i.test(q.path ?? '') && onlyImport.test(q.text))
	) {
		return 'imports'
	}
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

type Landed = { commits: LandedCommit[]; more: number; merges: number; oldest: string | null }

const NO_COMMITS: Landed = { commits: [], more: 0, merges: 0, oldest: null }

// A range git cannot list even without file names shows no commits rather than no layout.
async function landedCommits(repo: Repository, range: Range, signal?: AbortSignal): Promise<Landed> {
	const listed = await repo.commitsIn(range, MAX_COMMITS, signal)
	if (listed.kind !== 'ok') return NO_COMMITS
	const commits = listed.commits.map(({ hash, subject, author, date }) => ({ hash, subject, author, date }))
	return { commits, more: listed.more, merges: listed.merges, oldest: listed.oldest }
}

function touchedIn(paths: string[], diff: FileDiff[]): Touched | null {
	const files = diff.flatMap((file) => {
		const path = pathIn(file, paths)
		if (path === null) return []
		const lines = file.kind === 'text' ? file.hunks.flatMap((hunk) => hunk.lines) : []
		const count = (sign: string) => lines.filter((line) => line.startsWith(sign)).length
		return [{ path, added: count('+'), removed: count('-') }]
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

// A moved file was in the place it left and is in the place it went to, so it counts in both, by the path it has there.
function pathIn(file: FileDiff, places: string[]): string | null {
	return [file.path, file.oldPath].find((each) => places.some((place) => under(each, place))) ?? null
}
