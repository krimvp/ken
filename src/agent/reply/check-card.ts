// The plan's rule for one card: ken shows it only when every quote passes verifyQuote, its label is one its quotes
// allow, the text it says is missing is not there, and a diagram passes checkDiagram. A card that fails is refused
// alone; the reply and the other cards stand. A risk of a change also gets ken's marks from git.
import {
	type Absence,
	type ChangedHunk,
	checkAbsent,
	checkCoverage,
	checkLabel,
	countMessages,
	decisionLabel,
	followedNames,
	gitQuotes,
	type Quote,
	type QuoteSources,
	quotedHunks,
	quotesOutsideChange,
	usedElsewhere,
	type VerifiedGitQuote,
	type VerifiedQuote,
	verifyQuote,
} from '../../checks/index.ts'
import { checkDiagram, checkLayout, type DiagramDraft, diagramElements, type LayoutDraft } from '../../diagram/index.ts'
import { RECORD_LIMITS, textProblem, type Undo } from '../../record/index.ts'
import type { CommitHash, Range, Repository } from '../../repo/index.ts'
import { BRIEF_BOUNDS, type Point, wordCount } from '../brief/brief.ts'
import type { Card, Change, Item, Weight } from './reply.ts'

// absent is the text the card says is missing, and the path prefix to search under. point is there on a thing to know
// of a brief.
type Sought = { text: string; under: string | null }
export type ClaimDraft = {
	text: string
	label: string
	quotes: Quote[]
	topic?: string
	weight?: Weight
	absent?: Sought
	point?: Point
}
export type DecisionDraft = {
	question: string
	chosen: string
	rejected: { option: string; reason: string }[]
	reason: { text: string; quotes: Quote[] }
	undo: Undo
	needsOwner: boolean
	quotes: Quote[]
	topic?: string
	absent?: Sought
}
export type TopicDraft = { name: string; quotes: Quote[]; note: string; replaces: string | null }

export type CardDraft =
	| { kind: 'claim' | 'risk'; draft: ClaimDraft }
	| { kind: 'decision'; draft: DecisionDraft }
	| { kind: 'diagram'; draft: DiagramDraft }
	| { kind: 'layout'; draft: LayoutDraft }
	| { kind: 'topic'; draft: TopicDraft }

// What a card is checked against. change is the range the reply is about, or null. hunks are all the hunks it changed,
// read once per question, for the marks on a risk.
export type CardContext = {
	sources: QuoteSources
	change: { range: Range; hunks: () => Promise<ChangedHunk[]> } | null
}

export type CardCheck = { kind: 'ok'; card: Card } | { kind: 'refused'; problems: string[] }

export async function checkCard(
	context: CardContext,
	card: CardDraft,
	where: string,
	signal: AbortSignal,
): Promise<CardCheck> {
	const { kind, draft } = card
	const { sources, change } = context
	const problems: string[] = []
	const verify = (field: string, quotes: Quote[]) => verifyQuotes(sources, field, quotes, problems, signal)
	const search = async (sought: Sought | undefined) => {
		if (sought === undefined) return {}
		const at = change ? change.range.head : await headOf(sources.repo, signal)
		return await searchAbsent(sources.repo, at, where, sought, problems, signal)
	}
	const refused = () => ({ kind: 'refused', problems }) as const
	for (const problem of limitProblems(card)) problems.push(`${where}: ${problem}`)
	switch (kind) {
		case 'claim':
		case 'risk': {
			const label = checkLabel(draft.label, draft.quotes)
			if (label.kind === 'refused') problems.push(`${where}: ${label.problem}`)
			const quotes = await verify(where, draft.quotes)
			const absent = await search(draft.absent)
			if (problems.length > 0 || label.kind === 'refused') return refused()
			const point = draft.point === undefined ? {} : { point: draft.point }
			const claim = { text: draft.text, label: label.label, quotes, ...topicOf(draft.topic), ...absent, ...point }
			if (kind === 'claim') return { kind: 'ok', card: { kind: 'claim', claim } }
			const weight = draft.weight === undefined ? {} : { weight: draft.weight }
			const marks = change ? await riskMarks(sources.repo, change, quotes, signal) : {}
			return { kind: 'ok', card: { kind: 'risk', risk: { ...claim, ...weight, ...marks } } }
		}
		case 'decision': {
			const quotes = await verify(where, draft.quotes)
			const reasonQuotes = await verify(`${where}, its reason`, draft.reason.quotes)
			const absent = await search(draft.absent)
			if (problems.length > 0) return refused()
			const decision = {
				kind: 'decision',
				question: draft.question,
				chosen: draft.chosen,
				reason: { text: draft.reason.text, quotes: reasonQuotes },
				rejected: draft.rejected,
				undo: draft.undo,
				needsOwner: draft.needsOwner,
				label: decisionLabel(reasonQuotes, false),
				quotes,
				work: null,
				topic: draft.topic ?? null,
				answer: null,
				...absent,
			} as const
			return { kind: 'ok', card: { kind: 'decision', decision } }
		}
		case 'diagram': {
			const checked = await checkDiagram(sources.repo, draft, where, signal)
			if (checked.kind === 'refused') return checked
			return { kind: 'ok', card: { kind: 'diagram', diagram: checked.diagram } }
		}
		case 'layout': {
			const checked = await checkLayout(sources.repo, draft, { where, needsAbout: true }, signal)
			if (checked.kind === 'refused') return checked
			return { kind: 'ok', card: { kind: 'layout', layout: checked.layout } }
		}
		case 'topic': {
			if (draft.quotes.some((quote) => 'session' in quote || quote.path === null)) {
				problems.push(`${where}: a topic rests on lines of files. Give each quote its path and commit.`)
			}
			const quotes = gitQuotes(await verify(where, draft.quotes))
			if (problems.length > 0) return refused()
			return {
				kind: 'ok',
				card: { kind: 'topic', topic: { name: draft.name, note: draft.note, quotes, replaces: draft.replaces } },
			}
		}
		default:
			return kind satisfies never
	}
}

// The record's limits on texts and quotes, so a card the reader sees is one the record can keep.
function limitProblems(card: CardDraft): string[] {
	const { text, reason, name, note, option, quotes, list } = RECORD_LIMITS
	const texts: [string, string, number][] = []
	const counts: [string, number][] = []
	const problems: string[] = []
	switch (card.kind) {
		case 'claim':
		case 'risk': {
			const { point } = card.draft
			texts.push([point ? 'more' : 'the text', card.draft.text, text])
			counts.push(['', card.draft.quotes.length])
			if (point) {
				texts.push(['its line', point.line, text], ['long', point.long, BRIEF_BOUNDS.long])
				const words = wordCount(point.line)
				if (words > BRIEF_BOUNDS.lineWords) {
					problems.push(`its line has ${words} words; keep it to ${BRIEF_BOUNDS.lineWords}, and say the rest in more.`)
				}
			}
			break
		}
		case 'decision': {
			const { draft } = card
			texts.push(['the question', draft.question, option], ['chosen', draft.chosen, text])
			texts.push(['the reason', draft.reason.text, reason])
			for (const [at, rejected] of draft.rejected.entries()) {
				texts.push([`rejected option ${at + 1}`, rejected.option, option])
				texts.push([`the reason for rejected option ${at + 1}`, rejected.reason, text])
			}
			counts.push(['', draft.quotes.length], [' for its reason', draft.reason.quotes.length])
			if (draft.rejected.length > list) problems.push(`keep the rejected options to ${list}.`)
			break
		}
		case 'topic':
			texts.push(['the name', card.draft.name, name], ['the note', card.draft.note, note])
			counts.push(['', card.draft.quotes.length])
			break
		case 'diagram':
		case 'layout':
			break
		default:
			return card satisfies never
	}
	problems.push(...texts.flatMap(([field, value, max]) => textProblem(field, value, max) ?? []))
	for (const [what, count] of counts) {
		if (count > quotes) problems.push(`it has ${count} quotes${what}; keep it to ${quotes}.`)
	}
	return problems
}

// Every git quote a card shows, a decision's reasons and a diagram's arrows included.
export function quotesOf(items: Item[]): VerifiedGitQuote[] {
	return items.flatMap((item) => {
		if (item.kind !== 'card') return []
		const { card } = item
		switch (card.kind) {
			case 'claim':
				return gitQuotes(card.claim.quotes)
			case 'risk':
				return gitQuotes(card.risk.quotes)
			case 'decision':
				return gitQuotes([...card.decision.quotes, ...(card.decision.reason?.quotes ?? [])])
			case 'diagram':
				return diagramElements(card.diagram).flatMap((element) => element.quotes)
			case 'layout':
				return card.layout.arrows.flatMap((arrow) => arrow.quotes)
			case 'topic':
				return card.topic.quotes
			case 'withdrawn':
				return gitQuotes(card.withdrawn.proof)
			default:
				return card satisfies never
		}
	})
}

// checked: a file quote at the head commit lies wholly outside the change. fixedIn: a later commit whose message the
// risk quotes, so the project fixed it since. git decides both, not the model.
async function riskMarks(
	repo: Repository,
	change: NonNullable<CardContext['change']>,
	quotes: VerifiedQuote[],
	signal: AbortSignal,
): Promise<{ checked?: boolean; fixedIn?: CommitHash }> {
	const { head } = change.range
	const checked = quotesOutsideChange(quotes, head, await change.hunks())
	let fixedIn: CommitHash | null = null
	for (const quote of quotes) {
		if ('session' in quote || quote.path !== null) continue
		if (await isLater(repo, head, quote.commit, signal)) {
			fixedIn = quote.commit
			break
		}
	}
	return { ...(checked === undefined ? {} : { checked }), ...(fixedIn ? { fixedIn } : {}) }
}

// A commit is later than the change when the project's HEAD reaches it and the change's head does not, the same commits
// the second look lists. A fix that branched from inside the change and was merged after it counts.
export async function isLater(repo: Repository, head: CommitHash, commit: CommitHash, signal: AbortSignal) {
	const now = await repo.resolve('HEAD', signal)
	if (now.kind !== 'ok') return false
	const reaches = async (from: CommitHash) => {
		const base = await repo.mergeBase(commit, from, signal)
		return base.kind === 'ok' && base.commit === commit
	}
	return (await reaches(now.commit)) && !(await reaches(head))
}

// Every hunk the range changed, as the coverage check lists them.
export async function changedHunks(repo: Repository, range: Range, signal: AbortSignal): Promise<ChangedHunk[]> {
	const coverage = await checkCoverage(repo, range, [], signal)
	return coverage.kind === 'ok' ? coverage.uncovered : []
}

// The change facts of a reply: its commits, the hunks its quotes cover, the hunks each walkthrough step's quotes
// overlap, the commit messages they cite and the names used elsewhere they follow. null when the change is too large
// to read.
export async function changeOf(
	repo: Repository,
	range: Range,
	items: Item[],
	signal: AbortSignal,
): Promise<Change | null> {
	const quotes = quotesOf(items)
	const logged = await repo.log(range, signal)
	if (logged.kind === 'too-large') return null
	const coverage = await checkCoverage(repo, range, quotes, signal)
	if (coverage.kind !== 'ok') return null
	const { covered, uncovered, binary } = coverage
	const messages = countMessages(logged.commits, quotes)
	const used = await usedElsewhere(repo, range, signal)
	const followed = used.kind === 'ok' ? await followedNames(repo, used.used, quotes, signal) : null
	const stepHunks = items.flatMap((item) => {
		if (item.kind !== 'step') return []
		const proof = items.filter((each) => each.kind === 'card' && each.step === item.number)
		return [{ step: item.number, hunks: quotedHunks(covered, range, quotesOf(proof)) }]
	})
	return { ...range, commits: logged.commits, covered, uncovered, binary, messages, usedElsewhere: followed, stepHunks }
}

function topicOf(topic: string | undefined): { topic?: string } {
	return topic === undefined ? {} : { topic }
}

async function headOf(repo: Repository, signal: AbortSignal): Promise<CommitHash | null> {
	const resolved = await repo.resolve('HEAD', signal)
	return resolved.kind === 'ok' ? resolved.commit : null
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
