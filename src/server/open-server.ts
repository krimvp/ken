import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { MODEL_EXAMPLE, type ModelFlags } from '../agent/index.ts'
import { layoutDraft } from '../diagram/index.ts'
import { readFirstLook, sizeOf } from '../first-look/index.ts'
import { authorsOf, decide, openItems, sinceChoices, timeRange } from '../follow-up/index.ts'
import { readerQuestions } from '../history/index.ts'
import type { JobView, Left } from '../jobs/index.ts'
import {
	type ChangeChoice,
	changeChoices,
	type LayoutAsk,
	LEVELS,
	lookAtLayout,
	pictureBefore,
	readLayoutAsk,
} from '../layout/index.ts'
import { type MapSignal, prefsOf, TEXT_PREFS } from '../map/index.ts'
import { MERMAID_FILE, PAGE_FOLDER } from '../page/index.ts'
import { OUTCOMES } from '../record/index.ts'
import type { CommitHash } from '../repo/index.ts'
import { decisionRows } from './decision-list.ts'
import { readChangeDiff } from './http/change-diff.ts'
import { readSource } from './http/file-source.ts'
import { refusal } from './http/guard-request.ts'
import { type PageFile, readPageFiles } from './http/page-files.ts'
import { openProject } from './ken-project.ts'
import { fieldOf, type QuestionLine } from './question-desk.ts'
import { readLooked } from './reader/read-looked.ts'
import { lastVisit, readerView } from './reader/reader-view.ts'
import { TIMELINE_DAYS, timelineOf } from './timeline.ts'
import { suggestWayIn } from './way-in.ts'

// model is the name of the model the page asks, or null when none is set and the page can only show earlier answers.
export type KenServer = { url: string; root: string; model: string | null; live: boolean; close(): Promise<void> }

const MAX_BODY_BYTES = 64 * 1024
// The person lens offers the authors of this many days.
const RECENT_DAYS = 90
// Mermaid puts a <style> element and style attributes in every drawing it makes, so styles may be inline. Nothing else
// is widened: scripts, images, fonts and requests still come only from this server, so a style cannot fetch anything
// from another host.
const HEADERS = {
	'cache-control': 'no-store',
	'x-content-type-options': 'nosniff',
	'content-security-policy':
		"default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

// What the page may ask live mode to do.
const LIVE_ACTIONS = ['on', 'off', 'pause', 'resume', 'note-now'] as const

// live starts live mode with the server, as "ken open --live" does.
export async function openServer(options: {
	directory: string
	flags: ModelFlags
	env: Record<string, string | undefined>
	port: number
	live?: boolean
}): Promise<{ kind: 'ok'; server: KenServer } | { kind: 'refused'; message: string }> {
	const opened = await openProject(options)
	if (opened.kind !== 'ok') return opened
	const { project } = opened
	const { root, shown, repo, history, record, map, readerNotes, seen, prefs, layout, model, desk, live } = project
	const reads = project.concepts
	if (options.live && !live) {
		await project.close()
		return {
			kind: 'refused',
			message: `Live mode writes notes with a model, and none is set. ${model.kind === 'ok' ? '' : model.message}`,
		}
	}
	const openNow = async () => openItems(repo, await record.read(), (await map.read(new Date())).states)
	const files = await readPageFiles(PAGE_FOLDER, { '/mermaid.min.js': MERMAID_FILE })
	let port = 0
	// What plain code says of the project is read once for each HEAD, as every level and Home ask for it.
	let firstLook: { head: CommitHash; read: ReturnType<typeof readFirstLook> } | null = null
	function firstLookAt(head: CommitHash) {
		if (firstLook?.head !== head) firstLook = { head, read: readFirstLook(repo, head, new Date()) }
		return firstLook.read
	}

	// What landed since the reader last looked leads the changes the page offers, so catching up is one pick away.
	// levels are the words for what ken thinks the reader knows of a box, weakest first.
	async function layoutView(ask: LayoutAsk) {
		const now = new Date()
		const questions = readerQuestions(await history.list())
		const visit = lastVisit((await seen.read()).lines, now)
		const [look, since, choices] = await Promise.all([
			lookAtLayout(layout, ask, now),
			sinceChoices(repo, questions, visit, now),
			changeChoices(layout),
		])
		const changes: ChangeChoice[] = [...since.map((each) => each.choice), ...choices]
		// The way in is suggested from the top level at HEAD, which is often the level asked.
		const { own } = ask
		const isTop = ask.within.length === 0 && ask.change === null && ask.at === look.head
		const top = isTop ? look : await lookAtLayout(layout, { at: look.head, within: [], change: null, own }, now)
		const [wayIn, told, { sizes }] = await Promise.all([
			suggestWayIn(layout, { questions, visit, spans: since, own, top }, now),
			reads.levelTold(look),
			firstLookAt(look.head),
		])
		// How many parts ken's model explained, and for a part that is one file, its lines and what the model said of it.
		// size is the lines under a box and the recent commits that touched them, at HEAD only.
		const boxes = look.boxes.map((box) => {
			const file = told.files.find((each) => each.name === box.name)
			const size = look.at === look.head ? sizeOf(sizes, box.paths) : null
			return file ? { ...box, size, lines: file.lines, told: file.line } : { ...box, size }
		})
		return { look: { ...look, boxes, explained: told.explained.length }, changes, wayIn, levels: LEVELS }
	}

	async function route(request: IncomingMessage, response: ServerResponse) {
		const problem = refusal(request, port)
		if (problem) return sendJson(response, 403, { message: problem })
		const url = new URL(request.url ?? '/', 'http://ken.invalid')
		const where = `${request.method} ${url.pathname}`
		if (where === 'GET /api/state') {
			// thread is the chat a question asked now joins, so the page shows it in the thread it belongs to.
			const state =
				model.kind === 'ok'
					? { kind: 'ok', name: model.name, thread: model.chat.thread }
					: { kind: 'unset', message: model.message, missing: model.missing, example: MODEL_EXAMPLE }
			// parts are the top level's parts in order with their paths, so the page colours each part, and the things in
			// it, from its first paint. named says ken's model named them, so the first visit can offer a tour.
			const top = await readLayoutAsk(layout, { change: 'none' }, new Date())
			const look = top.kind === 'ok' ? await lookAtLayout(layout, top.ask, new Date()) : null
			const parts = look?.boxes.map(({ name, paths }) => ({ name, paths })) ?? []
			const named = Boolean(look?.named)
			const on = live?.on() ?? false
			return sendJson(response, 200, { project: shown, name: project.name, model: state, live: on, parts, named })
		}
		if (where === 'GET /api/first-look') {
			const head = await repo.resolve('HEAD')
			if (head.kind !== 'ok') return sendJson(response, 404, { message: 'The project has no commit yet.' })
			return sendJson(response, 200, (await firstLookAt(head.commit)).look)
		}
		if (where === 'GET /api/questions') return sendJson(response, 200, { questions: await desk.rows() })
		if (where === 'GET /api/live') {
			if (!live) return sendJson(response, 503, { message: model.kind === 'ok' ? '' : model.message })
			return sendJson(response, 200, await live.view())
		}
		if (where === 'POST /api/live') {
			if (!live) return sendJson(response, 503, { message: model.kind === 'ok' ? '' : model.message })
			const body = await readJson(request)
			const action = LIVE_ACTIONS.find((each) => body.kind === 'ok' && each === fieldOf(body.value, 'action'))
			if (!action) return sendJson(response, 400, { message: `Send an action: ${LIVE_ACTIONS.join(', ')}.` })
			if (action === 'on') await live.start()
			if (action === 'off') await live.off()
			if (action === 'pause') live.pause()
			if (action === 'resume') live.resume()
			if (action === 'note-now') live.noteNow()
			return sendJson(response, 200, await live.view())
		}
		if (where === 'GET /api/jobs') {
			// One line with every job, then one each time a job changes, until the page goes away.
			response.writeHead(200, { ...HEADERS, 'content-type': 'application/x-ndjson; charset=utf-8' })
			response.flushHeaders()
			writeLine(response, { jobs: desk.jobs(), left: desk.left() })
			const off = desk.subscribe((jobs) => writeLine(response, { jobs, left: desk.left() }))
			response.on('close', off)
			return
		}
		if (where === 'POST /api/jobs') {
			const body = await readJson(request)
			const looking = body.kind === 'ok' ? lookingOf(fieldOf(body.value, 'looking')) : null
			const stop = body.kind === 'ok' ? fieldOf(body.value, 'stop') : undefined
			if (typeof stop === 'string') desk.stop(stop)
			else if (looking) desk.look(looking)
			else {
				const message = 'Send looking, with the open brief and the level on the canvas, or the key of a job to stop.'
				return sendJson(response, 400, { message })
			}
			return sendJson(response, 200, { jobs: desk.jobs(), left: desk.left() })
		}
		if (where === 'GET /api/decisions') return sendJson(response, 200, { decisions: decisionRows(await record.read()) })
		if (where === 'GET /api/map') return sendJson(response, 200, { file: map.file, ...(await map.read(new Date())) })
		if (where === 'POST /api/map') {
			const body = await readJson(request)
			const signal = body.kind === 'ok' ? mapSignalOf(body.value) : body
			if (signal.kind !== 'ok') return sendJson(response, 400, { message: signal.problem })
			const states = await map.learn(signal.signal, signal.topics, new Date())
			return sendJson(response, 200, { states })
		}
		if (where === 'POST /api/seen') {
			const body = await readJson(request)
			const looked = body.kind === 'ok' ? await readLooked(layout.repo, body.value) : body
			if (looked.kind === 'refused') return sendJson(response, 400, { message: looked.problem })
			const added =
				looked.kind === 'undo'
					? await seen.undo(looked.at, looked.head, new Date())
					: await seen.add(looked.looked, looked.head, new Date())
			if (added === 'missing') return sendJson(response, 400, { message: 'ken wrote no line at that moment.' })
			return sendJson(response, 200, { written: added === 'written' })
		}
		if (where === 'GET /api/reader') {
			const now = new Date()
			const top = await readLayoutAsk(layout, { change: 'none' }, now)
			const [look, looked, mapped, read] = await Promise.all([
				top.kind === 'ok' ? lookAtLayout(layout, top.ask, now) : null,
				seen.read(),
				map.read(now),
				record.read(),
			])
			const topics = read.current.flatMap((entry) => (entry.kind === 'topic' ? [entry] : []))
			return sendJson(response, 200, readerView(seen.file, looked, mapped, topics, look?.boxes ?? [], now))
		}
		if (where === 'GET /api/notes') return sendJson(response, 200, { notes: await readerNotes.read() })
		if (where === 'POST /api/notes') {
			const body = await readJson(request)
			const id = body.kind === 'ok' ? fieldOf(body.value, 'remove') : undefined
			const text = body.kind === 'ok' ? fieldOf(body.value, 'text') : undefined
			if (typeof id === 'string' && text === undefined) {
				return sendJson(response, 200, { notes: await readerNotes.remove(id, new Date()) })
			}
			if (typeof text === 'string' && id === undefined) {
				const kept = await readerNotes.add(text, new Date(), 'reader')
				return kept.kind === 'kept'
					? sendJson(response, 200, { notes: kept.notes })
					: sendJson(response, 400, { message: kept.problem })
			}
			return sendJson(response, 400, { message: 'Send the text of one note or the id of the note to remove.' })
		}
		if (where === 'GET /api/open') return sendJson(response, 200, await openNow())
		if (where === 'GET /api/layout') {
			const { searchParams: query } = url
			const raw = {
				at: query.get('at') ?? undefined,
				within: query.getAll('within'),
				change: query.get('change') ?? undefined,
			}
			const ask = await readLayoutAsk(layout, raw, new Date())
			if (ask.kind !== 'ok') return sendJson(response, 400, { message: ask.message, field: ask.field })
			return sendJson(response, 200, await layoutView(ask.ask))
		}
		if (where === 'GET /api/source') {
			const { status, body } = await readSource(repo, url.searchParams)
			return sendJson(response, status, body)
		}
		if (where === 'GET /api/brief') {
			const brief = await reads.brief(url.searchParams.get('concept') ?? '', new Date())
			if (!brief) return sendJson(response, 404, { message: 'ken has no such concept in this project.' })
			return sendJson(response, 200, brief)
		}
		if (where === 'GET /api/concepts') return sendJson(response, 200, await reads.concepts(new Date()))
		if (where === 'GET /api/processes') {
			const found = await reads.processes(url.searchParams.getAll('within'), new Date())
			if (!found) return sendJson(response, 400, { message: 'Send within: the paths of a level of this project.' })
			return sendJson(response, 200, found)
		}
		if (where === 'GET /api/timeline') {
			const { fewest, most, unasked } = TIMELINE_DAYS
			const days = Number(url.searchParams.get('days') ?? unasked)
			if (!Number.isInteger(days) || days < fewest || days > most) {
				return sendJson(response, 400, { message: `Send days: a whole number from ${fewest} to ${most}.` })
			}
			const now = new Date()
			const landed = await timelineOf(repo, days, now)
			if (landed.kind !== 'ok') {
				return sendJson(response, 400, { message: 'That span holds too many commits to read. Ask for fewer days.' })
			}
			return sendJson(response, 200, {
				days: landed.days,
				lastVisit: lastVisit((await seen.read()).lines, now)?.at ?? null,
			})
		}
		if (where === 'GET /api/prefs') return sendJson(response, 200, await prefs.read())
		if (where === 'POST /api/prefs') {
			const body = await readJson(request)
			const chosen = body.kind === 'ok' ? prefsOf(body.value) : null
			if (!chosen) return sendJson(response, 400, { message: `Send text: one of ${TEXT_PREFS.join(', ')}.` })
			return sendJson(response, 200, await prefs.write(chosen))
		}
		if (where === 'GET /api/change/diff') {
			const { status, body } = await readChangeDiff(layout, url.searchParams)
			return sendJson(response, status, body)
		}
		if (where === 'POST /api/layout/back') {
			const body = await readJson(request)
			if (body.kind !== 'ok') return sendJson(response, 400, { message: body.problem })
			const within = fieldOf(body.value, 'within')
			if (!Array.isArray(within) || !within.every((each) => typeof each === 'string')) {
				return sendJson(response, 400, { message: 'Send within: the paths of the level, as a list.' })
			}
			const ask = await readLayoutAsk(layout, { within, change: 'none' }, new Date())
			if (ask.kind !== 'ok') return sendJson(response, 400, { message: ask.message, field: ask.field })
			const pictures = pictureBefore((await record.read()).entries, ask.ask.within)
			if (!pictures) {
				return sendJson(response, 409, { message: 'ken has no earlier picture of this level to go back to.' })
			}
			// A copy of the earlier picture, written as the newest: the record only grows, and the newest picture shows.
			const copy = { kind: 'layout' as const, ...layoutDraft(pictures.before), replaces: pictures.shown.id }
			const appended = await record.append([copy])
			if (appended.kind === 'refused') {
				const message = `ken could not bring the earlier picture back: ${appended.problems.join(' ')}`
				return sendJson(response, 409, { message })
			}
			return sendJson(response, 200, await layoutView(ask.ask))
		}
		if (where === 'GET /api/authors') {
			const recent = await timeRange(repo, { kind: 'days', days: RECENT_DAYS }, new Date())
			const commits = recent.kind === 'ok' ? recent.range.commits : []
			return sendJson(response, 200, { days: RECENT_DAYS, authors: authorsOf(commits, await repo.userEmail()) })
		}
		if (where === 'POST /api/decided') {
			const body = await readJson(request)
			if (body.kind !== 'ok') return sendJson(response, 400, { message: body.problem })
			// Only the decision's id, the outcome and the note are read: ken copies the rest from the record.
			const id = fieldOf(body.value, 'decision')
			const note = fieldOf(body.value, 'note') ?? ''
			const outcome = OUTCOMES.find((each) => each === fieldOf(body.value, 'outcome'))
			if (typeof id !== 'string' || typeof note !== 'string' || outcome === undefined) {
				return sendJson(response, 400, {
					message: `Send the id of the decision, an outcome (${OUTCOMES.join(' or ')}), and a note as text.`,
				})
			}
			const decided = await decide(record, { id, note, outcome, now: new Date() })
			if (decided.kind !== 'decided') return sendJson(response, 409, { message: decided.problem })
			return sendJson(response, 200, { decided: decided.entry, open: await openNow() })
		}
		if (where.startsWith('GET /api/questions/')) {
			const view = await desk.view(url.pathname.slice('/api/questions/'.length))
			return view ? sendJson(response, 200, view) : sendJson(response, 404, { message: 'There is no such question.' })
		}
		if (where === 'POST /api/questions') {
			if (model.kind !== 'ok') return sendJson(response, 503, { message: model.message })
			const body = await readJson(request)
			const asked = body.kind === 'ok' ? await desk.questionOf(body.value) : body
			if (asked.kind === 'refused') return sendJson(response, 400, { message: asked.problem })
			if (asked.kind === 'empty') {
				return sendJson(response, 422, {
					message: "There is nothing here for ken's model to explain.",
					question: asked.text,
				})
			}
			await desk.settled()
			const stop = new AbortController()
			// Closing the request, by Stop on the page or by closing the tab, stops the question, unless ken started it.
			response.on('close', () => {
				if (!response.writableFinished) stop.abort()
			})
			if (request.socket.destroyed) stop.abort()
			response.writeHead(200, { ...HEADERS, 'content-type': 'application/x-ndjson; charset=utf-8' })
			response.flushHeaders()
			await desk.ask(body.kind === 'ok' ? body.value : null, asked, stop.signal, (line) => writeLine(response, line))
			return response.end()
		}
		const file = request.method === 'GET' ? files.get(url.pathname) : undefined
		if (file) return sendFile(response, file)
		return sendJson(response, 404, { message: 'ken has nothing at this address.' })
	}

	const server = createServer((request, response) => {
		route(request, response).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error)
			process.stderr.write(`ken could not answer ${request.method} ${request.url}: ${message}\n`)
			if (!response.headersSent) return sendJson(response, 500, { message })
			writeLine(response, { kind: 'error', message })
			response.end()
		})
	})
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(options.port, '127.0.0.1', resolve)
		})
	} catch (error) {
		await project.close()
		const busy = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
		if (busy) return { kind: 'refused', message: `Port ${options.port} is in use. Give another with --port.` }
		throw error
	}
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('the server is not listening on a TCP port')
	port = address.port

	if (options.live) await live?.start()
	// The first thing missing, on a first open the naming of the parts, starts now: a closed tab does not stop it.
	void desk.refill()

	async function close() {
		server.closeAllConnections()
		await new Promise((resolve) => server.close(resolve))
		await project.close()
	}

	const name = model.kind === 'ok' ? model.name : null
	const url = `http://127.0.0.1:${port}/`
	return { kind: 'ok', server: { url, root, model: name, live: live?.on() ?? false, close } }
}

async function readJson(
	request: IncomingMessage,
): Promise<{ kind: 'ok'; value: unknown } | { kind: 'refused'; problem: string }> {
	let size = 0
	const chunks: Buffer[] = []
	for await (const chunk of request) {
		size += chunk.length
		if (size > MAX_BODY_BYTES) return { kind: 'refused', problem: 'The request is too large.' }
		chunks.push(chunk)
	}
	try {
		return { kind: 'ok', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
	} catch {
		return { kind: 'refused', problem: 'Send the request as JSON.' }
	}
}

// Two of the three buttons under an answer, "I do not know this any more" on the map, and a tour stop the reader
// reached. "Go deeper" asks a question, so it comes as a lens, and a question marks its topics itself, so the page
// never sends "asked".
const BUTTONS: MapSignal[] = ['know', 'too-much', 'usual', 'forgot', 'toured']

function mapSignalOf(
	body: unknown,
): { kind: 'ok'; signal: MapSignal; topics: string[] } | { kind: 'refused'; problem: string } {
	const signal = BUTTONS.find((each) => each === fieldOf(body, 'signal'))
	const topics = fieldOf(body, 'topics')
	if (!signal) return { kind: 'refused', problem: `Send a signal: ${BUTTONS.join(', ')}.` }
	if (!Array.isArray(topics) || topics.length === 0 || !topics.every((topic) => typeof topic === 'string')) {
		return { kind: 'refused', problem: 'Send the names of the topics as a list.' }
	}
	return { kind: 'ok', signal, topics }
}

// What the page says the reader looks at: the id of the open brief, or null, and the paths of the level on the
// Architecture canvas, or null on another page.
function lookingOf(value: unknown): { brief: string | null; within: string[] | null } | null {
	const brief = fieldOf(value, 'brief')
	const within = fieldOf(value, 'within')
	const paths = Array.isArray(within) && within.every((each) => typeof each === 'string') ? within : null
	if ((brief !== null && typeof brief !== 'string') || (within !== null && paths === null)) return null
	return { brief: brief ?? null, within: paths }
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' })
	response.end(JSON.stringify(value))
}

function sendFile(response: ServerResponse, file: PageFile) {
	response.writeHead(200, { ...HEADERS, 'content-type': file.type })
	response.end(file.body)
}

// The reader may have closed the request already; the question still ends and is saved.
function writeLine(
	response: ServerResponse,
	value: QuestionLine | { kind: 'error'; message: string } | { jobs: JobView[]; left: Left },
) {
	if (!response.destroyed) response.write(`${JSON.stringify(value)}\n`)
}
