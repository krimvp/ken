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

// tour is there only on a tour of the project's parts.
export type Reply = {
	items: Item[]
	change: Change | null
	// Every topic a card names, and on a tour the topic of each stop. The reader's map buttons act on these.
	topics: string[]
	tour?: Tour
}

// A tour of one named level of the project's parts. Plain code picked the stops and their order, and step n of the
// reply is stop n, in the model's words. Each stop's part is a topic in the record, so the reader's map can say which
// stops the reader reached. within is the level's scope, empty for the whole project.
export type Tour = { within: string[]; stops: TourStop[] }
export type TourStop = { name: string; job: string; paths: string[] }

// A step of a walkthrough: the model explains a change as a few numbered steps, in the order a reviewer should read
// them, each in a sentence or two of its own words. A card that proves a step carries the step's number. Plain code
// links each step to the change's hunks (Change.stepHunks) and the page links it to the parts its quotes fall in.
export type Item =
	| { kind: 'words'; text: string }
	| { kind: 'card'; card: Card; step?: number }
	| { kind: 'step'; number: number; text: string }

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
// for the text a claim says is missing, which found nothing; only a claim that says so has it.
export type Claim = Statement & { topic?: string; absent?: Absence }

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
