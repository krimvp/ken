import path from 'node:path'
import type { RepoPath } from '../repo/index.ts'

// A box before git marks it: its name, its paths, and how many files sit under them.
export type Seed = { name: string; paths: RepoPath[]; files: number }

// A level holds at most this many boxes, as the plan's layout does.
export const MAX_BOXES = 6

// The boxes of a scope that nobody drew, from the files at one commit. A scope of one folder splits by its next path
// segment: each folder is a box, and the files that sit right in the folder share one box, unless there are only
// files. A scope of many paths, such as an "N more folders" box, splits into those paths. With more than MAX_BOXES,
// the largest by file count stay and the rest share one "N more" box, so no path is left out.
export function splitScope(files: string[], scope: RepoPath[]): Seed[] {
	const [only] = scope
	const base =
		scope.length === 1 && only !== undefined && files.some((file) => file.startsWith(`${only}/`)) ? only : null
	if (base === null && scope.length > 0) {
		const seeds = scope.map((each) => ({
			name: path.posix.basename(each),
			paths: [each],
			files: countUnder(files, [each]),
		}))
		const allFiles = scope.every((each) => files.includes(each))
		const allFolders = !scope.some((each) => files.includes(each))
		return fit(seeds, allFiles ? 'files' : allFolders ? 'folders' : null)
	}
	const prefix = base === null ? '' : `${base}/`
	const folders = new Map<string, number>()
	const here: string[] = []
	for (const file of files) {
		if (!file.startsWith(prefix)) continue
		const [first = '', ...rest] = file.slice(prefix.length).split('/')
		if (rest.length === 0) here.push(file)
		else folders.set(first, (folders.get(first) ?? 0) + 1)
	}
	const folderSeeds = [...folders].map(([name, count]) => ({
		name,
		paths: [`${prefix}${name}` as RepoPath],
		files: count,
	}))
	if (folderSeeds.length === 0) {
		return fit(
			here.map((file) => ({ name: path.posix.basename(file), paths: [file as RepoPath], files: 1 })),
			'files',
		)
	}
	if (here.length === 0) return fit(folderSeeds, 'folders')
	const name = base === null ? 'Files at the top' : `Files directly in ${path.posix.basename(base)}`
	return [...fit(folderSeeds, 'folders', MAX_BOXES - 1), { name, paths: here as RepoPath[], files: here.length }]
}

export function under(file: string, place: string): boolean {
	return file === place || file.startsWith(`${place}/`)
}

function countUnder(files: string[], places: string[]): number {
	return files.filter((file) => places.some((place) => under(file, place))).length
}

// noun names what the "N more" box holds, or is null when it holds folders and files both.
function fit(seeds: Seed[], noun: 'files' | 'folders' | null, room = MAX_BOXES): Seed[] {
	const ranked = seeds.toSorted((a, b) => b.files - a.files || a.name.localeCompare(b.name))
	if (ranked.length <= room) return ranked
	const kept = ranked.slice(0, room - 1)
	const rest = ranked.slice(room - 1)
	const more = {
		name: noun === null ? `${rest.length} more` : `${rest.length} more ${noun}`,
		paths: rest.flatMap((seed) => seed.paths),
		files: rest.reduce((sum, seed) => sum + seed.files, 0),
	}
	return [...kept, more]
}
