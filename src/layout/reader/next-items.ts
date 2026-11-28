// What the reader should look at next, the first thing first: a decision that waits on them, a part that changed
// since they looked, a change to review, a part one commit touched since, the next stop of the tour, then the parts
// they never opened. Parts that changed come most commits first, then most lines. For a reader
// who has read fewer than half the parts, the tour comes before the change. Plain code ranks them from the record, what the reader
// looked at and git, so the page can show them before the reader asks.
import type { Knows, Level, OpensAt } from '../../map/index.ts'

// Where an item takes the reader: a way in, and there a part of this level, a level of detail and a change, as the
// layout takes a change. A field left out keeps what the page shows. A part opens where its box says ken would open
// it, so an item and the box it is about cannot disagree.
export type Go = Pick<OpensAt, 'way'> & Partial<OpensAt> & { part?: string }

// What landed in a part since the reader looked: the files it changed there, and their lines added and removed.
export type LandedSize = { files: number; added: number; removed: number }

// parts names the boxes of this level the item is about. Only a part that changed has landed, and only a change to
// review has size: the files it changed and what it is in a few words, such as "pull request #107".
export type NextItem = {
	kind: 'decision' | 'stale' | 'review' | 'tour' | 'read'
	title: string
	why: string
	go: Go
	parts: string[]
	landed?: LandedSize
	size?: { files: number; what: string }
}

// A box as the ranking reads it. landed is what the commits since the reader looked did there, when git could say.
export type NextBox = { name: string; knows: Knows; landed: LandedSize | null }

// The change the reader has not reviewed. what is the change in a few words, and why may be empty. change asks the
// layout for it, and files and parts say how large it is: the files it changed, and the boxes of this level that hold
// one of them.
export type ToReview = {
	title: string
	what: string
	why: string
	change: string
	files: number
	parts: string[]
	part?: string
}

export type NextFacts = {
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
	const size = (box: NextBox) => (box.landed ? box.landed.added + box.landed.removed : 0)
	const stale = boxes
		.filter((box) => box.knows.stale)
		.toSorted((a, b) => b.knows.since - a.knows.since || size(b) - size(a))
	// A merge the reader has not walked through outweighs one commit on a part, unless they said they know that part.
	const small = (box: NextBox) => box.knows.since === 1 && box.knows.level !== 'said'
	const onTour = facts.toured
		? inOrder.find((box) => box.knows.level === 'new' || box.knows.level === 'seen')
		: undefined
	const untouched = boxes.every((box) => box.knows.level === 'new')
	const read = boxes.filter((box) => box.knows.level !== 'new' && box.knows.level !== 'seen').length
	const newcomer = read * 2 < boxes.length
	const tour = onTour ? [tourItem(onTour, untouched)] : []
	const items: NextItem[] = [
		...decisionItem(facts.decisions),
		...stale.filter((box) => !small(box)).map(staleItem),
		// A newcomer goes on with the tour first: a change says little before they know the parts.
		...(newcomer ? tour : []),
		...(review ? [reviewItem(review)] : []),
		...stale.filter(small).map(staleItem),
		...(newcomer ? [] : tour),
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
			parts: [],
		},
	]
}

function staleItem({ name, knows, landed }: NextBox): NextItem {
	const commits = knows.since === 1 ? '1 commit landed' : `${knows.since} commits landed`
	return {
		kind: 'stale',
		title: `See what changed in ${name}`,
		why: `${commits} there since ${SINCE[knows.level]}.`,
		go: { ...knows.go, part: name },
		parts: [name],
		...(landed ? { landed } : {}),
	}
}

function reviewItem({ title, what, why, change, files, parts, part }: ToReview): NextItem {
	const size =
		parts.length === 0 ? `${count(files, 'file')}.` : `${count(files, 'file')} in ${count(parts.length, 'part')}.`
	return {
		kind: 'review',
		title,
		why: why === '' ? size : `${why} ${size}`,
		go: { way: 'review', detail: 'how', change, ...(part ? { part } : {}) },
		parts,
		size: { files, what },
	}
}

function tourItem({ name, knows }: NextBox, untouched: boolean): NextItem {
	return {
		kind: 'tour',
		title: `${untouched ? 'Start the tour' : 'Go on with the tour'}: ${name}`,
		why: untouched ? 'It is the first stop of the tour.' : 'It is the next stop of the tour you have not read.',
		go: { ...knows.go, part: name },
		parts: [name],
	}
}

function meetItem({ name, knows }: NextBox): NextItem {
	return {
		kind: 'read',
		title: `Read what ${name} does`,
		why: knows.why,
		go: { ...knows.go, part: name },
		parts: [name],
	}
}

function count(n: number, one: string): string {
	return n === 1 ? `1 ${one}` : `${n} ${one}s`
}
