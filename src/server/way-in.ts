// The way in ken suggests when the reader opens the project: review their own work, catch up on what landed since
// they last looked, or learn the project. Plain code picks it from git, the reader's history and their map, says why in
// one sentence, and gives one short fact for each way in, which the page shows under each choice.
import { at as atMoment, type Landed } from '../follow-up/index.ts'
import type { Asked, History } from '../history/index.ts'
import { type Change, type LayoutLook, type LayoutSources, pullRequestOf } from '../layout/index.ts'
import type { Repository } from '../repo/index.ts'

export type WayIn = 'learn' | 'catch-up' | 'review'

export type Suggested = {
	suggested: WayIn
	why: string
	facts: { learn: string; 'catch-up': string | null; review: string | null }
}

// The main line is read this far back for its newest merge, as the layout's own choice of changes reads it.
const MAIN_LINE = 100
const SUBJECT_CHARS = 40

// questions are the ones the reader asked, oldest first, visit is the newest line on what they looked at from an
// earlier visit, and spans the spans of time that hold a commit, in the order the page offers them. own is the
// reader's own work, uncommitted or their branch ahead of main, and top the top level at HEAD. Catching up is
// suggested only when commits landed since the reader last looked: since that visit, or with none since their last
// question, or since their own last commit. A span of days alone does not say they looked.
export async function suggestWayIn(
	layout: LayoutSources,
	reader: {
		history: History
		questions: Pick<Asked, 'head' | 'askedAt'>[]
		visit: { at: string; head: string } | null
		spans: Landed[]
		own: Change | null
		top: LayoutLook
	},
	now: Date,
): Promise<Suggested> {
	const { repo } = layout
	const { top } = reader
	const at = top.head
	const [work, asked] = await Promise.all([reader.own && ownWork(repo, reader.own), reader.history.list()])
	const met = asked.length > 0 || (await layout.map.read(now)).states.some((state) => state.kind !== 'never-met')
	const [first] = reader.spans
	const facts = {
		learn: count(top.boxes.length, top.named ? 'part' : 'folder'),
		'catch-up': first?.short ?? null,
		review: work?.short ?? (await newestOnMainLine(repo, at)),
	}
	if (work) return { suggested: 'review', why: work.why, facts }
	// When they last looked says why ken thinks so, to a reader who is back after weeks.
	const { visit } = reader
	if (visit?.head === at) {
		return { suggested: 'learn', why: `Nothing landed since you last looked, ${atMoment(visit.at, now)}.`, facts }
	}
	const last = visit ? undefined : reader.questions.findLast((each) => each.head !== null)
	if (last?.head === at) {
		const why = `Nothing landed since your last question to ken, ${atMoment(last.askedAt, now)}.`
		return { suggested: 'learn', why, facts }
	}
	if (first && first.anchor !== 'days') return { suggested: 'catch-up', why: first.landed, facts }
	// A span of days is no sign of when the reader looked, so with a history and no other span ken says it cannot tell.
	const why = met
		? 'ken cannot tell when you last looked, so it shows the project as it is.'
		: 'You have not looked at this project with ken yet.'
	return { suggested: 'learn', why, facts }
}

async function ownWork(repo: Repository, change: Change): Promise<{ why: string; short: string }> {
	if (change.kind === 'uncommitted') {
		const diff = await repo.diff(change.range)
		const files = count(diff.kind === 'ok' ? diff.files.length : 0, 'file')
		return { why: `You have uncommitted work in ${files}.`, short: `${files} uncommitted` }
	}
	const logged = await repo.log(change.range)
	const commits = count(logged.kind === 'ok' ? logged.commits.length : 0, 'commit')
	return {
		why: `You are on the branch ${change.name}, ${commits} ahead of the main branch.`,
		short: `${commits} on ${change.name}`,
	}
}

// The newest merge on the main line, or its newest commit when it has no merge. The first commit of the project is left
// out, as the layout leaves it out of its changes: it has no commit before it to compare with.
async function newestOnMainLine(repo: Repository, head: Change['range']['head']): Promise<string | null> {
	const line = await repo.mainLine(head, MAIN_LINE)
	const commits = line.kind === 'ok' ? line.commits.filter((commit) => commit.parents.length > 0) : []
	const merge = commits.find((commit) => commit.parents.length > 1)
	const newest = merge ?? commits[0]
	if (!newest) return null
	const pull = merge && pullRequestOf(merge.subject)
	if (pull) return `Newest merge: pull request ${pull}`
	const subject =
		newest.subject.length > SUBJECT_CHARS ? `${newest.subject.slice(0, SUBJECT_CHARS - 3)}...` : newest.subject
	return `Newest ${merge ? 'merge' : 'commit'}: ${subject}`
}

function count(n: number, one: string): string {
	return n === 1 ? `1 ${one}` : `${n} ${one}s`
}
