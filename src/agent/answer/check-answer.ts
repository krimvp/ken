// The plan's rule for an answer: ken accepts it only when every quote passes checkQuote and every statement carries a
// label this slice allows. One bad quote rejects the whole answer. Only then does ken read the change facts from git.
import { checkCoverage, checkQuote, type Quote, type QuoteCheck } from '../../checks/index.ts'
import { type Repository, resolveRange } from '../../repo/index.ts'
import { scopeProblem } from '../tools/exploration-tools.ts'
import { type Answer, type Change, LABELS, type Label, type Statement } from './answer.ts'

export type AnswerDraft = {
	summary: string
	scope: { base: string; head: string } | null
	statements: { text: string; label: string; quotes: Quote[] }[]
}

export type AnswerCheck = { kind: 'accepted'; answer: Answer } | { kind: 'rejected'; problems: string[] }

export async function checkAnswer(repo: Repository, draft: AnswerDraft, signal: AbortSignal): Promise<AnswerCheck> {
	const scope = draft.scope && (await resolveScope(repo, draft.scope, signal))
	if (scope?.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${scope.problem}`] }
	const problems: string[] = []

	const statements: Statement[] = []
	for (const [index, statement] of draft.statements.entries()) {
		const where = `Statement ${index + 1}`
		const label = labelOf(statement.label)
		if (label.kind === 'refused') problems.push(`${where}: ${label.problem}`)
		const checks = await Promise.all(statement.quotes.map((quote) => checkQuote(repo, quote, signal)))
		const quotes = checks.flatMap((check, at) => {
			if (check.kind === 'verified') return [check.quote]
			const quote = statement.quotes[at]
			problems.push(
				`${where}, quote ${at + 1} (${quote?.path} at ${quote?.commit}): ${whyNot(check, quote?.text ?? '')}`,
			)
			return []
		})
		if (label.kind === 'ok') statements.push({ text: statement.text, label: label.label, quotes })
	}
	if (problems.length > 0) return { kind: 'rejected', problems }
	if (scope === null) return { kind: 'accepted', answer: { summary: draft.summary, statements, change: null } }

	const quotes = statements.flatMap((statement) => statement.quotes)
	const change = await changeOf(repo, scope, quotes, signal)
	if (change.kind === 'refused') return { kind: 'rejected', problems: [`Scope: ${change.problem}`] }
	return { kind: 'accepted', answer: { summary: draft.summary, statements, change: change.change } }
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
	quotes: Statement['quotes'],
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

function labelOf(raw: string): { kind: 'ok'; label: Label } | { kind: 'refused'; problem: string } {
	const wanted = raw.trim().toLowerCase().replaceAll(' ', '-')
	const label = LABELS.find((known) => known === wanted)
	if (label) return { kind: 'ok', label }
	if (wanted === 'recorded' || wanted === 'from-the-session') {
		return {
			kind: 'refused',
			problem: `the label "${raw}" is for a decision someone logged when they made it, and ken has no logged decisions yet. Use "inferred".`,
		}
	}
	return { kind: 'refused', problem: `"${raw}" is not a label. Use "inferred" or "found-by-search".` }
}

function whyNot(check: Exclude<QuoteCheck, { kind: 'verified' }>, text: string): string {
	switch (check.kind) {
		case 'not-found': {
			const numbered = /^\s*[+-]?\s*\d+\t/m.test(text) ? ' Leave out the line numbers and the + or - signs.' : ''
			if (check.closest.length === 0) {
				return `these lines are not in the file at that commit, and no line holds the first quoted line. Read the file again and copy the lines.${numbered}`
			}
			// As JSON strings, so the model sees the exact spaces and tabs that start each line, which models often miscount.
			const closest = check.closest.map((line) => `line ${line.line}: ${JSON.stringify(line.text)}`).join('\n  ')
			return `these lines are not in the file at that commit. Lines that hold the first quoted line, as JSON strings:\n  ${closest}\nEach quoted line must match the file line exactly, with the same spaces or tabs at its start.${numbered}`
		}
		case 'empty':
			return 'the quote holds no code.'
		case 'refused':
			return `${check.reason}.`
		case 'no-commit':
			return `there is no commit "${check.ref}".`
		case 'no-file':
			return 'there is no such file at that commit.'
		case 'too-large':
			return 'the file is too large to check.'
		default:
			return check satisfies never
	}
}
