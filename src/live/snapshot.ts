// ken never writes to the project (plan: "the companion's tools only read the project; the only files it writes are its
// own stores"), and that holds for uncommitted work too. To quote a line nobody has committed, ken copies the work into
// a commit of its own, in a git object folder under ~/.ken. Nothing under the project's .git and nothing in its working
// tree changes: no object, no ref, no index, no lock. storeEnv is the only place ken points git at a place it may write.
import { execFile } from 'node:child_process'
import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CommitHash, Repository, Uncommitted } from '../repo/index.ts'

// objects is ken's own object folder for this project. project is the project's object folder, which git reads as an
// alternate so a snapshot can point at the project's own trees and blobs without copying them.
export type SnapshotStore = { objects: string; project: string }

// taken: commit holds the working tree as ken could take it in, with HEAD as its parent. The same work on the same HEAD
// always gives the same commit. clean: nothing ken could take in differs from HEAD. leftOut counts the files ken left
// out because they are binary, larger than BOUNDS.fileBytes, past BOUNDS.snapshotBytes, or not plain files.
export type Snapshot =
	| { kind: 'taken'; commit: CommitHash; head: CommitHash; files: number; leftOut: number }
	| { kind: 'clean'; head: CommitHash; leftOut: number }

// What one snapshot takes in, and how large the store may grow before ken empties it when live mode starts.
const BOUNDS = { fileBytes: 1024 * 1024, snapshotBytes: 8 * 1024 * 1024, storeBytes: 200 * 1024 * 1024 }

const execFileAsync = promisify(execFile)

// The store keeps the snapshots of the live runs since it was last emptied. Live mode empties it when it starts and
// finds it over BOUNDS.storeBytes. A note keeps its quotes as text in the reader's history, so an emptied store loses
// nothing a note shows.
export async function openSnapshots(home: string, repo: Repository, root: string): Promise<SnapshotStore> {
	const first = await repo.firstCommit()
	if (first === null) throw new Error(`${root} has no commits, so ken has nothing to take a snapshot on top of`)
	const objects = path.join(home, 'projects', first, 'snapshots')
	if ((await folderBytes(objects)) > BOUNDS.storeBytes) await rm(objects, { recursive: true, force: true })
	await mkdir(objects, { recursive: true })
	// A plain read: rev-parse writes nothing. The common folder holds the objects of every worktree of the project.
	const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
		cwd: root,
		encoding: 'utf8',
	})
	return { objects, project: path.join(stdout.trim(), 'objects') }
}

export async function takeSnapshot(
	store: SnapshotStore,
	repo: Repository,
	root: string,
	signal?: AbortSignal,
): Promise<Snapshot> {
	const resolved = await repo.resolve('HEAD', signal)
	if (resolved.kind !== 'ok') throw new Error(`${root} has no HEAD commit to take a snapshot on top of`)
	const head = resolved.commit
	const [listed, line] = await Promise.all([repo.uncommitted(signal), repo.mainLine(head, 1, signal)])
	const files = listed.kind === 'ok' ? listed.files : []
	const date = line.kind === 'ok' ? line.commits[0]?.date : undefined
	const { kept, leftOut } = await within(root, files)

	const index = path.join(path.dirname(store.objects), `snapshot-index-${process.pid}-${Date.now()}`)
	const git = storeGit(store, root, index, date ?? new Date(0).toISOString())
	try {
		await git(['read-tree', head], '', signal)
		const copied = kept.filter((file) => file.change !== 'deleted')
		const blobs = (await git(['hash-object', '-w', '--no-filters', '--stdin-paths'], lines(copied), signal))
			.trim()
			.split('\n')
		const none = '0'.repeat(head.length)
		const entries = [
			...copied.map((file, i) => `${file.mode} ${blobs[i]}\t${file.path}\0`),
			...kept.filter((file) => file.change === 'deleted').map((file) => `0 ${none}\t${file.path}\0`),
		]
		await git(['update-index', '-z', '--index-info'], entries.join(''), signal)
		const tree = (await git(['write-tree'], '', signal)).trim()
		const headTree = (await git(['rev-parse', `${head}^{tree}`], '', signal)).trim()
		if (tree === headTree) return { kind: 'clean', head, leftOut }
		// No message: a snapshot says nothing, so no quote of it can pass as a reason written down with the work.
		const commit = (await git(['commit-tree', tree, '-p', head], '', signal)).trim() as CommitHash
		return { kind: 'taken', commit, head, files: kept.length, leftOut }
	} finally {
		await rm(index, { force: true })
	}
}

type Kept = Uncommitted & { mode: '100644' | '100755' }

// The files a snapshot takes in, in the order git listed them, and how many it leaves out.
async function within(root: string, files: Uncommitted[]): Promise<{ kept: Kept[]; leftOut: number }> {
	const kept: Kept[] = []
	let bytes = 0
	for (const file of files) {
		if (file.change === 'deleted') {
			kept.push({ ...file, mode: '100644' })
			continue
		}
		const info = await lstat(path.join(root, file.path)).catch(() => null)
		// git hands hash-object one path per line, so a path with a line break in it stays out too.
		if (!info?.isFile() || file.added === null || file.path.includes('\n')) continue
		if (info.size > BOUNDS.fileBytes || bytes + info.size > BOUNDS.snapshotBytes) continue
		bytes += info.size
		kept.push({ ...file, mode: (info.mode & 0o111) === 0 ? '100644' : '100755' })
	}
	return { kept, leftOut: files.length - kept.length }
}

// Every git command the snapshot runs goes through here, with storeEnv, and the paths it is handed come from git.
function storeGit(store: SnapshotStore, root: string, index: string, date: string) {
	const env = storeEnv(store, index, date)
	return async (args: string[], input: string, signal?: AbortSignal): Promise<string> => {
		const run = execFileAsync('git', args, {
			cwd: root,
			env,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
			...(signal && { signal }),
		})
		// A command that reads no input, such as write-tree, may exit before its input closes. Its exit code says
		// whether it worked, so the broken pipe is not an error.
		run.child.stdin?.on('error', () => {})
		run.child.stdin?.end(input)
		return (await run).stdout
	}
}

// New objects go to ken's own folder, the index is a temporary file beside it, and the project's objects are read as an
// alternate. The commit's author, committer and date are fixed by HEAD, so the same work gives the same commit.
function storeEnv(store: SnapshotStore, index: string, date: string): NodeJS.ProcessEnv {
	const when = `@${Math.floor(Date.parse(date) / 1000)} +0000`
	return {
		...process.env,
		GIT_OBJECT_DIRECTORY: store.objects,
		GIT_ALTERNATE_OBJECT_DIRECTORIES: store.project,
		GIT_INDEX_FILE: index,
		GIT_OPTIONAL_LOCKS: '0',
		GIT_AUTHOR_NAME: 'ken',
		GIT_AUTHOR_EMAIL: 'ken@localhost',
		GIT_AUTHOR_DATE: when,
		GIT_COMMITTER_NAME: 'ken',
		GIT_COMMITTER_EMAIL: 'ken@localhost',
		GIT_COMMITTER_DATE: when,
	}
}

function lines(files: Kept[]): string {
	return files.map((file) => `${file.path}\n`).join('')
}

async function folderBytes(folder: string): Promise<number> {
	const names = await readdir(folder, { recursive: true }).catch(() => [])
	let total = 0
	for (const name of names) total += (await stat(path.join(folder, name)).catch(() => null))?.size ?? 0
	return total
}
