// Reads what the page says the reader looked at, before ken writes a line of it. The body comes from outside, so each
// part is checked here: the did, the paths, the level of a correction, and the commits of a change. A path must be in
// the project at HEAD, or in the change itself when the reader looked at a change, since a change may add or delete a
// file. A line the reader takes back names no path: it names the line by the moment ken wrote it.
import { DID, KNOWN, type Looked } from '../../map/index.ts'
import { type CommitHash, parsePath, type RepoPath, type Repository } from '../../repo/index.ts'
import { fieldOf } from '../question-desk.ts'

const MAX_PATHS = 200

// head is HEAD now, which ken stamps on the line.
export async function readLooked(
	repo: Repository,
	body: unknown,
): Promise<
	| { kind: 'ok'; looked: Looked; head: CommitHash }
	| { kind: 'undo'; at: string; head: CommitHash }
	| { kind: 'refused'; problem: string }
> {
	if (fieldOf(body, 'did') === 'undo') {
		const at = fieldOf(body, 'at')
		const now = await repo.resolve('HEAD')
		if (typeof at !== 'string') return { kind: 'refused', problem: 'Send at: the at of the line to take back.' }
		if (now.kind !== 'ok') return { kind: 'refused', problem: 'The project has no commits yet.' }
		return { kind: 'undo', at, head: now.commit }
	}
	const did = DID.find((each) => each === fieldOf(body, 'did'))
	if (!did) return { kind: 'refused', problem: `Send did: one of ${DID.join(', ')}, undo.` }
	const sent = fieldOf(body, 'paths')
	if (!Array.isArray(sent) || sent.length === 0 || sent.length > MAX_PATHS) {
		return { kind: 'refused', problem: `Send paths: a list of 1 to ${MAX_PATHS} paths in the project.` }
	}
	const paths: RepoPath[] = []
	for (const each of sent) {
		const parsed = typeof each === 'string' ? parsePath(each) : ({ kind: 'refused', reason: 'a path is text' } as const)
		if (parsed.kind !== 'ok') return { kind: 'refused', problem: `${parsed.reason}.` }
		paths.push(parsed.path)
	}
	const head = await repo.resolve('HEAD')
	if (head.kind !== 'ok') return { kind: 'refused', problem: 'The project has no commits yet.' }
	const missing = async (commits: CommitHash[]) => {
		const ids = await Promise.all(commits.map((commit) => repo.objectIds(commit, paths)))
		const path = paths.find((_, index) => ids.every((at) => at[index] === null))
		return path === undefined ? null : ({ kind: 'refused', problem: `"${path}" is not in the project.` } as const)
	}
	if (did === 'set') {
		const level = KNOWN.find((each) => each === fieldOf(body, 'level'))
		if (!level) return { kind: 'refused', problem: `Send level: one of ${KNOWN.join(', ')}.` }
		return (await missing([head.commit])) ?? { kind: 'ok', looked: { did, paths, level }, head: head.commit }
	}
	if (did !== 'change') {
		return (await missing([head.commit])) ?? { kind: 'ok', looked: { did, paths }, head: head.commit }
	}
	const change = await changeOf(repo, fieldOf(body, 'change'))
	if (change === null) {
		return { kind: 'refused', problem: 'Send change: { base, head }, each a commit of this project.' }
	}
	return (
		(await missing([head.commit, change.head, change.base])) ?? {
			kind: 'ok',
			looked: { did, paths, change },
			head: head.commit,
		}
	)
}

async function changeOf(repo: Repository, sent: unknown): Promise<{ base: CommitHash; head: CommitHash } | null> {
	const [base, head] = [fieldOf(sent, 'base'), fieldOf(sent, 'head')]
	if (typeof base !== 'string' || typeof head !== 'string') return null
	const [from, to] = await Promise.all([repo.resolve(base), repo.resolve(head)])
	return from.kind === 'ok' && to.kind === 'ok' ? { base: from.commit, head: to.commit } : null
}
