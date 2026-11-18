// The order of a tour of one named level, picked by plain code from the parts and their checked arrows. A tour starts
// at the parts nothing else in the level uses, follows the arrows inward breadth first, and leaves the parts that
// support the code (tests, build scripts, vendored code) for the end. The same level always gives the same order.

export type TourPart = { name: string; job: string | null; paths: string[] }

// start: nothing else uses it, or it is where ken picked up a loop no start reached. inward: an earlier stop uses it.
// aside: no arrow joins it to the rest of the code. support: tests, build or vendored code, by its name, the first
// word of its job, or its paths.
export type TourStop = { name: string; job: string; paths: string[]; kind: 'start' | 'inward' | 'aside' | 'support' }

const SUPPORT_WORDS = new Set([
	'test',
	'tests',
	'testing',
	'spec',
	'specs',
	'e2e',
	'fixtures',
	'script',
	'scripts',
	'build',
	'ci',
	'vendor',
	'vendored',
	'third_party',
	'third-party',
	'node_modules',
	'.github',
])

export function tourOrder(parts: TourPart[], arrows: { from: string; to: string }[]): TourStop[] {
	const support = parts.filter(isSupport)
	const code = parts.filter((part) => !support.includes(part))
	const inCode = (name: string) => code.some((part) => part.name === name)
	// Tests use everything, so only an arrow between two parts of the code says where the code starts.
	const links = arrows.filter((arrow) => arrow.from !== arrow.to && inCode(arrow.from) && inCode(arrow.to))
	const outgoing = (name: string) => links.filter((arrow) => arrow.from === name).length
	const stops: TourStop[] = []
	const seen = new Set<string>()
	const walk = (starts: TourPart[]) => {
		const queue = starts.map((part) => part.name)
		for (const name of queue) seen.add(name)
		for (const name of queue) {
			const kind = starts.some((part) => part.name === name) ? 'start' : 'inward'
			stops.push(
				stopOf(
					code.find((part) => part.name === name),
					kind,
				),
			)
			for (const arrow of links) {
				if (arrow.from !== name || seen.has(arrow.to)) continue
				seen.add(arrow.to)
				queue.push(arrow.to)
			}
		}
	}
	// A stable sort keeps the level's own order among parts with as many arrows.
	const byOutgoing = (list: TourPart[]) => [...list].sort((a, b) => outgoing(b.name) - outgoing(a.name))
	const joined = code.filter((part) => links.some((arrow) => arrow.from === part.name || arrow.to === part.name))
	walk(byOutgoing(joined.filter((part) => !links.some((arrow) => arrow.to === part.name))))
	// Parts that use each other in a loop no start reaches: the one that uses the most starts the next walk.
	for (let left = joined.filter((part) => !seen.has(part.name)); left.length > 0; ) {
		walk(byOutgoing(left).slice(0, 1))
		left = joined.filter((part) => !seen.has(part.name))
	}
	const aside = code.filter((part) => !joined.includes(part)).map((part) => stopOf(part, 'aside'))
	return [...stops, ...aside, ...support.map((part) => stopOf(part, 'support'))]
}

function stopOf(part: TourPart | undefined, kind: TourStop['kind']): TourStop {
	if (!part) throw new Error('tourOrder: an arrow names a part the level does not have')
	return { name: part.name, job: part.job ?? '', paths: part.paths, kind }
}

function isSupport(part: TourPart): boolean {
	const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_.-]+/)
	const said = [...words(part.name), ...words(part.job ?? '').slice(0, 1)].some((word) => SUPPORT_WORDS.has(word))
	const placed = part.paths.every((place) => place.split('/').some((segment) => SUPPORT_WORDS.has(segment)))
	return said || (part.paths.length > 0 && placed)
}
