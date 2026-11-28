// What the page says the reader looked at, turned into a line of what they looked at. The page reports what it saw,
// and this file decides what counts: a brief counts as read once it stayed on screen for READ_MS, a path must be in
// the project at HEAD, or in the change itself when the reader looked at a change, since a change may add or delete a
// file, and every line carries HEAD as it is now.
import type { CommitHash, RepoPath, Repository } from '../../repo/index.ts'
import type { Did, Known, Looked, ReaderSeen } from './reader-seen.ts'

// A brief ken has explained, open in its drawer with the tab in view, counts as read after this long. The page waits
// this long before it reports the brief.
export const READ_MS = 10_000

// What the page sent, with its shape checked. shown is how long a brief stayed on screen with the tab in view. A line
// the reader takes back names no path: it names the line by the moment ken wrote it.
export type Sent =
	| { did: 'undo'; at: string }
	| ({ paths: RepoPath[] } & (
			| { did: Exclude<Did, 'read' | 'change' | 'set'> }
			| { did: 'read'; shown: number }
			| { did: 'change'; change: { base: string; head: string } }
			| { did: 'set'; level: Known }
	  ))

export type Taken = { kind: 'taken'; added: 'written' | 'repeat' | 'missing' } | { kind: 'refused'; problem: string }

// repo is where the paths and commits are looked up, which sees the snapshots of uncommitted work.
export async function takeSent(seen: ReaderSeen, repo: Repository, sent: Sent, now: Date): Promise<Taken> {
	if (sent.did === 'read' && sent.shown < READ_MS) {
		return { kind: 'refused', problem: `A brief counts as read after ${READ_MS / 1000} seconds on screen.` }
	}
	const head = await repo.resolve('HEAD')
	if (head.kind !== 'ok') return { kind: 'refused', problem: 'The project has no commits yet.' }
	if (sent.did === 'undo') return { kind: 'taken', added: await seen.undo(sent.at, head.commit, now) }
	const { paths } = sent
	const missing = async (commits: CommitHash[]) => {
		const ids = await Promise.all(commits.map((commit) => repo.objectIds(commit, paths)))
		const path = paths.find((_, index) => ids.every((at) => at[index] === null))
		return path === undefined ? null : ({ kind: 'refused', problem: `"${path}" is not in the project.` } as const)
	}
	const take = async (looked: Looked, commits: CommitHash[]): Promise<Taken> =>
		(await missing(commits)) ?? { kind: 'taken', added: await seen.add(looked, head.commit, now) }
	switch (sent.did) {
		case 'read':
			return await take({ did: 'read', paths }, [head.commit])
		case 'set':
			return await take({ did: 'set', paths, level: sent.level }, [head.commit])
		case 'change': {
			const [from, to] = await Promise.all([repo.resolve(sent.change.base), repo.resolve(sent.change.head)])
			if (from.kind !== 'ok' || to.kind !== 'ok') {
				return { kind: 'refused', problem: 'Send change: { base, head }, each a commit of this project.' }
			}
			const change = { base: from.commit, head: to.commit }
			return await take({ did: 'change', paths, change }, [head.commit, change.head, change.base])
		}
		default:
			return await take({ did: sent.did, paths }, [head.commit])
	}
}
