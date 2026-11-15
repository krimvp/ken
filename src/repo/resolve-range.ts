import type { NoCommit, Range, Refused, Repository, Unrelated } from './repository.ts'

// A change is what head did since it split from base, as base..head means in git log. A diff straight from base to
// head would also show, for a branch that is behind main, main's own later changes reversed. So the range starts at
// the merge base. For a merge commit's change, <merge>^1 to <merge>, the merge base is <merge>^1 itself.
export async function resolveRange(
	repo: Repository,
	refs: { base: string; head: string },
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; range: Range } | Refused | NoCommit | Unrelated> {
	const base = await repo.resolve(refs.base, signal)
	if (base.kind !== 'ok') return base
	const head = await repo.resolve(refs.head, signal)
	if (head.kind !== 'ok') return head
	const split = await repo.mergeBase(base.commit, head.commit, signal)
	if (split.kind !== 'ok') return split
	return { kind: 'ok', range: { base: split.commit, head: head.commit } }
}
