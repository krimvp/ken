import { homedir } from 'node:os'
import path from 'node:path'
import { type Chat, type ModelFlags, type ModelUnset, readModelConfig, startChat } from '../agent/index.ts'
import { type History, kenHome, openHistory } from '../history/index.ts'
import type { LayoutSources } from '../layout/index.ts'
import { openSnapshots } from '../live/index.ts'
import { openMap, type UnderstandingMap } from '../map/index.ts'
import { fileRecordStore, type RecordStore } from '../record/index.ts'
import { findRoot, gitRepository, type Repository } from '../repo/index.ts'
import { projectSessions } from '../transcripts/index.ts'
import { type LiveRunner, liveRunner } from './live-runner.ts'
import { questionDesk } from './question-desk.ts'

// What "ken open" and "ken live" share for one project: its git, the reader's history and map, the record, what the
// layout reads, the chat when a model is set, the desk that runs one model call at a time, and live mode, which writes
// its notes in a chat of its own. live is null without a model.
export type KenProject = {
	root: string
	shown: string
	repo: Repository
	history: History
	record: RecordStore
	map: UnderstandingMap
	layout: LayoutSources
	model: { kind: 'ok'; chat: Chat; name: string } | ModelUnset
	desk: ReturnType<typeof questionDesk>
	live: LiveRunner | null
	close(): Promise<void>
}

export async function openProject(options: {
	directory: string
	flags: ModelFlags
	env: Record<string, string | undefined>
}): Promise<{ kind: 'ok'; project: KenProject } | { kind: 'refused'; message: string }> {
	const found = await findRoot(options.directory)
	if (found.kind !== 'ok') return { kind: 'refused', message: `${options.directory} is not inside a git repository.` }
	const { root } = found
	const repo = gitRepository(root)
	const home = kenHome(options.env)
	const sessions = projectSessions(root, options.env)
	// With the saved sessions, so the answer to a decision whose reason quotes one passes the gate again.
	const record = fileRecordStore(root, repo, sessions)
	const opened = await openHistory(home, repo, record)
	if (opened.kind !== 'ok') {
		return { kind: 'refused', message: `${root} has no commits yet, so ken has nothing to read.` }
	}
	const { history } = opened
	const mapped = await openMap(home, repo, record)
	if (mapped.kind !== 'ok') throw new Error(`${root} has a history but no first commit`)
	const { map } = mapped
	const store = await openSnapshots(home, repo, root)
	const config = readModelConfig(options.flags, options.env)
	let model: KenProject['model']
	let notes: Chat | null = null
	if (config.kind === 'ok') {
		const chat = { directory: root, model: config.config, env: options.env, map, snapshots: store.objects }
		const [started, forNotes] = await Promise.all([startChat(chat), startChat(chat)])
		if (started.kind !== 'ok') return { kind: 'refused', message: started.message }
		if (forNotes.kind !== 'ok') return { kind: 'refused', message: forNotes.message }
		model = { kind: 'ok', chat: started.chat, name: config.config.model }
		notes = forNotes.chat
	} else {
		model = config
	}
	const desk = questionDesk(history, record, repo, map)
	const withSnapshots = gitRepository(root, { alternate: store.objects })
	const live = notes && liveRunner({ root, project: repo, withSnapshots, store, sessions, desk, chat: notes })
	const shown = root.startsWith(`${homedir()}${path.sep}`) ? `~${root.slice(homedir().length)}` : root

	async function close() {
		await live?.off()
		await desk.settled()
		if (model.kind === 'ok') await model.chat.close()
		await notes?.close()
	}

	const layout = { root, repo: withSnapshots, snapshots: store, record, map }
	return { kind: 'ok', project: { root, shown, repo, history, record, map, layout, model, desk, live, close } }
}
