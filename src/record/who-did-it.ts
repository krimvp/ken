import type { Commit } from '../repo/index.ts'
import type { Who } from './entry.ts'

// Words that mark a coding agent in an author's name or email, or in a Co-authored-by trailer.
const AGENT_MARKS = /\b(claude|anthropic|codex|openai|copilot|cursor|devin|aider|gemini|openhands)\b/i

// The plan: git tells the owner from a collaborator, and cannot always tell the owner from the owner's agent. So a
// commit in the owner's name with no sign of an agent is "unknown", never "owner": an agent may have made it without
// a trailer. A collaborator's commit stays the collaborator's, whatever tool they used.
export function whoDidIt(commit: Commit, userEmail: string | null): Who {
	if (userEmail === null) return 'unknown'
	const agentAuthor = AGENT_MARKS.test(`${commit.author} ${commit.email}`)
	const agentHelped = agentAuthor || commit.coAuthors.some((coAuthor) => AGENT_MARKS.test(coAuthor))
	if (commit.email.toLowerCase() === userEmail.toLowerCase()) return agentHelped ? 'owner-agent' : 'unknown'
	// An agent that commits under its own name could be working for anyone.
	if (agentAuthor) return 'unknown'
	return 'collaborator'
}
