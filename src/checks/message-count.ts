// Which commit messages of a change the answer quotes. A message holds the reasons and the choices left for later that
// no line of code shows, so ken tells the agent and the reader which messages no quote cites. A merge is left out,
// because the tool that merged it wrote its message.
import type { Commit, CommitHash } from '../repo/index.ts'
import type { VerifiedGitQuote } from './quote-check.ts'

export type MessageCount = { quoted: CommitHash[]; unquoted: CommitHash[] }

export function countMessages(commits: Commit[], quotes: VerifiedGitQuote[]): MessageCount {
	const cited = new Set<string>(quotes.flatMap((quote) => (quote.path === null ? [quote.commit] : [])))
	const own = commits.filter((commit) => commit.parents.length < 2).map((commit) => commit.hash)
	return { quoted: own.filter((hash) => cited.has(hash)), unquoted: own.filter((hash) => !cited.has(hash)) }
}
