// The plan's rule for an answer: ken accepts it only when every quote passes verifyQuote, every statement and every risk
// carries a label its quotes allow, and every diagram passes checkDiagrams. One bad quote rejects the whole answer.
// Only then does ken read the change facts from git.
import {
	type Absence,
	checkAbsent,
	checkCoverage,
	checkLabel,
	countMessages,
	followedNames,
	gitQuotes,
	type Quote,
	type QuoteSources,
	quotesOutsideChange,
	usedElsewhere,
	type VerifiedGitQuote,
	type VerifiedQuote,
	verifyQuote,
} from '../../checks/index.ts'
import { checkDiagrams, type DiagramDraft, diagramElements } from '../../diagram/index.ts'
import type { Undo } from '../../record/index.ts'
import { type CommitHash, type Repository, resolveRange } from '../../repo/index.ts'
import { scopeProblem } from '../tools/exploration-tools.ts'
import type { Answer, Change, Risk, Weight } from './answer.ts'

// Only a risk has a weight. absent is the text the entry says is missing, and the path prefix to search under.
type Sought = { text: string; under: string | null }
type ClaimDraft = { text: string; label: string; quotes: Quote[]; topic?: string; weight?: Weight; absent?: Sought }

type DecisionFields = { question: string; chosen: string; rejected: { option: string; reason: string }[] }
export type DecisionDraft = DecisionFields & {
	reason: { text: string; quotes: Quote[] }
	undo: Undo
	needsOwner: boolean
	quotes: Quote[]
	topic?: string
	absent?: Sought
}
// A decision whose quotes passed. The project record checks its words and sets its label when it stores it.
export type CheckedDecision = Omit<DecisionDraft, 'reason' | 'quotes' | 'absent'> & {
	reason: { text: string; quotes: VerifiedQuote[] }
	quotes: VerifiedQuote[]
	absent?: Absence
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

// searchAt is the commit an absence is searched at when the draft has no scope: the risk pass checks its additions on
// their own, at the change's head. Without either, HEAD.
export async function checkAnswer(
	sources: QuoteSources,
	draft: AnswerDraft,
	signal: AbortSignal,
	searchAt: CommitHash | null = null,
): Promise<AnswerCheck> {
	const { repo } = sources
	const scope = draft.scope && (await resolveScope(repo, draft.scope, signal))
	if (scope?.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${scope.problem}`] }
	const problems: string[] = []
	const verify = (where: string, quotes: Quote[]) => verifyQuotes(sources, where, quotes, problems, signal)
	// Read once, and only when an entry needs a search.
	let at: Promise<CommitHash | null> | undefined
	const commit = async () => {
		const resolved = await repo.resolve('HEAD', signal)
		return resolved.kind === 'ok' ? resolved.commit : null
	}
	const search = async (where: string, sought: Sought | undefined) => {
		if (sought === undefined) return {}
		at ??= scope?.head ? Promise.resolve(scope.head) : searchAt ? Promise.resolve(searchAt) : commit()
		return await searchAbsent(repo, await at, where, sought, problems, signal)
	}

	const statements = await checkClaims(sources, 'Statement', draft.statements, problems, search, signal)
	const risks = draft.risks && (await checkClaims(sources, 'Risk', draft.risks, problems, search, signal))
	const decisions: CheckedDecision[] = []
	for (const [index, decision] of draft.decisions.entries()) {
		const where = `Decision ${index + 1}`
		const quotes = await verify(where, decision.quotes)
		const reasonQuotes = await verify(`${where}, its reason`, decision.reason.quotes)
		const { absent: sought, ...rest } = decision
		const absent = await search(where, sought)
		decisions.push({ ...rest, reason: { text: decision.reason.text, quotes: reasonQuotes }, quotes, ...absent })
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
	const { head, covered, uncovered } = change.change
	const marked =
		risks &&
		(await Promise.all(
			risks.map(async (risk) => {
				const checked = quotesOutsideChange(risk.quotes, head, [...covered, ...uncovered])
				const fixedIn = await fixedSince(repo, head, risk.quotes, signal)
				return { ...risk, ...(checked === undefined ? {} : { checked }), ...(fixedIn ? { fixedIn } : {}) }
			}),
		))
	return { kind: 'accepted', answer: { ...answer, risks: marked ?? null, change: change.change }, decisions }
}

// The first commit made after the change's head whose message a quote of the risk cites: a later commit that says what
// the change left open. git decides, not the model.
async function fixedSince(
	repo: Repository,
	head: CommitHash,
	quotes: VerifiedQuote[],
	signal: AbortSignal,
): Promise<CommitHash | null> {
	for (const quote of quotes) {
		if (!('session' in quote) && quote.path === null && (await isLater(repo, head, quote.commit, signal))) {
			return quote.commit
		}
	}
	return null
}

export async function isLater(repo: Repository, head: CommitHash, commit: CommitHash, signal: AbortSignal) {
	if (commit === head) return false
	const base = await repo.mergeBase(head, commit, signal)
	return base.kind === 'ok' && base.commit === head
}

type Search = (where: string, sought: Sought | undefined) => Promise<{ absent?: Absence }>

async function checkClaims(
	sources: QuoteSources,
	what: 'Statement' | 'Risk',
	drafts: ClaimDraft[],
	problems: string[],
	search: Search,
	signal: AbortSignal,
): Promise<Risk[]> {
	const claims: Risk[] = []
	for (const [index, claim] of drafts.entries()) {
		const where = `${what} ${index + 1}`
		const label = checkLabel(claim.label, claim.quotes)
		if (label.kind === 'refused') problems.push(`${where}: ${label.problem}`)
		const quotes = await verifyQuotes(sources, where, claim.quotes, problems, signal)
		const absent = await search(where, claim.absent)
		const topic = claim.topic === undefined ? {} : { topic: claim.topic }
		const weight = claim.weight === undefined ? {} : { weight: claim.weight }
		if (label.kind === 'ok') {
			claims.push({ text: claim.text, label: label.label, quotes, ...topic, ...weight, ...absent })
		}
	}
	return claims
}

async function searchAbsent(
	repo: Repository,
	at: CommitHash | null,
	where: string,
	sought: Sought,
	problems: string[],
	signal: AbortSignal,
): Promise<{ absent?: Absence }> {
	if (at === null) {
		problems.push(`${where}: the repository has no commit to search for "${sought.text}".`)
		return {}
	}
	const checked = await checkAbsent(repo, at, sought, signal)
	if (checked.kind === 'absent') return { absent: checked.absence }
	problems.push(`${where}: ${checked.problem}`)
	return {}
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
	const used = await usedElsewhere(repo, scope, signal)
	const followed = used.kind === 'ok' ? await followedNames(repo, used.used, quotes, signal) : null
	const { base, head } = scope
	const facts = { base, head, commits: logged.commits, covered, uncovered, binary, messages }
	return { kind: 'ok', change: { ...facts, usedElsewhere: followed } }
}
