import { claudeCodeTranscripts } from './claude-code.ts'
import type { Transcripts } from './transcripts.ts'

// The saved sessions ken reads for a project: Claude Code's, the one tool ken reads today, or none when the owner set
// KEN_SESSIONS=off. Reading is on by default, and finds nothing where no session was saved.
export function projectSessions(root: string, env: Record<string, string | undefined>): Transcripts | null {
	return env.KEN_SESSIONS?.trim().toLowerCase() === 'off' ? null : claudeCodeTranscripts(root, env)
}
