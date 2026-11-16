import { createHash } from 'node:crypto'
import type { CommitHash, Repository } from '../repo/index.ts'
import type { Observation } from './watch-step.ts'

// One poll, read from git and the working tree, writing nothing. The tree fingerprint changes whenever an uncommitted
// file changes: its size and time move even when its count of changed lines does not. noted is the HEAD the last note
// covered; landed counts the commits from where noted and HEAD split, so an amend or a rebase still earns a note.
export async function observe(repo: Repository, noted: CommitHash | null, signal?: AbortSignal): Promise<Observation> {
	const resolved = await repo.resolve('HEAD', signal)
	if (resolved.kind !== 'ok') throw new Error('the project has no HEAD commit, so ken has nothing to watch')
	const head = resolved.commit
	const listed = await repo.uncommitted(signal)
	const files = listed.kind === 'ok' ? listed.files : []
	const tree =
		files.length === 0
			? null
			: createHash('sha256')
					.update(JSON.stringify(files.map((file) => [file.path, file.change, file.bytes, file.modifiedAt])))
					.digest('hex')
	if (noted === null || noted === head) return { head, tree, landed: { base: head, commits: 0 } }
	const split = await repo.mergeBase(noted, head, signal)
	const base = split.kind === 'ok' ? split.commit : noted
	const log = await repo.log({ base, head }, signal)
	return { head, tree, landed: { base, commits: log.kind === 'ok' ? log.commits.length : 1 } }
}
