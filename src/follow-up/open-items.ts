// What is open for the owner, the plan's "following up": each decision that needs the owner's call and that they have
// not answered, and each topic they understood whose code changed since, with the commits that touched its files and
// who made them. A topic stays open until the owner says "I know this" on it again. A question about it does not close
// it, because a question is interest, not understanding.
import type { TopicState } from '../map/index.ts'
import { type RecordEntry, type RecordRead, type Who, whoDidIt } from '../record/index.ts'
import type { Commit, CommitHash, Repository } from '../repo/index.ts'
import { commitsSince } from './commits-since.ts'

export type OpenDecision = Extract<RecordEntry, { kind: 'decision' }>

export type ChangedTopic = Extract<TopicState, { kind: 'changed' | 'long-ago' }>

// A commit with who made it by the record's rule (owner's agent, collaborator or unknown) beside the author git names.
export type ChangeCommit = { hash: CommitHash; author: string; email: string; date: string; subject: string; by: Who }

// since is the commit the owner's understanding starts from: see commitsSince.
export type OpenTopic = { state: ChangedTopic; since: CommitHash | null; commits: ChangeCommit[] }

export type OpenItems = { decisions: OpenDecision[]; topics: OpenTopic[] }

// states is the understanding map read now, one state per topic of the record.
export async function openItems(
	repo: Repository,
	record: RecordRead,
	states: TopicState[],
	signal?: AbortSignal,
): Promise<OpenItems> {
	const decisions = openDecisions(record)
	const changed = states.flatMap((state) =>
		(state.kind === 'changed' || state.kind === 'long-ago') && state.changed.length > 0 ? [state] : [],
	)
	const userEmail = await repo.userEmail(signal)
	const topics = await Promise.all(
		changed.map(async (state) => {
			const { since, commits } = await commitsSince(repo, record, state, signal)
			return { state, since, commits: commits.map((commit) => changeCommit(commit, userEmail)) }
		}),
	)
	return { decisions, topics }
}

// The decisions that need the owner's call and that they have not answered.
export function openDecisions(record: RecordRead): OpenDecision[] {
	return record.current.flatMap((entry) => (entry.kind === 'decision' && entry.needsOwner ? [entry] : []))
}

export function changeCommit(commit: Commit, userEmail: string | null): ChangeCommit {
	const { hash, author, email, date, subject } = commit
	return { hash, author, email, date, subject, by: whoDidIt(commit, userEmail) }
}
