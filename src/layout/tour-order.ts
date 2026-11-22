// The order of a tour of one named level, picked by plain code from the parts and their checked arrows. A tour starts
// at the part the most other parts use, goes outward along the arrows breadth first, and leaves the parts that support
// the code (tests, build scripts, vendored code, upkeep) for the end. The same level always gives the same order.

export type TourPart = { name: string; job: string | null; paths: string[] }

// heart: the part the most other parts use, or the most used part of a group the walk had not reached. outward: an
// arrow joins it to an earlier stop. aside: no arrow joins it to the rest of the code. support: tests, build or
// vendored code, by its name, the first word of its job, or its paths.
export type TourStop = { name: string; job: string; paths: string[]; kind: 'heart' | 'outward' | 'aside' | 'support' }

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
	'upkeep',
	'tooling',
	'maintenance',
])

export function tourOrder(parts: TourPart[], arrows: { from: string; to: string }[]): TourStop[] {
	const support = parts.filter(isSupport)
	const code = parts.filter((part) => !support.includes(part))
	const inCode = (name: string) => code.some((part) => part.name === name)
	// Tests use everything, so only an arrow between two parts of the code says which part the others use.
	const links = arrows.filter((arrow) => arrow.from !== arrow.to && inCode(arrow.from) && inCode(arrow.to))
	const used = (name: string) => links.filter((arrow) => arrow.to === name).length
	const uses = (name: string) => links.filter((arrow) => arrow.from === name).length
	const joined = (name: string) => used(name) + uses(name)
	const stops: TourStop[] = []
	const seen = new Set<string>()
	for (let left = code.filter((part) => joined(part.name) > 0); left.length > 0; ) {
		// Of two parts used as much, the one that uses fewer others is the one the rest stands on. A stable sort keeps
		// the level's own order after that.
		const [heart] = [...left].sort((a, b) => used(b.name) - used(a.name) || uses(a.name) - uses(b.name))
		if (!heart) break
		const queue = [heart.name]
		seen.add(heart.name)
		for (const name of queue) {
			stops.push(
				stopOf(
					code.find((part) => part.name === name),
					name === heart.name ? 'heart' : 'outward',
				),
			)
			for (const arrow of links) {
				const other = arrow.from === name ? arrow.to : arrow.to === name ? arrow.from : null
				if (other === null || seen.has(other)) continue
				seen.add(other)
				queue.push(other)
			}
		}
		left = left.filter((part) => !seen.has(part.name))
	}
	const aside = code.filter((part) => joined(part.name) === 0).map((part) => stopOf(part, 'aside'))
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
