// The plan's rule for an answer: ken accepts it only when every quote passes checkQuote, every statement and every risk
// carries a label this slice allows, and every diagram passes checkDiagrams. One bad quote rejects the whole answer.
// Only then does ken read the change facts from git.
import {
	checkCoverage,
	checkLabel,
	checkQuote,
	explainQuote,
	type Quote,
	type VerifiedQuote,
} from '../../checks/index.ts'
import { checkDiagrams, type DiagramDraft, diagramElements } from '../../diagram/index.ts'
import type { Statement, Undo } from '../../record/index.ts'
import { type Repository, resolveRange } from '../../repo/index.ts'
import { scopeProblem } from '../tools/exploration-tools.ts'
import type { Answer, Change } from './answer.ts'

type ClaimDraft = { text: string; label: string; quotes: Quote[] }

type DecisionFields = { question: string; chosen: string; rejected: { option: string; reason: string }[] }
export type DecisionDraft = DecisionFields & {
	reason: { text: string; quotes: Quote[] }
	undo: Undo
	needsOwner: boolean
	quotes: Quote[]
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

export type AnswerCheck =
	| { kind: 'accepted'; answer: Answer; decisions: CheckedDecision[] }
	| { kind: 'rejected'; problems: string[] }

export async function checkAnswer(repo: Repository, draft: AnswerDraft, signal: AbortSignal): Promise<AnswerCheck> {
	const scope = draft.scope && (await resolveScope(repo, draft.scope, signal))
	if (scope?.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${scope.problem}`] }
	const problems: string[] = []
	const verify = (where: string, quotes: Quote[]) => verifyQuotes(repo, where, quotes, problems, signal)

	const statements = await checkClaims(repo, 'Statement', draft.statements, problems, signal)
	const risks = draft.risks && (await checkClaims(repo, 'Risk', draft.risks, problems, signal))
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

	const quotes = [
		...[...statements, ...(risks ?? [])].flatMap((claim) => claim.quotes),
		...diagrams.flatMap((diagram) => diagramElements(diagram).flatMap((element) => element.quotes)),
	]
	const change = await changeOf(repo, scope, quotes, signal)
	if (change.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${change.problem}`] }
	return { kind: 'accepted', answer: { ...answer, change: change.change }, decisions }
}

async function checkClaims(
	repo: Repository,
	what: 'Statement' | 'Risk',
	drafts: ClaimDraft[],
	problems: string[],
	signal: AbortSignal,
): Promise<Statement[]> {
	const claims: Statement[] = []
	for (const [index, claim] of drafts.entries()) {
		const where = `${what} ${index + 1}`
		const label = checkLabel(claim.label)
		if (label.kind === 'refused') problems.push(`${where}: ${label.problem}`)
		const quotes = await verifyQuotes(repo, where, claim.quotes, problems, signal)
		if (label.kind === 'ok') claims.push({ text: claim.text, label: label.label, quotes })
	}
	return claims
}

async function verifyQuotes(
	repo: Repository,
	where: string,
	raw: Quote[],
	problems: string[],
	signal: AbortSignal,
): Promise<VerifiedQuote[]> {
	const checks = await Promise.all(raw.map((quote) => checkQuote(repo, quote, signal)))
	return checks.flatMap((check, at) => {
		if (check.kind === 'verified') return [check.quote]
		problems.push(`${where}, quote ${at + 1}: ${explainQuote(check, raw[at])}`)
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
	quotes: VerifiedQuote[],
	signal: AbortSignal,
): Promise<{ kind: 'ok'; change: Change } | { kind: 'refused'; problem: string }> {
	const tooLarge = { kind: 'refused', problem: 'the change is too large to read. Ask about a shorter range.' } as const
	const logged = await repo.log(scope, signal)
	if (logged.kind === 'too-large') return tooLarge
	const coverage = await checkCoverage(repo, scope, quotes, signal)
	if (coverage.kind === 'too-large') return tooLarge
	if (coverage.kind !== 'ok') throw new Error(`a resolved scope failed the coverage check: ${coverage.kind}`)
	const { covered, uncovered, binary } = coverage
	return {
		kind: 'ok',
		change: { base: scope.base, head: scope.head, commits: logged.commits, covered, uncovered, binary },
	}
}
