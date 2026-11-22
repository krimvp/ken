import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { type Chat, type ModelFlags, type ModelUnset, readModelConfig, startChat } from '../agent/index.ts'
import { type History, kenHome, openHistory } from '../history/index.ts'
import type { LayoutSources } from '../layout/index.ts'
import { openSnapshots } from '../live/index.ts'
import {
	openMap,
	openNotes,
	openPrefs,
	openSeen,
	type ReaderNotes,
	type ReaderPrefs,
	type ReaderSeen,
	type UnderstandingMap,
} from '../map/index.ts'
import { fileRecordStore, type RecordStore } from '../record/index.ts'
import { findRoot, gitRepository, type Repository } from '../repo/index.ts'
import { projectSessions } from '../transcripts/index.ts'
import { conceptReads } from './concepts/brief.ts'
import { layerPlan } from './concepts/layers.ts'
import { type LiveRunner, liveRunner } from './live-runner.ts'
import { type DeskChats, questionDesk } from './question-desk.ts'

// What "ken open" and "ken live" share for one project: its git, the reader's history, map and notes, the lines on what
// they looked at, how much text they chose, the record, what the layout reads, the chat when a model is set, the desk that runs one model call at a time, and live mode, which writes
// its notes in a chat of its own. live is null without a model. shown is the folder as the reader would type it, and
// name what the page calls the project.
export type KenProject = {
	root: string
	shown: string
	name: string
	repo: Repository
	history: History
	record: RecordStore
	map: UnderstandingMap
	readerNotes: ReaderNotes
	seen: ReaderSeen
	prefs: ReaderPrefs
	layout: LayoutSources
	concepts: ReturnType<typeof conceptReads>
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
	const noted = await openNotes(home, repo)
	if (noted.kind !== 'ok') throw new Error(`${root} has a history but no first commit`)
	const readerNotes = noted.notes
	const looked = await openSeen(home, repo)
	if (looked.kind !== 'ok') throw new Error(`${root} has a history but no first commit`)
	const { seen } = looked
	const chosen = await openPrefs(home, repo)
	if (chosen.kind !== 'ok') throw new Error(`${root} has a history but no first commit`)
	const { prefs } = chosen
	const store = await openSnapshots(home, repo, root)
	const config = readModelConfig(options.flags, options.env)
	let model: KenProject['model']
	let notes: Chat | null = null
	let chats: DeskChats = null
	const parallel = parallelOf(options.env.KEN_PARALLEL)
	if (parallel === null) return { kind: 'refused', message: 'Set KEN_PARALLEL to a whole number from 1 to 16.' }
	if (config.kind === 'ok') {
		const reader = { map, notes: readerNotes, prefs }
		const chat = { directory: root, model: config.config, env: options.env, reader, snapshots: store.objects }
		const asks = { ...chat, reader: { ...reader, readSaved: history.readSaved } }
		const [started, forNotes, own] = await Promise.all([
			startChat(asks),
			startChat(chat),
			startChat({ ...asks, thread: false }),
		])
		if (started.kind !== 'ok') return { kind: 'refused', message: started.message }
		if (forNotes.kind !== 'ok') return { kind: 'refused', message: forNotes.message }
		if (own.kind !== 'ok') return { kind: 'refused', message: own.message }
		model = { kind: 'ok', chat: started.chat, name: config.config.model }
		notes = forNotes.chat
		chats = { reader: started.chat, ken: own.chat }
	} else {
		model = config
	}
	const withSnapshots = gitRepository(root, { alternate: store.objects })
	const layout = { root, repo: withSnapshots, snapshots: store, record, map, seen }
	const concepts = conceptReads(layout, history)
	const plan = layerPlan(layout, concepts, seen)
	const background = options.env.KEN_BACKGROUND !== 'off'
	const desk = questionDesk(history, record, repo, map, layout, concepts, { plan, chats, parallel, background })
	const live = notes && liveRunner({ root, project: repo, withSnapshots, store, sessions, desk, chat: notes })
	const shown = root.startsWith(`${homedir()}${path.sep}`) ? `~${root.slice(homedir().length)}` : root

	async function close() {
		await live?.off()
		await desk.close()
		await Promise.all([chats?.reader.close(), chats?.ken.close(), notes?.close()])
	}

	return {
		kind: 'ok',
		project: {
			root,
			shown,
			name: await nameOf(root),
			repo,
			history,
			record,
			map,
			readerNotes,
			seen,
			prefs,
			layout,
			concepts,
			model,
			desk,
			live,
			close,
		},
	}
}

// KEN_PARALLEL is how many model runs go at once. The local endpoint answers one request at a time, so 1 unless set.
function parallelOf(value: string | undefined): number | null {
	if (value === undefined || value === '') return 1
	const n = Number(value)
	return Number.isInteger(n) && n >= 1 && n <= 16 ? n : null
}

// The project's own name: the one its package.json gives it, else the name of its folder. ken's model reads the same
// file, so the sentence it writes on the project and the page call the project the same thing.
async function nameOf(root: string): Promise<string> {
	try {
		const manifest: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
		if (typeof manifest === 'object' && manifest !== null && 'name' in manifest) {
			if (typeof manifest.name === 'string' && manifest.name !== '') return manifest.name
		}
	} catch {
		// No package.json, or one that does not parse: the folder names the project.
	}
	return path.basename(root)
}
