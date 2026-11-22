// The questions slice 6 writes for the agent, each a line the reader asks and ken's list under it, as the lenses of
// slice 4 do: the list speaks to the reader, and LIST_SAID tells the model who "you" is. The page and the terminal
// show the list before the agent explains it. empty says the list holds nothing to explain, so ken does not ask the
// agent at all.
import { LIST_SAID, linesText, type TopicState } from '../map/index.ts'
import type { RecordRead, Who } from '../record/index.ts'
import type { Repository } from '../repo/index.ts'
import type { ChangeCommit, OpenItems, OpenTopic } from './open-items.ts'
import { authorsOf, findAuthor, type PersonChanges, personChanges } from './person.ts'
import { type Since, sinceOf, type TimeRange, timeRange } from './time-range.ts'
import { at, onDay } from './when.ts'

export type LensQuestion = { text: string; empty: boolean }

// What a lens reads besides git: the record, the reader's map now, and the reader's last question, if any.
export type LensFacts = {
	record: RecordRead
	states: TopicState[]
	lastQuestion: { askedAt: string; head: string | null } | undefined
}

type Written = { kind: 'ok'; question: LensQuestion } | { kind: 'refused'; problem: string }

// since is what the reader typed or picked: "14d", "2026-11-01" or "question".
export async function personLens(
	repo: Repository,
	facts: LensFacts,
	asked: { author: string; since: string },
	now: Date,
	signal?: AbortSignal,
): Promise<Written> {
	const since = sinceOf(asked.since, facts.lastQuestion)
	if (since.kind !== 'ok') return since
	const range = await timeRange(repo, since.since, now, signal)
	if (range.kind !== 'ok') return range
	const userEmail = await repo.userEmail(signal)
	const author = findAuthor(authorsOf(range.range.commits, userEmail), asked.author)
	if (author.kind !== 'ok') return author
	const changes = personChanges(range.range, author.author, { ...facts, userEmail })
	return { kind: 'ok', question: personQuestion(changes) }
}

export async function rangeLens(
	repo: Repository,
	facts: LensFacts,
	asked: string,
	now: Date,
	signal?: AbortSignal,
): Promise<Written> {
	const since = sinceOf(asked, facts.lastQuestion)
	if (since.kind !== 'ok') return since
	const range = await timeRange(repo, since.since, now, signal)
	if (range.kind !== 'ok') return range
	return { kind: 'ok', question: rangeQuestion(range.range, facts.record, await repo.userEmail(signal)) }
}

const MAX_LISTED = 20

const WHO: Record<Who, string> = {
	owner: 'you',
	'owner-agent': 'your coding agent',
	collaborator: 'a collaborator',
	unknown: 'git cannot tell who',
}

export function openQuestion(open: OpenItems): LensQuestion {
	const decisions = open.decisions.map(
		(d) =>
			`- A decision needs your call: ${d.question} What was chosen: "${d.chosen}" It is decision ${d.id} in the record.`,
	)
	const topics = open.topics.map(
		({ state, commits }) =>
			`- ${state.topic} changed since you understood it ${onDay(state.entry.date)}: ${state.changed.map(linesText).join(', ')}. ${commitsSaid(commits)}`,
	)
	const list = [...decisions, ...topics]
	if (list.length === 0) {
		const none = '- Nothing is open: no decision waits on you, and no topic you understood has changed since.'
		return { text: ['What is open for me in this project?', LIST_SAID, none].join('\n'), empty: true }
	}
	return { text: ['What is open for me in this project?', LIST_SAID, ...list].join('\n'), empty: false }
}

// "Explain what changed" on one topic of the open list.
export function topicQuestion({ state, commits }: OpenTopic): LensQuestion {
	return {
		text: [
			`What changed in ${state.topic} since I understood it ${onDay(state.entry.date)}?`,
			LIST_SAID,
			`- Its code changed since: ${state.changed.map(linesText).join(', ')}.`,
			...(commits.length === 0 ? ['- ken found no commit to its files since then.'] : commits.map(commitLine)),
		].join('\n'),
		empty: false,
	}
}

export function personQuestion({ author, range, commits, topics }: PersonChanges): LensQuestion {
	const when = sinceWords(range.since)
	const who = author.by.map((by) => WHO[by]).join(' or ')
	const made =
		commits.length === 0
			? [`- ${author.name} made no commit ${when}.`]
			: [
					`- ${author.name} <${author.email}> (${who}) made ${count(commits.length)} from ${short(range.base)} to ${short(range.head)}:`,
					...commits.slice(0, MAX_LISTED).map((c) => `- ${short(c.hash)} ${at(c.date)}: ${c.subject}`),
					...(commits.length > MAX_LISTED ? [`- and ${commits.length - MAX_LISTED} older ones`] : []),
					...(range.fromFirst ? [fromFirst(range)] : []),
				]
	const known = topics.map(
		({ state, commits: touched }) =>
			`- You understood ${state.topic} ${onDay(state.entry.date)}. ${author.name}'s ${touched.map(short).join(', ')} touched its files, and ${state.kind === 'unchanged' || state.changed.length === 0 ? 'its quoted lines are as you knew them' : `its code changed since: ${state.changed.map(linesText).join(', ')}`}.`,
	)
	return {
		text: [
			`What did ${author.name} change in the topics I know, ${when}?`,
			LIST_SAID,
			...made,
			...(known.length > 0 ? known : commits.length > 0 ? ['- None of their commits touched a topic you know.'] : []),
		].join('\n'),
		empty: known.length === 0,
	}
}

// The lens "a time range". The agent reads the record's pieces of work first, as its prompt says.
export function rangeQuestion(range: TimeRange, record: RecordRead, userEmail: string | null): LensQuestion {
	const when = sinceWords(range.since)
	if (range.commits.length === 0) {
		return { text: [`What happened ${when}?`, LIST_SAID, `- No commit landed ${when}.`].join('\n'), empty: true }
	}
	const authors = authorsOf(range.commits, userEmail)
	const inRange = new Set<string>(range.commits.map((commit) => commit.hash))
	const work = record.current.flatMap((entry) =>
		entry.kind === 'work' && entry.commits.some((commit) => inRange.has(commit.hash)) ? [entry] : [],
	)
	return {
		text: [
			`What happened ${when}, from ${short(range.base)} to ${short(range.head)}?`,
			LIST_SAID,
			`- ${count(range.commits.length)}: ${authors.map((author) => `${author.commits} by ${author.name}`).join(', ')}.`,
			...(range.fromFirst ? [fromFirst(range)] : []),
			...(work.length === 0
				? ['- The record has no piece of work in this range yet.']
				: work
						.slice(-MAX_LISTED)
						.map(
							(each) =>
								`- Work the record has in this range: "${each.title}", ${short(each.range.base)}..${short(each.range.head)}`,
						)),
		].join('\n'),
		empty: false,
	}
}

// "Ask ken to name these parts" and "Name them again" on the picture of the project. The level as the reader sees it now is the
// starting point, and the rules are those show's layout is checked against, so the model can pass the check first time.
// name is what the reader calls the level, such as the part they opened, or null for the whole project.
export type PartsLevel = {
	name: string | null
	within: string[]
	head: string
	bounds: { fewest: number; parts: number; arrows: number; about: number; flows: number; flow: number }
	boxes: { name: string; paths: string[]; files: number; job: string | null; state: 'same' | 'changed' | 'gone' }[]
	named: { drawnAt: string; added: string[] } | null
	loose: string[]
}

export function partsQuestion(level: PartsLevel): LensQuestion {
	const { within, head, named } = level
	return {
		text: [
			`${named ? 'Name again' : 'Name'} the main parts of ${whereOf(level)}`,
			LIST_SAID,
			...levelLines(level),
			'',
			`Read the code at HEAD (${head}), then call show with layout, and within set to ${JSON.stringify(within)}.`,
			...layoutRules(level),
			'Then say in two or three sentences how the parts fit together.',
		].join('\n'),
		empty: false,
	}
}

// The box where the reader tells ken to show a level another way. asked is their own words. The level as they see it
// now and the layout rules follow, as in partsQuestion, and then what to do: draw the level again when the words are
// about the picture, draw one diagram when they ask for an order of events or the data, which parts cannot show, and
// keep a reader note when they are about the reader. diagram holds the bounds show checks a diagram against.
export function viewQuestion(
	level: PartsLevel & {
		arrows: { from: string; to: string; text: string }[]
		diagram: { nodes: number; edges: number; title: number }
	},
	asked: string,
): LensQuestion {
	const { within, head, arrows, diagram } = level
	const uses = arrows.map((arrow) => `${arrow.from} ${arrow.text} ${arrow.to}`)
	return {
		text: [
			`Show ${whereOf(level)} another way: ${asked}`,
			LIST_SAID,
			...levelLines(level),
			...(uses.length > 0 ? [`- The arrows now: ${uses.join('; ')}.`] : []),
			'',
			`If what I ask is about the picture, such as how the parts are grouped, how many there are or what the arrows show: read the code at HEAD (${head}), then call show with a layout that does it, with within set to ${JSON.stringify(within)}, and say in one or two sentences what changed.`,
			...layoutRules(level),
			'If it is about me, such as what I know or how I want things explained: call remember with one plain sentence, and draw the picture again only if it should change too.',
			`If what I ask needs an order of events or the shape of the data, such as following one request, a data flow or a lifecycle, read the code at HEAD (${head}) and call show with one diagram instead of a layout.`,
			'Use sequence for steps in order, component for calls between pieces, and entity-relationship for data.',
			'A diagram of a path through the code shows every actor that decides something on it, the ones outside the code too, such as a person, a model or a database.',
			`Give it a title of at most ${diagram.title} characters that says what it follows, at most ${diagram.nodes} participants, boxes or entities, and at most ${diagram.edges} messages, arrows or relations, each quoting the lines it rests on.`,
			'Then say in one or two sentences what it shows.',
			'If neither a layout nor a diagram can do what I ask, say so plainly, and say what I can ask for instead.',
		].join('\n'),
		empty: false,
	}
}

function whereOf({ name, within }: PartsLevel): string {
	return name ?? (within.length === 0 ? 'this project' : within.join(', '))
}

function levelLines({ boxes, named, loose }: PartsLevel): string[] {
	const box = (each: PartsLevel['boxes'][number]) =>
		`${each.name} (${each.paths.join(', ')}, ${each.files === 1 ? '1 file' : `${each.files} files`})${each.job ? `: ${each.job}` : ''}`
	const changed = boxes.filter((each) => each.state !== 'same').map((each) => each.name)
	const moved = [
		...(changed.length > 0 ? [`${changed.join(', ')} changed since then`] : []),
		...(named && named.added.length > 0 ? [`${named.added.join(', ')} is new and in no part`] : []),
	]
	return [
		...(named
			? [
					`- ken's model named these parts at ${short(named.drawnAt)}: ${boxes.map(box).join('; ')}.`,
					...(moved.length > 0 ? [`- Since then: ${moved.join('; ')}.`] : []),
				]
			: [`- ken splits it by folder now: ${boxes.map(box).join('; ')}.`]),
		...(loose.length > 0 ? [`- In no part now: ${loose.join(', ')}.`] : []),
	]
}

// What a good picture of a level is, and the rules show's layout is checked against, so the model can pass the check
// first time. A reviewer found parts filed by folder, a product squeezed into one part and arrows that said more than
// their lines, so each rule says what to look at.
function layoutRules(level: PartsLevel): string[] {
	const { bounds } = level
	return [
		"Read the project's own maps before you group anything: the README, the design docs, a glossary, and any table in the code or the tests that names the modules or their boundaries. Call the parts what those call them, so the picture uses words the owner already knows.",
		`Group the paths into ${bounds.fewest} to ${bounds.parts} parts. Give each a short name, a job, and the folders or files it holds, each inside within. No two parts share a file.`,
		'Put a file in the part whose work it does, not the part its folder suggests. What it imports and what starts it tell you. If two parts would use each other, move the file that causes it.',
		'A file the product reads when it runs goes with the part that reads it, wherever its folder is: a scenario a command loads, a template, a fixture a shipped command reads.',
		'Spend the parts on the product. The code a user of the project runs gets parts in proportion to its size. What only keeps the repository going, such as build scripts, vendored code and agent setup, is one part at most. Leave out what is not code if it does not help, such as docs; ken lists it as in no part.',
		'List the parts in the order a newcomer should read them, the heart of the product first. A tour follows that order.',
		'A job is one sentence of about 80 characters with a verb. It says what the part does for whoever uses it, with no file names, flags or build steps. If you can only write a job as a list of nouns, the part is too big: split it.',
		'A job that needs the name of an outside tool or library says in a few words what that is, such as "pi, an agent SDK".',
		`Set the field about to what ${whereOf(level)} is, who uses it, and the one idea its maintainer would say first: one or two plain sentences, at most ${bounds.about} characters. ken sends back a layout without it.`,
		`Add at most ${bounds.arrows} arrows for which part uses which. Show the relation that matters when the code runs: one part calls the other, launches it as its own process, or reads its files. When a part launches another, quote the lines that launch it, down to the one that names its file. Use an import of types only when nothing stronger joins the two parts.`,
		'Give each arrow a short verb said from the part it starts at, so that the start part, the verb and the end part read as a sentence, such as "Server runs questions in Chat engine". A part that launches another "runs" or "launches" it. Never a passive verb such as "is used by". The verb says only what the quoted lines show: a line that imports a list shows "reads", not "runs".',
		'Each arrow quotes lines of code from a file of the part it starts at that name a folder or file of the part it ends at. A comment does not count. Leave out an arrow you cannot quote that way.',
		`Set the field flows to at most ${bounds.flows} processes here that a diagram of steps would show better than the parts do, each as a short request of at most ${bounds.flow} characters, such as "How an order is paid". Name only what you read in the code, and leave the field out when there is none.`,
	]
}

// "Ask ken to explain it" on a part, and on a whole level. Plain code picked the parts and their order, so the model
// explains each in that order and does not choose. name is what the reader calls the level, or null for the whole
// project. parts are the ones to explain, and beside the ones of the level it leaves out, which the model reads to
// say how the parts connect. bounds and drawings are what show checks a brief against, so the model can pass first
// time.
export type ExplainLevel = {
	name: string | null
	head: string
	parts: { name: string; job: string; paths: string[] }[]
	beside: { name: string; job: string }[]
	arrows: { from: string; to: string; text: string }[]
	bounds: {
		lineWords: number
		fewestPoints: number
		points: number
		terms: number
		meansWords: number
		fewestQuestions: number
		questions: number
		label: number
	}
	drawings: Record<string, string>
}

export function explainQuestion(level: ExplainLevel): LensQuestion {
	const { parts, beside, arrows, bounds } = level
	const where = level.name ?? 'this project'
	const [only] = parts
	const one = parts.length === 1 && only !== undefined && beside.length > 0 ? only : null
	const part = (each: ExplainLevel['parts'][number], k: number) =>
		`- Part ${k + 1}, ${each.name} (${each.paths.join(', ')})${each.job ? `: ${each.job}` : ''}`
	const uses = arrows.map((arrow) => `${arrow.from} ${arrow.text} ${arrow.to}`)
	const others = beside.map((each) => `${each.name}${each.job ? ` (${each.job})` : ''}`)
	return {
		text: [
			one ? `Explain ${one.name}, a part of ${where}` : `Explain the parts of ${where}`,
			LIST_SAID,
			...parts.map(part),
			...(others.length > 0 ? [`- Beside ${one ? 'it' : 'them'}: ${others.join('; ')}.`] : []),
			...(uses.length > 0 ? [`- How the parts use each other: ${uses.join('; ')}.`] : []),
			'',
			`Read the code at HEAD (${level.head}) first. For each part, find what its user calls and follow that call to its end: what comes in, each step in order, and what goes out. Then send one show call for each part above, in that order, with brief: the part's number and what follows.`,
			PICTURES,
			'line: one sentence on what the part does for whoever uses it.',
			`points: ${bounds.fewestPoints} to ${bounds.points} things to know, the ones a maintainer would tell a newcomer first. The first is the main path through the part: what comes in, the steps it takes, and what goes out. The others are what the part refuses, what it keeps, and the one choice in its design. ${pointRule(bounds)}`,
			...pointRules(level),
			`terms: up to ${bounds.terms} words a maintainer says when they talk about this part, which a newcomer has to learn: a thing the code names, such as a step, a kind of plugin or a kind of file. Take the word from the project's glossary or README when it has one. Not the name of one constant or one helper function. ${termRule(bounds)} Leave out the names of the parts.`,
			`questions: ${bounds.fewestQuestions} or ${bounds.questions} questions I would ask next about the part, one sentence each, that the code can answer: what happens when something fails, why it is built this way, what a change would break.`,
			'Say how two parts connect in the words of the arrows, such as "Tests runs scenarios through Eval harness". Never use the order of the list for it, such as "the next part": I open each brief on its own.',
			...LAST_RULES,
			'ken adds each part to the record as a topic itself, so send no topics. Write nothing outside the briefs.',
		].join('\n'),
		empty: false,
	}
}

// A question about one concept, pressed or typed in its brief. about is the concept as its brief names it: what kind
// of thing it is, its name, its one line, the paths it holds when it is a part, and the lines its brief already tells,
// so the answer does not say them again.
export type AnswerAbout = {
	asked: string
	head: string
	about: { kind: string; name: string; line: string; paths: string[]; told: string[] }
	bounds: ExplainLevel['bounds']
	drawings: Record<string, string>
}

export function answerQuestion(question: AnswerAbout): LensQuestion {
	const { about, bounds } = question
	const places = about.paths.length > 0 ? ` (${about.paths.join(', ')})` : ''
	return {
		text: [
			question.asked,
			LIST_SAID,
			`- You ask this about the ${about.kind} ${about.name}${places}${about.line ? `: ${about.line}` : '.'}`,
			...(about.told.length > 0 ? [`- Its brief already says: ${about.told.join(' ')}`] : []),
			'',
			`Read the code at HEAD (${question.head}) that decides the answer. Then answer with one show call, with brief: number 1 and what follows.`,
			PICTURES,
			'line: the answer in one sentence.',
			`points: ${bounds.fewestPoints} to ${bounds.points} things to know that make up the answer, in the order they happen when the answer is a run of events. ${pointRule(bounds)}`,
			...pointRules(question),
			`terms: only a word the answer uses that a newcomer would not know, three at most. ${termRule(bounds)}`,
			'Send no questions. Do not say again what the brief already says.',
			'If the code does not decide the answer, say so in line, and send as points what the code does show.',
			...LAST_RULES,
			'Send no topics. Write nothing outside the brief.',
		].join('\n'),
		empty: false,
	}
}

// What every brief is told, whoever asks for it, so a part's brief and an answer read alike.
const PICTURES =
	'I think in pictures. I read a brief beside a picture of the parts: each thing to know is a short line with a small drawing, and I open the longer telling when I want words. Write short, literal words: the short word, the active verb, the name the code uses. No figure of speech.'

const pointRule = (bounds: ExplainLevel['bounds']) =>
	`One idea each. Give each a line of at most ${bounds.lineWords} words that is a whole sentence; more, one sentence that says it in full; long, two or three sentences; a drawing; and quotes.`

function pointRules({ bounds, drawings }: Pick<ExplainLevel, 'bounds' | 'drawings'>): string[] {
	const kinds = Object.entries(drawings).map(([kind, shows]) => `${kind} (${shows})`)
	return [
		'A point says only what its quoted lines show. Quote code where the work happens: the loop, the check, the table, or the function with its body. Not a comment, and not a signature alone: ken sends back a point that quotes only comments. Give each quote its path. Name a file or a function in more or long, never in line.',
		`drawing: pick the kind that shows the point: ${kinds.join('; ')}. Give count for steps and loop, lit for steps, and a label of at most ${bounds.label} characters when one word helps. Pick dot when no kind fits. Never change what a point says so that a drawing fits it.`,
	]
}

const termRule = (bounds: ExplainLevel['bounds']) =>
	`Give each its name as the code spells it, means: what it means in at most ${bounds.meansWords} words, and quote: one line where the code uses it.`

const LAST_RULES = [
	'Never write that I understand, know or have learned something. Say what the code does.',
	'If ken sends a point or a term back, fix it and send it again alone, in a brief with the same number.',
]

export function sinceWords(since: Since): string {
	if (since.kind === 'days') return since.days === 1 ? 'in the last day' : `in the last ${since.days} days`
	if (since.kind === 'day') return `since ${since.day}`
	return 'since my last question'
}

function fromFirst(range: TimeRange): string {
	return `- No commit is older than the start, so the range starts at the first commit, ${short(range.base)}, and leaves it out.`
}

function commitsSaid(commits: ChangeCommit[]): string {
	if (commits.length === 0) return 'ken found no commit to its files since then.'
	return `Commits to its files since then: ${commits.map((c) => `${short(c.hash)} by ${c.author} (${WHO[c.by]})`).join(', ')}.`
}

function commitLine(commit: ChangeCommit): string {
	return `- ${short(commit.hash)} by ${commit.author} (${WHO[commit.by]}) ${at(commit.date)}: ${commit.subject}`
}

function count(commits: number): string {
	return commits === 1 ? '1 commit' : `${commits} commits`
}

function short(hash: string): string {
	return hash.slice(0, 7)
}
