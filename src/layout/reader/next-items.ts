// What the reader should look at next, the first thing first: a decision that waits on them, a part that changed
// since they looked, a change to review, the next stop of the tour, then the parts they never opened. Plain code
// ranks them from the record, what the reader looked at and git, so the page can show them before the reader asks.
import type { CommitHash } from '../../repo/index.ts'
import type { Knows, Level } from './box-knows.ts'

// Where an item takes the reader: a way in, and there a part of this level, a level of detail and a change, as the
// layout takes a change. A field left out keeps what the page shows.
export type Go = {
	way: 'learn' | 'catch-up' | 'review'
	part?: string
	detail?: 'big' | 'how' | 'code'
	change?: string
}

export type NextItem = { kind: 'decision' | 'stale' | 'review' | 'tour' | 'read'; title: string; why: string; go: Go }

// A box as the ranking reads it. lookedAt is the commit the reader last looked at it, when ken knows it.
export type NextBox = { name: string; knows: Knows; lookedAt: string | null }

// The change the reader has not reviewed. why may be empty. change asks the layout for it, and files and parts say
// how large it is: the files it changed, and the boxes of this level that hold one of them.
export type ToReview = { title: string; why: string; change: string; files: number; parts: number }

export type NextFacts = {
	head: CommitHash
	// The questions of the decisions that wait on the reader, newest first.
	decisions: string[]
	boxes: NextBox[]
	// The names of the boxes in the order a reader meets them. toured says that order is a tour of named parts.
	order: string[]
	toured: boolean
	review: ToReview | null
}

const MOST = 5

const SINCE: Record<Level, string> = {
	new: 'you looked',
	seen: 'you looked',
	read: 'you read about it',
	code: 'you read its code',
	said: 'you said you know it',
}

export function nextItems(facts: NextFacts): NextItem[] {
	const { boxes, order, review } = facts
	const inOrder = order.flatMap((name) => boxes.find((box) => box.name === name) ?? [])
	const stale = boxes.filter((box) => box.knows.stale).toSorted((a, b) => b.knows.since - a.knows.since)
	const onTour = facts.toured
		? inOrder.find((box) => box.knows.level === 'new' || box.knows.level === 'seen')
		: undefined
	const untouched = boxes.every((box) => box.knows.level === 'new')
	const items: NextItem[] = [
		...decisionItem(facts.decisions),
		...stale.map((box) => staleItem(box, facts.head)),
		...(review ? [reviewItem(review)] : []),
		...(onTour ? [tourItem(onTour, untouched)] : []),
		...inOrder.filter((box) => box.knows.level === 'new' && box !== onTour).map(meetItem),
	]
	return items.slice(0, MOST)
}

function decisionItem(questions: string[]): NextItem[] {
	const [newest] = questions
	if (newest === undefined) return []
	const one = questions.length === 1
	return [
		{
			kind: 'decision',
			title: one ? '1 decision waits on you' : `${questions.length} decisions wait on you`,
			why: one ? `It asks: ${newest}` : `The newest asks: ${newest}`,
			go: { way: 'review' },
		},
	]
}

function staleItem({ name, knows, lookedAt }: NextBox, head: CommitHash): NextItem {
	const landed = knows.since === 1 ? '1 commit landed' : `${knows.since} commits landed`
	return {
		kind: 'stale',
		title: `See what changed in ${name}`,
		why: `${landed} there since ${SINCE[knows.level]}.`,
		go: { way: 'catch-up', part: name, detail: 'code', ...(lookedAt ? { change: `${lookedAt}..${head}` } : {}) },
	}
}

function reviewItem({ title, why, change, files, parts }: ToReview): NextItem {
	const size = parts === 0 ? `${count(files, 'file')}.` : `${count(files, 'file')} in ${count(parts, 'part')}.`
	return {
		kind: 'review',
		title,
		why: why === '' ? size : `${why} ${size}`,
		go: { way: 'review', detail: 'how', change },
	}
}

// A part new to the reader shows its job first, and one they opened shows how it works.
function tourItem({ name, knows }: NextBox, untouched: boolean): NextItem {
	return {
		kind: 'tour',
		title: `${untouched ? 'Start the tour' : 'Go on with the tour'}: ${name}`,
		why: untouched ? 'It is the first stop of the tour.' : 'It is the next stop of the tour you have not read.',
		go: { way: 'learn', part: name, detail: knows.level === 'new' ? 'big' : 'how' },
	}
}

function meetItem({ name, knows }: NextBox): NextItem {
	return { kind: 'read', title: `Meet ${name}`, why: knows.why, go: { way: 'learn', part: name, detail: 'big' } }
}

function count(n: number, one: string): string {
	return n === 1 ? `1 ${one}` : `${n} ${one}s`
}
