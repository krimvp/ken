// The plan's rule for an answer: ken accepts it only when every quote passes verifyQuote, every statement and every risk
// carries a label its quotes allow, and every diagram passes checkDiagrams. One bad quote rejects the whole answer.
// Only then does ken read the change facts from git.
import {
	checkCoverage,
	checkLabel,
	countMessages,
	gitQuotes,
	type Quote,
	type QuoteSources,
	type VerifiedGitQuote,
	type VerifiedQuote,
	verifyQuote,
} from '../../checks/index.ts'
import { checkDiagrams, type DiagramDraft, diagramElements } from '../../diagram/index.ts'
import type { Undo } from '../../record/index.ts'
import { type Repository, resolveRange } from '../../repo/index.ts'
import { scopeProblem } from '../tools/exploration-tools.ts'
import type { Answer, Change, Claim } from './answer.ts'

type ClaimDraft = { text: string; label: string; quotes: Quote[]; topic?: string }

type DecisionFields = { question: string; chosen: string; rejected: { option: string; reason: string }[] }
export type DecisionDraft = DecisionFields & {
	reason: { text: string; quotes: Quote[] }
	undo: Undo
	needsOwner: boolean
	quotes: Quote[]
	topic?: string
}
// A decision whose quotes passed. The project record checks its words and sets its label when it stores it.
export type CheckedDecision = Omit<DecisionDraft, 'reason' | 'quotes'> & {
	reason: { text: string; quotes: VerifiedQuote[] }
	quotes: VerifiedQuote[]
}

export type AnswerDraft = {
	summary: string
	scope: { base: string; head: string } | null
	statements: ClaimDraft[]
	risks: ClaimDraft[] | null
	decisions: DecisionDraft[]
	diagrams: DiagramDraft[]
}

// The answer's topics are known only once the record holds them, so the answer tool adds them.
export type AnswerCheck =
	| { kind: 'accepted'; answer: Omit<Answer, 'topics'>; decisions: CheckedDecision[] }
	| { kind: 'rejected'; problems: string[] }

export async function checkAnswer(
	sources: QuoteSources,
	draft: AnswerDraft,
	signal: AbortSignal,
): Promise<AnswerCheck> {
	const { repo } = sources
	const scope = draft.scope && (await resolveScope(repo, draft.scope, signal))
	if (scope?.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${scope.problem}`] }
	const problems: string[] = []
	const verify = (where: string, quotes: Quote[]) => verifyQuotes(sources, where, quotes, problems, signal)

	const statements = await checkClaims(sources, 'Statement', draft.statements, problems, signal)
	const risks = draft.risks && (await checkClaims(sources, 'Risk', draft.risks, problems, signal))
	const decisions: CheckedDecision[] = []
	for (const [index, decision] of draft.decisions.entries()) {
		const where = `Decision ${index + 1}`
		const quotes = await verify(where, decision.quotes)
		const reasonQuotes = await verify(`${where}, its reason`, decision.reason.quotes)
		decisions.push({ ...decision, reason: { text: decision.reason.text, quotes: reasonQuotes }, quotes })
	}
	const checked = await checkDiagrams(repo, draft.diagrams, signal)
	if (checked.kind === 'refused') problems.push(...checked.problems)
	if (problems.length > 0 || checked.kind === 'refused') return { kind: 'rejected', problems }
	const { diagrams } = checked
	const answer = { summary: draft.summary, statements, risks, diagrams }
	if (scope === null) return { kind: 'accepted', answer: { ...answer, change: null }, decisions }

	// Every quote of git the reader sees counts, the decisions' too: a statement need not repeat a decision's lines to
	// cover them. A quote of a session covers no changed block and no commit message.
	const quotes = [
		...gitQuotes([...statements, ...(risks ?? [])].flatMap((claim) => claim.quotes)),
		...gitQuotes(decisions.flatMap((decision) => [...decision.quotes, ...decision.reason.quotes])),
		...diagrams.flatMap((diagram) => diagramElements(diagram).flatMap((element) => element.quotes)),
	]
	const change = await changeOf(repo, scope, quotes, signal)
	if (change.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${change.problem}`] }
	return { kind: 'accepted', answer: { ...answer, change: change.change }, decisions }
}

async function checkClaims(
	sources: QuoteSources,
	what: 'Statement' | 'Risk',
	drafts: ClaimDraft[],
	problems: string[],
	signal: AbortSignal,
): Promise<Claim[]> {
	const claims: Claim[] = []
	for (const [index, claim] of drafts.entries()) {
		const where = `${what} ${index + 1}`
		const label = checkLabel(claim.label, claim.quotes)
		if (label.kind === 'refused') problems.push(`${where}: ${label.problem}`)
		const quotes = await verifyQuotes(sources, where, claim.quotes, problems, signal)
		const topic = claim.topic === undefined ? {} : { topic: claim.topic }
		if (label.kind === 'ok') claims.push({ text: claim.text, label: label.label, quotes, ...topic })
	}
	return claims
}

async function verifyQuotes(
	sources: QuoteSources,
	where: string,
	raw: Quote[],
	problems: string[],
	signal: AbortSignal,
): Promise<VerifiedQuote[]> {
	const verdicts = await Promise.all(raw.map((quote) => verifyQuote(sources, quote, signal)))
	return verdicts.flatMap((verdict, at) => {
		if (verdict.kind === 'verified') return [verdict.quote]
		problems.push(`${where}, quote ${at + 1}: ${verdict.problem}`)
		return []
	})
}

type Scope = { kind: 'ok'; base: Change['base']; head: Change['head'] }

async function resolveScope(
	repo: Repository,
	scope: { base: string; head: string },
	signal: AbortSignal,
): Promise<Scope | { kind: 'refused'; problem: string }> {
	const resolved = await resolveRange(repo, scope, signal)
	if (resolved.kind !== 'ok') return { kind: 'refused', problem: scopeProblem(resolved) }
	return { kind: 'ok', ...resolved.range }
}

async function changeOf(
	repo: Repository,
	scope: Scope,
	quotes: VerifiedGitQuote[],
	signal: AbortSignal,
): Promise<{ kind: 'ok'; change: Change } | { kind: 'refused'; problem: string }> {
	const tooLarge = { kind: 'refused', problem: 'the change is too large to read. Ask about a shorter range.' } as const
	const logged = await repo.log(scope, signal)
	if (logged.kind === 'too-large') return tooLarge
	const coverage = await checkCoverage(repo, scope, quotes, signal)
	if (coverage.kind === 'too-large') return tooLarge
	if (coverage.kind !== 'ok') throw new Error(`a resolved scope failed the coverage check: ${coverage.kind}`)
	const { covered, uncovered, binary } = coverage
	const messages = countMessages(logged.commits, quotes)
	return {
		kind: 'ok',
		change: { base: scope.base, head: scope.head, commits: logged.commits, covered, uncovered, binary, messages },
	}
}
