// The check on "In its world" and "Where it runs". Each item is checked alone, as a card is: its texts, its quoted
// lines in git, and the ids it names. One that fails is sent back with its problems and the rest stand. An item that
// names an item ken did not take fails too, so nothing on the page points at a thing that is not there. Frames must
// form a tree, a part must be a part of the level, and a frame's copies must be on the line it quotes and agree with
// the compose file or manifest that line is in.
import { type GitQuote, type VerifiedGitQuote, verifyGitQuote } from '../../checks/index.ts'
import { parsePath, type Repository } from '../../repo/index.ts'
import { readWorkloads } from './deploy-files.ts'
import {
	type Crossing,
	type Frame,
	type FrameKind,
	type Gap,
	HOWS,
	type How,
	type Outside,
	type OutsideKind,
	type Runtime,
	STORE_KINDS,
	type StoreKind,
	type Thing,
	VIEWS_BOUNDS,
	type Views,
	type World,
	type WorldCrossing,
} from './views.ts'

// The items as the model sends them. A field a kind of thing does not use is "" or null.
export type OutsideDraft = { id: string; kind: OutsideKind; name: string; line: string; quotes: GitQuote[] }
export type WorldCrossingDraft = Omit<WorldCrossing, 'quotes'> & { quotes: GitQuote[] }
export type FrameDraft = {
	id: string
	kind: FrameKind
	name: string
	line: string
	in: string | null
	copies: { count: number; quote: GitQuote } | null
	quotes: GitQuote[]
}
export type ThingDraft = {
	id: string
	kind: Thing['kind']
	frame: string | null
	part: string
	store: StoreKind | null
	name: string
	line: string
	topics: string[]
	quotes: GitQuote[]
}
export type CrossingDraft = {
	id: string
	kind: Crossing['kind']
	from: string
	to: string
	text: string
	how: How | null
	topic: string
	quotes: { from: GitQuote[]; to: GitQuote[] }
}
export type ViewsDraft = {
	world: { outside: OutsideDraft[]; crossings: WorldCrossingDraft[] } | null
	runtime: { frames: FrameDraft[]; things: ThingDraft[]; crossings: CrossingDraft[]; gaps: Gap[] } | null
}

export type SentBack = { where: string; problems: string[] }
export type ViewsCheck = { views: Views; sentBack: SentBack[] }

const EMPTY: Views = { world: null, runtime: null }
const ID = /^[a-z0-9][a-z0-9-]*$/

// parts are the names of the parts of the top level. held is what ken took before, which the new items may name.
export async function checkViews(
	repo: Repository,
	draft: ViewsDraft,
	{ parts, held = EMPTY }: { parts: string[]; held?: Views },
	signal?: AbortSignal,
): Promise<ViewsCheck> {
	const B = VIEWS_BOUNDS
	const world: World = { outside: [...(held.world?.outside ?? [])], crossings: [...(held.world?.crossings ?? [])] }
	const runtime: Runtime = {
		frames: [...(held.runtime?.frames ?? [])],
		things: [...(held.runtime?.things ?? [])],
		crossings: [...(held.runtime?.crossings ?? [])],
		gaps: [...(held.runtime?.gaps ?? [])],
	}
	const sentBack: SentBack[] = []
	const ids = () =>
		new Set(
			[
				...world.outside,
				...world.crossings,
				...runtime.frames,
				...runtime.things,
				...runtime.crossings,
				...runtime.gaps,
			].map((item) => item.id),
		)
	const outsideIds = () => new Set(world.outside.map((each) => each.id))
	const frameIds = () => new Set(runtime.frames.map((each) => each.id))
	const thingIds = () => new Set(runtime.things.map((each) => each.id))
	// A reader takes two boxes with one name for one thing, so a frame, a store and an outside system each take a name no
	// other item of the drawing has. A part may sit in several frames: that is one part, which runs in two places.
	const outsideName = (id: string) => world.outside.find((each) => each.id === id)?.name ?? ''
	type Named = { name: string; what: string; part: boolean }
	const drawnNames = (): Named[] => [
		...runtime.frames.map((frame) => ({ name: frame.name, what: `the frame "${frame.id}"`, part: false })),
		...runtime.things.map((thing) =>
			thing.kind === 'part'
				? { name: thing.part, what: `the part "${thing.part}"`, part: true }
				: thing.kind === 'store'
					? { name: thing.name, what: `the store "${thing.id}"`, part: false }
					: { name: outsideName(thing.id), what: `the outside system "${thing.id}"`, part: false },
		),
	]
	const twice = (name: string, taken: Named[]) => {
		const before = name.trim() === '' ? undefined : taken.find((each) => sameName(each.name, name))
		if (!before) return []
		return [`its name "${name}" is the name of ${before.what}, so the two read as one thing. Give each its own name.`]
	}

	// The checks every item gets: its id, how many of its kind there are, and its texts.
	// unique is false for an outside thing, whose id is that of its outside system.
	const start = (what: string, id: string, list: unknown[], most: number, unique = true) => {
		const problems: string[] = []
		const where = `${what} "${id}"`
		if (unique && ids().has(id)) problems.push('another item has this id.')
		if (!ID.test(id) || id.length > B.id) {
			problems.push(
				`its id must be ${B.id} characters at most of a to z, 0 to 9 and -, starting with a letter or digit.`,
			)
		}
		if (list.length >= most) problems.push(`the drawing holds ${most} at most. Keep the ones a reader needs first.`)
		const text = (field: string, value: string, longest: number) => {
			if (value.trim() === '') problems.push(`it has no ${field}.`)
			else if (value.trim().length > longest)
				problems.push(`its ${field} has ${value.trim().length} characters; keep it to ${longest}.`)
			return value.trim()
		}
		const done = <T>(item: T, into: T[]) => {
			if (problems.length > 0) sentBack.push({ where, problems: problems.map((problem) => `${where}: ${problem}`) })
			else into.push(item)
		}
		const quoted = (field: string, raw: GitQuote[], needed = true) =>
			quotesOf(repo, field, raw, problems, needed, signal)
		return { problems, text, done, quoted }
	}

	for (const sent of draft.world?.outside ?? []) {
		const item = start('Outside', sent.id, world.outside, B.outside)
		const taken = world.outside.map((each) => ({
			name: each.name,
			what: `the outside system "${each.id}"`,
			part: false,
		}))
		item.problems.push(...twice(sent.name, taken))
		const outside: Outside = {
			id: sent.id,
			kind: sent.kind,
			name: item.text('name', sent.name, B.name),
			line: item.text('line', sent.line, B.line),
			quotes: await item.quoted('it', sent.quotes),
		}
		item.done(outside, world.outside)
	}
	for (const sent of draft.world?.crossings ?? []) {
		const item = start('Crossing', sent.id, world.crossings, B.worldCrossings)
		if (!outsideIds().has(sent.outside)) item.problems.push(names('outside', sent.outside))
		const crossing: WorldCrossing = {
			id: sent.id,
			outside: sent.outside,
			text: item.text('text', sent.text, B.text),
			how: sent.how,
			direction: sent.direction,
			quotes: await item.quoted('it', sent.quotes),
		}
		item.done(crossing, world.crossings)
	}

	// A frame may sit in one sent after it, so frames are taken in rounds until no more can be.
	const frames: { sent: FrameDraft; frame: Frame; item: ReturnType<typeof start> }[] = []
	for (const sent of draft.runtime?.frames ?? []) {
		const item = start('Frame', sent.id, [...runtime.frames, ...frames], B.frames)
		if (frames.some((each) => each.sent.id === sent.id)) item.problems.push('another item has this id.')
		const sentBefore = frames.map((each) => ({
			name: each.frame.name,
			what: `the frame "${each.frame.id}"`,
			part: false,
		}))
		item.problems.push(...twice(sent.name, [...drawnNames(), ...sentBefore]))
		const copies = sent.copies && (await copiesOf(repo, sent.copies, item.problems, signal))
		const frame: Frame = {
			id: sent.id,
			kind: sent.kind,
			name: item.text('name', sent.name, B.name),
			line: item.text('line', sent.line, B.line),
			in: sent.in,
			copies,
			quotes: await item.quoted('it', sent.quotes),
		}
		frames.push({ sent, frame, item })
	}
	const good = frames.filter(({ item }) => item.problems.length === 0)
	for (const bad of frames.filter(({ item }) => item.problems.length > 0)) bad.item.done(bad.frame, runtime.frames)
	let waiting = good
	while (waiting.length > 0) {
		const ready = waiting.filter(({ frame }) => frame.in === null || frameIds().has(frame.in))
		if (ready.length === 0) break
		for (const { frame, item } of ready) item.done(frame, runtime.frames)
		waiting = waiting.filter((each) => !ready.includes(each))
	}
	for (const { frame, item } of waiting) {
		const loop = inLoop(
			frame,
			waiting.map((each) => each.frame),
		)
		const tree = 'Frames form a tree: give the outermost one no in.'
		item.problems.push(
			loop === null
				? names('frame', frame.in ?? '')
				: loop.length === 0
					? `it sits inside itself. ${tree}`
					: `it sits inside ${loop.join(', ')}, which sit inside it. ${tree}`,
		)
		item.done(frame, runtime.frames)
	}

	for (const sent of draft.runtime?.things ?? []) {
		const item = start('Thing', sent.id, runtime.things, B.things, sent.kind !== 'outside')
		const frame = sent.frame
		if (frame !== null && !frameIds().has(frame)) item.problems.push(names('frame', frame))
		if (sent.kind === 'outside') {
			if (!outsideIds().has(sent.id)) {
				item.problems.push(
					'an outside thing takes the id of an outside system of "In its world", and no such system has this id.',
				)
			}
			if (thingIds().has(sent.id)) item.problems.push('this outside system is in the drawing already.')
			else item.problems.push(...twice(outsideName(sent.id), drawnNames()))
			item.done({ id: sent.id, kind: 'outside', frame }, runtime.things)
			continue
		}
		if (sent.kind === 'part') {
			const part = parts.find((name) => sameName(name, sent.part))
			if (!part) {
				item.problems.push(
					`it names the part "${sent.part}", which is not a part of the level. The parts are: ${parts.join(', ') || 'none yet'}.`,
				)
			}
			if (part)
				item.problems.push(
					...twice(
						part,
						drawnNames().filter((each) => !each.part),
					),
				)
			const quotes = await item.quoted('it', sent.quotes)
			item.done({ id: sent.id, kind: 'part', part: part ?? sent.part, frame, quotes }, runtime.things)
			continue
		}
		if (sent.store === null) item.problems.push(`a store needs its kind, one of ${STORE_KINDS.join(', ')}.`)
		if (sent.topics.length > B.topics)
			item.problems.push(`it has ${sent.topics.length} topics; keep it to ${B.topics}.`)
		item.problems.push(...twice(sent.name, drawnNames()))
		const thing: Thing = {
			id: sent.id,
			kind: 'store',
			store: sent.store ?? 'other',
			name: item.text('name', sent.name, B.name),
			line: item.text('line', sent.line, B.line),
			topics: sent.topics.map((topic) => item.text('topic', topic, B.topic)),
			frame,
			quotes: await item.quoted('it', sent.quotes),
		}
		item.done(thing, runtime.things)
	}

	for (const sent of draft.runtime?.crossings ?? []) {
		const item = start('Crossing', sent.id, runtime.crossings, B.crossings)
		for (const end of [sent.from, sent.to]) if (!thingIds().has(end)) item.problems.push(names('thing', end))
		if (sent.from === sent.to) item.problems.push('it goes from a thing to itself.')
		const text = item.text('text', sent.text, B.text)
		const from = await item.quoted('its from side', sent.quotes.from, false)
		const to = await item.quoted('its to side', sent.quotes.to, false)
		if (sent.quotes.from.length + sent.quotes.to.length === 0) {
			item.problems.push('it rests on no line. Quote the call, the send or the read on either side.')
		}
		const quotes = { from, to }
		let crossing: Crossing
		if (sent.kind === 'call') {
			if (sent.how === null) item.problems.push(`a call needs how it crosses, one of ${HOWS.join(', ')}.`)
			crossing = { id: sent.id, kind: 'call', from: sent.from, to: sent.to, text, how: sent.how ?? 'other', quotes }
		} else {
			const topic = item.text('topic', sent.topic, B.topic)
			for (const end of runtime.things) {
				const listed = end.kind === 'store' && end.topics.length > 0 && [sent.from, sent.to].includes(end.id)
				if (listed && !end.topics.includes(topic)) {
					item.problems.push(`its topic "${topic}" is not one of the topics of ${end.name}: ${end.topics.join(', ')}.`)
				}
			}
			crossing = { id: sent.id, kind: 'event', from: sent.from, to: sent.to, text, topic, quotes }
		}
		item.done(crossing, runtime.crossings)
	}

	for (const sent of draft.runtime?.gaps ?? []) {
		const item = start('Gap', sent.id, runtime.gaps, B.gaps)
		const known = new Set([...frameIds(), ...thingIds(), ...outsideIds()])
		if (!known.has(sent.on)) item.problems.push(names('frame, thing or outside system', sent.on))
		item.done({ id: sent.id, on: sent.on, text: item.text('text', sent.text, B.gap) }, runtime.gaps)
	}

	const hasWorld = world.outside.length + world.crossings.length > 0
	const hasRuntime = runtime.frames.length + runtime.things.length > 0
	return { views: { world: hasWorld ? world : null, runtime: hasRuntime ? runtime : null }, sentBack }
}

// The draft that checks back to the same views, so the project record can check stored ones again.
export function viewsDraft(views: Views): ViewsDraft {
	const raw = (quote: VerifiedGitQuote): GitQuote => ({
		path: quote.path,
		commit: quote.commit,
		text: quote.text,
		line: quote.startLine,
	})
	const { world, runtime } = views
	return {
		world: world && {
			outside: world.outside.map((each) => ({ ...each, quotes: each.quotes.map(raw) })),
			crossings: world.crossings.map((each) => ({ ...each, quotes: each.quotes.map(raw) })),
		},
		runtime: runtime && {
			frames: runtime.frames.map((each) => ({
				...each,
				copies: each.copies && { count: each.copies.count, quote: raw(each.copies.quote) },
				quotes: each.quotes.map(raw),
			})),
			things: runtime.things.map((each) => ({
				id: each.id,
				kind: each.kind,
				frame: each.frame,
				part: each.kind === 'part' ? each.part : '',
				store: each.kind === 'store' ? each.store : null,
				name: each.kind === 'store' ? each.name : '',
				line: each.kind === 'store' ? each.line : '',
				topics: each.kind === 'store' ? each.topics : [],
				quotes: each.kind === 'outside' ? [] : each.quotes.map(raw),
			})),
			crossings: runtime.crossings.map((each) => ({
				id: each.id,
				kind: each.kind,
				from: each.from,
				to: each.to,
				text: each.text,
				how: each.kind === 'call' ? each.how : null,
				topic: each.kind === 'event' ? each.topic : '',
				quotes: { from: each.quotes.from.map(raw), to: each.quotes.to.map(raw) },
			})),
			gaps: runtime.gaps,
		},
	}
}

// The quoted lines of an item, each from a file at its commit. A problem is added for each one git does not hold.
async function quotesOf(
	repo: Repository,
	field: string,
	raw: GitQuote[],
	problems: string[],
	needed: boolean,
	signal?: AbortSignal,
): Promise<VerifiedGitQuote[]> {
	if (needed && raw.length === 0) problems.push(`${field} rests on no line. Quote the lines that show it.`)
	if (raw.length > VIEWS_BOUNDS.quotes) {
		problems.push(`${field} has ${raw.length} quotes; keep it to ${VIEWS_BOUNDS.quotes}.`)
	}
	const verified: VerifiedGitQuote[] = []
	for (const [at, quote] of raw.entries()) {
		if (quote.path === null) {
			problems.push(`${field}, quote ${at + 1}, names no file. A drawing rests on lines of files: give the path.`)
			continue
		}
		const verdict = await verifyGitQuote(repo, quote, signal)
		if (verdict.kind === 'verified') verified.push(verdict.quote)
		else problems.push(`${field}, quote ${at + 1}: ${verdict.problem}`)
	}
	return verified
}

// A frame's copies hold when the quoted line gives the number and, in a compose file or a manifest ken reads, the
// service or workload around that line runs that many.
async function copiesOf(
	repo: Repository,
	copies: { count: number; quote: GitQuote },
	problems: string[],
	signal?: AbortSignal,
): Promise<Frame['copies']> {
	const { count } = copies
	const [quote] = await quotesOf(repo, 'its copies', [copies.quote], problems, true, signal)
	if (!quote?.path) return null
	if (!new RegExp(`(^|[^0-9])${count}([^0-9]|$)`).test(quote.text)) {
		problems.push(
			`its copies are ${count}, and the quoted line does not say ${count}. Quote the line that gives the number.`,
		)
	}
	const path = parsePath(quote.path)
	const file = path.kind === 'ok' ? await repo.readFile(quote.commit, path.path, signal) : null
	const workload = (file?.kind === 'ok' ? readWorkloads(quote.path, file.text) : null)?.find(
		({ lines }) => quote.startLine >= lines.first && quote.startLine <= lines.last,
	)
	if (workload && workload.copies !== null && workload.copies !== count) {
		problems.push(
			`its copies are ${count}, and ${workload.file} runs ${workload.copies} of ${workload.name}${workload.said ? ` (line ${workload.said})` : ''}.`,
		)
	}
	return { count, quote }
}

// The other frames of a loop that leads back to frame, or null when its chain of parents ends elsewhere.
function inLoop(frame: Frame, waiting: Frame[]): string[] | null {
	const seen: string[] = []
	let at: Frame | undefined = frame
	while (at && !seen.includes(at.id)) {
		seen.push(at.id)
		const parent: string | null = at.in
		at = waiting.find((each) => each.id === parent)
	}
	return at?.id === frame.id ? seen.slice(1) : null
}

function names(what: string, id: string): string {
	return `it names "${id}", which is no ${what} ken took. Send that ${what} first, or fix the id.`
}

// As the record compares names: case, spaces, - and _ do not count.
function sameName(a: string, b: string): boolean {
	const normal = (name: string) =>
		name
			.toLowerCase()
			.replaceAll(/[\s_-]+/g, ' ')
			.trim()
	return normal(a) === normal(b)
}
