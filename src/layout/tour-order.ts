// The order of a tour of one named level. ken's model lists a level's parts in the order a newcomer should read
// them, the heart of the product first, and that list is checked data in the record, so the tour follows it. Plain
// code only moves the parts that support the code (tests, build scripts, vendored code, upkeep) to the end. No rule
// over the arrows finds the heart: the most used part is often a small utility, and the part with the most arrows is
// often a consumer. The same level always gives the same order.

export type TourPart = { name: string; job: string | null; paths: string[] }
export type TourStop = { name: string; job: string; paths: string[] }

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

export function tourOrder(parts: TourPart[]): TourStop[] {
	const support = parts.filter(isSupport)
	return [...parts.filter((part) => !support.includes(part)), ...support].map((part) => ({
		name: part.name,
		job: part.job ?? '',
		paths: part.paths,
	}))
}

function isSupport(part: TourPart): boolean {
	const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_.-]+/)
	const said = [...words(part.name), ...words(part.job ?? '').slice(0, 1)].some((word) => SUPPORT_WORDS.has(word))
	const placed = part.paths.every((place) => place.split('/').some((segment) => SUPPORT_WORDS.has(segment)))
	return said || (part.paths.length > 0 && placed)
}
