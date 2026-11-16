import type { RecordEntry, RecordStore } from '../record/index.ts'
import type { OpenDecision } from './open-items.ts'

// The owner's "I have decided" on a decision that waits on them. The caller names the decision and may give a note, and
// nothing else: ken copies the decision as the record holds it, so the answer cannot change what was decided. The new
// entry goes through the record's own gate and replaces the old one, which stays readable.
export async function decide(
	store: RecordStore,
	answer: { id: string; note: string; now: Date },
	signal?: AbortSignal,
): Promise<{ kind: 'decided'; entry: RecordEntry } | { kind: 'refused'; problem: string }> {
	const decision = (await store.read()).current.find((entry) => entry.id === answer.id)
	// The record's gate refuses an answer to a decision that does not wait on the owner, so this checks only that it exists.
	if (decision?.kind !== 'decision') return { kind: 'refused', problem: 'ken has no such decision open.' }
	const { id, at, replaces, label, reason, quotes, topic, ...same } = decision
	const note = answer.note.trim()
	const appended = await store.append(
		[
			{
				...same,
				reason: reason && { text: reason.text, quotes: reason.quotes.map(asDrafted) },
				quotes: quotes.map(asDrafted),
				topic: topic ?? undefined,
				needsOwner: false,
				answer: { at: answer.now.toISOString(), note: note === '' ? null : note },
				replaces: id,
			},
		],
		signal,
	)
	if (appended.kind === 'refused') return { kind: 'refused', problem: appended.problems.join(' ') }
	const [written] = appended.entries
	if (!written) throw new Error('the record appended one draft and returned no entry')
	return { kind: 'decided', entry: written.entry }
}

// A quote the record checked, as a writer hands it in, so the gate checks it again at the same commit.
function asDrafted(quote: OpenDecision['quotes'][number]) {
	return { path: quote.path, commit: quote.commit, text: quote.text, line: quote.startLine }
}
