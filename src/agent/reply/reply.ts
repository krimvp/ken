// What ken tells its reader: the model's own words and the cards it sent with show, in the order the reader reads
// them. Words are never checked and carry no label. A card exists only after its own check passed: every quote it
// holds passed checkQuote, and a diagram's every arrow too. A reply about a change also carries the change facts,
// which ken reads from git and the model never supplies.
import type {
	Absence,
	ChangedHunk,
	Followed,
	MessageCount,
	VerifiedGitQuote,
	VerifiedQuote,
} from '../../checks/index.ts'
import type { Diagram, Layout } from '../../diagram/index.ts'
import type { Decision, Statement } from '../../record/index.ts'
import type { Commit, CommitHash } from '../../repo/index.ts'
import type { Point } from '../brief/brief.ts'

// tour is there only when the reply explains parts of a level as briefs, and view only when the reader asked to see a
// level another way: within is that level and asked their own words. want is there only when the reader asked for the
// story of a change or a walk through it, so the page can tell that reply from a later one about the same commits.
// answers is there only when the reply answers a question about one concept as a brief: the concept's id and the
// question as asked. Plain code sets all four, never the model.
export type Reply = {
	items: Item[]
	change: Change | null
	// Every topic a card names, and on a tour the topic of each stop. The reader's map buttons act on these.
	topics: string[]
	tour?: Tour
	missingParts?: string[]
	view?: { within: string[]; asked: string }
	want?: Want
	answers?: { concept: string; text: string }
}

// What the reader wants of a change: its story, or a walk through it in steps.
export const WANTS = ['story', 'walk'] as const
export type Want = (typeof WANTS)[number]

// The parts of one level that a reply explains: every part of the level, or one. Plain code picked the stops and their
// order, and step n of the reply is the brief of stop n, in the model's words. Each stop's part is a topic in the
// record, so the reader's map can say which the reader reached. within is the level's scope, empty for the whole
// project. A reply saved while ken still gave tours has the same shape, with a paragraph for each step.
export type Tour = { within: string[]; stops: TourStop[] }
export type TourStop = { name: string; job: string; paths: string[] }

// A step of a walkthrough: the model explains a change as a few numbered steps, in the order a reviewer should read
// them, each in a sentence or two of its own words. A card that proves a step carries the step's number. Plain code
// links each step to the change's hunks (Change.stepHunks) and the page links it to the parts its quotes fall in.
// A brief is a step too: its text is the brief's one line, questions are the few worth asking next, and the cards that
// carry its number are its things to know (claims with a point) and its terms (topics).
export type Item =
	| { kind: 'words'; text: string }
	| { kind: 'card'; card: Card; step?: number }
	| { kind: 'step'; number: number; text: string; questions?: string[] }

// A brief needs a numbered step and a checked point. Older tours kept a checked claim with the step instead.
export function checkedBriefs(items: Item[]): Set<number> {
	const numbers = new Set<number>()
	for (const item of items) {
		if (item.kind !== 'card' || item.card.kind !== 'claim' || item.step === undefined) continue
		const heading = items.find((other) => other.kind === 'step' && other.number === item.step)
		if (heading?.kind === 'step' && (item.card.claim.point || !heading.questions)) numbers.add(item.step)
	}
	return numbers
}

export function briefCoverage(items: Item[], wanted: string[]) {
	const numbers = checkedBriefs(items)
	const missing = wanted.filter((_, at) => !numbers.has(at + 1))
	const outcome = missing.length === 0 ? 'answered' : missing.length === wanted.length ? 'incomplete' : 'partial'
	return { outcome, missing } as const
}

// Every kind of card, listed once. The page has a renderer for each, and a test holds it to this list.
export const CARD_KINDS = ['claim', 'risk', 'decision', 'diagram', 'layout', 'topic', 'withdrawn'] as const
export type CardKind = (typeof CARD_KINDS)[number]

// A topic card names a part of the project, with the lines it rests on and the model's note. The reply adds it to the
// record when it ends, unless the record refuses it or the reply quotes uncommitted work. replaces is the id of the
// record's topic it updates, or null.
// A layout card is a level of the project's parts, which the reply adds to the record when it ends, as it does a topic.
// A withdrawn card is a risk the second look took out, with the lines that rule it out.
export type Card =
	| { kind: 'claim'; claim: Claim }
	| { kind: 'risk'; risk: Risk }
	| { kind: 'decision'; decision: Decision }
	| { kind: 'diagram'; diagram: Diagram }
	| { kind: 'layout'; layout: Layout }
	| { kind: 'topic'; topic: { name: string; note: string; quotes: VerifiedGitQuote[]; replaces: string | null } }
	| { kind: 'withdrawn'; withdrawn: Withdrawn }

// The compiler holds CARD_KINDS and Card to the same kinds.
const sameKinds: [CardKind, Card['kind']] extends [Card['kind'], CardKind] ? true : never = true
void sameKinds

export type Change = {
	base: CommitHash
	head: CommitHash
	commits: Commit[]
	covered: ChangedHunk[]
	uncovered: ChangedHunk[]
	binary: string[]
	// The commits whose message a quote in the reply cites, and the others. null in a change saved before ken counted.
	messages: MessageCount | null
	// The names the change touched that ken found used elsewhere by search, split by whether a quote of the reply holds
	// one of their places. null in a change saved before ken looked, or too large to search.
	usedElsewhere: Followed | null
	// Each walkthrough step's number with the hunks its cards' quotes overlap. Empty for a reply with no steps, and
	// missing in a change saved before ken had steps.
	stepHunks: { step: number; hunks: ChangedHunk[] }[]
}

// A claim about the code. topic names the topic it belongs to, as the project record names it. absent is ken's search
// for the text a claim says is missing, which found nothing; only a claim that says so has it. point is there on a thing
// to know of a brief: the same claim in a short line and in a longer telling, and its drawing.
export type Claim = Statement & { topic?: string; absent?: Absence; point?: Point }

// checked is ken's own mark on a risk of a change, set from git: true when a quote lies wholly outside the change.
// fixedIn is the later commit, after the change's head, whose message the risk quotes: the project fixed it since.
// weight is the model's own (see WEIGHT_RULE). ken does not judge it. unreviewed is set on a risk the second look held
// and never settled: it errored, ran out of attempts or turns, or did not run.
export const WEIGHTS = ['serious', 'minor'] as const
export type Weight = (typeof WEIGHTS)[number]
export type Risk = Claim & { checked?: boolean; weight?: Weight; fixedIn?: CommitHash; unreviewed?: true }

// A judge found that two risks withdrawn on a sentence alone were the two the project later had to fix, so a
// withdrawal carries the lines that make the risk false, checked as every quote is.
export type Withdrawn = { risk: Risk; reason: string; proof: VerifiedQuote[] }

// The reply's words from the start, cut at the end of the last whole sentence that fits in most characters, for a
// short line such as a piece of work's summary or a live note in a list.
export function firstWords(items: Item[], most: number): string {
	const text = items
		.flatMap((item) => (item.kind === 'words' ? [item.text.trim()] : []))
		.join(' ')
		.replaceAll(/\s+/g, ' ')
	if (text.length <= most) return text
	const cut = text.slice(0, most)
	const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
	return end > 0 ? cut.slice(0, end + 1) : `${cut.slice(0, most - 3).trimEnd()}...`
}
