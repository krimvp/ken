import type { VerifiedGitQuote } from '../checks/index.ts'
import { deployFacts } from '../diagram/index.ts'
import type { CommitHash, Repository } from '../repo/index.ts'
import { type Language, languagesOf } from './languages.ts'
import { type EntryPoint, readManifests, type Said } from './manifests.ts'
import { readmeAbout } from './readme.ts'

// A file that says how the project is deployed, and what ken read in it: "2 services", "Deployment orders", or that
// it is a template ken does not read.
export type DeployFile = { file: string; holds: string }

// The commits on the main line in the last days, by how many people, and when the newest landed.
export type Activity = { days: number; commits: number; authors: number; last: string | null }

// about is the README's first paragraph, a quote ken found in git. Each fact is null or empty where the project does
// not say it.
export type FirstLook = {
	head: CommitHash
	name: Said | null
	description: Said | null
	about: VerifiedGitQuote | null
	size: { files: number; lines: number }
	languages: Language[]
	entries: EntryPoint[]
	deploy: DeployFile[]
	activity: Activity
}

// The lines of each text file, and the paths each recent commit touched, so any folder can be sized from them.
export type Sizes = { lines: Map<string, number>; recent: string[][] }

export const RECENT_DAYS = 30
const DAY = 86_400_000
// The main line is read this far back for the recent commits.
const MOST_COMMITS = 500
// ken's own record is not the project's code.
const RECORD = /^\.ken(\/|$)/

export async function readFirstLook(
	repo: Repository,
	head: CommitHash,
	now: Date,
): Promise<{ look: FirstLook; sizes: Sizes }> {
	const [listed, counted, line] = await Promise.all([
		repo.listFiles(head),
		repo.lineCounts(head),
		repo.mainLine(head, MOST_COMMITS),
	])
	const files = (listed.kind === 'ok' ? listed.paths : []).filter((file) => !RECORD.test(file))
	const lines = new Map([...(counted.kind === 'ok' ? counted.lines : [])].filter(([file]) => !RECORD.test(file)))
	const since = now.getTime() - RECENT_DAYS * DAY
	const recentCommits = (line.kind === 'ok' ? line.commits : []).filter((each) => Date.parse(each.date) >= since)
	const [manifests, about, deploy] = await Promise.all([
		readManifests(repo, head, new Set(files)),
		readmeAbout(repo, head, files),
		deployFiles(repo, head),
	])
	const look = {
		head,
		...manifests,
		about,
		size: { files: files.length, lines: [...lines.values()].reduce((sum, each) => sum + each, 0) },
		languages: languagesOf(lines),
		deploy,
		activity: {
			days: RECENT_DAYS,
			commits: recentCommits.length,
			authors: new Set(recentCommits.map((each) => each.email.toLowerCase())).size,
			last: line.kind === 'ok' ? (line.commits[0]?.date ?? null) : null,
		},
	}
	return { look, sizes: { lines, recent: recentCommits.map((each) => each.paths) } }
}

// The lines under the paths, and how many recent commits touched a file there.
export function sizeOf(sizes: Sizes, paths: string[]): { lines: number; commits: number } {
	const under = (file: string) => paths.some((place) => file === place || file.startsWith(`${place}/`))
	const lines = [...sizes.lines].reduce((total, [file, n]) => total + (under(file) ? n : 0), 0)
	return { lines, commits: sizes.recent.filter((touched) => touched.some(under)).length }
}

// A compose file is one entry, and the Kubernetes manifests of one folder are one entry, so a project with a manifest
// per service still reads in a line or two.
async function deployFiles(repo: Repository, head: CommitHash): Promise<DeployFile[]> {
	const facts = await deployFacts(repo, head)
	const grouped = new Map<string, { names: string[]; files: Set<string>; compose: boolean }>()
	for (const each of facts.workloads) {
		const compose = each.kind === 'service'
		const key = compose ? each.file : each.file.slice(0, each.file.lastIndexOf('/') + 1)
		const group = grouped.get(key) ?? { names: [], files: new Set(), compose }
		grouped.set(key, { ...group, names: [...group.names, each.name], files: group.files.add(each.file) })
	}
	const listed = (names: string[]) =>
		names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
	return [
		...[...grouped].map(([file, { names, files, compose }]) => {
			const what = `${compose ? 'service' : 'Kubernetes workload'}${names.length === 1 ? '' : 's'}`
			const where = compose || files.size === 1 ? '' : ` in ${files.size} files`
			return { file: file === '' ? './' : file, holds: `${names.length} ${what}${where}: ${listed(names)}` }
		}),
		...facts.dockerfiles.map((file) => ({ file, holds: 'how an image is built' })),
		...facts.unread.map((each) => {
			const cut = each.lastIndexOf(' (')
			return { file: each.slice(0, cut), holds: `${each.slice(cut + 2, -1)} ken does not read` }
		}),
	]
}
