import type { Commit, Repository, Uncommitted } from '../repo/index.ts'
import type { Transcripts } from '../transcripts/index.ts'

// What the owner sees first in live mode, read from git and the newest saved session with no model: the branch, the
// uncommitted files with their changed lines, the last commits, and what the owner last asked their agent. moreFiles
// counts the uncommitted files past the first NOW_FILES.
export type NowBlock = {
	branch: string | null
	files: Uncommitted[]
	moreFiles: number
	commits: Commit[]
	ask: LastAsk
}

// asked: the last thing the person typed in the newest session, cut to ASK_LINES lines and ASK_CHARS characters, after
// the session reader hid what looks like a secret. Tool output never comes here. off: the owner turned sessions off.
export type LastAsk =
	| { kind: 'asked'; session: string; at: string; text: string; cut: boolean }
	| { kind: 'none' }
	| { kind: 'off' }

const NOW_FILES = 12
const NOW_COMMITS = 3
const ASK_LINES = 2
const ASK_CHARS = 240

export async function nowBlock(repo: Repository, ask: LastAsk, signal?: AbortSignal): Promise<NowBlock> {
	const head = await repo.resolve('HEAD', signal)
	const [branch, listed, line] = await Promise.all([
		repo.branch(signal),
		repo.uncommitted(signal),
		head.kind === 'ok' ? repo.mainLine(head.commit, NOW_COMMITS, signal) : null,
	])
	const files = listed.kind === 'ok' ? listed.files : []
	return {
		branch,
		files: files.slice(0, NOW_FILES),
		moreFiles: Math.max(0, files.length - NOW_FILES),
		commits: line?.kind === 'ok' ? line.commits : [],
		ask,
	}
}

export async function lastAsk(sessions: Transcripts | null, signal?: AbortSignal): Promise<LastAsk> {
	if (sessions === null) return { kind: 'off' }
	const newest = await sessions.latest()
	const read = newest && (await sessions.session(newest.id, signal))
	const asked = read?.entries.findLast((entry) => entry.kind === 'user')
	if (!read || asked?.kind !== 'user') return { kind: 'none' }
	const lines = asked.text.trim().split('\n')
	const kept = lines.slice(0, ASK_LINES).join('\n')
	const text = kept.length > ASK_CHARS ? `${kept.slice(0, ASK_CHARS).trimEnd()}...` : kept
	const cut = lines.length > ASK_LINES || kept.length > ASK_CHARS || asked.cut > 0
	return { kind: 'asked', session: read.session.id, at: asked.at, text, cut }
}
