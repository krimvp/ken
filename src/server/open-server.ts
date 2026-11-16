import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { MODEL_EXAMPLE, type ModelFlags } from '../agent/index.ts'
import { authorsOf, decide, openItems, timeRange } from '../follow-up/index.ts'
import type { MapSignal } from '../map/index.ts'
import { MERMAID_FILE, PAGE_FOLDER } from '../page/index.ts'
import { OUTCOMES } from '../record/index.ts'
import { decisionRows } from './decision-list.ts'
import { refusal } from './guard-request.ts'
import { openProject } from './ken-project.ts'
import { type PageFile, readPageFiles } from './page-files.ts'
import { fieldOf, type QuestionLine } from './question-desk.ts'

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
	const { root, shown, repo, record, map, model, desk, live } = project
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

	async function route(request: IncomingMessage, response: ServerResponse) {
		const problem = refusal(request, port)
		if (problem) return sendJson(response, 403, { message: problem })
		const url = new URL(request.url ?? '/', 'http://ken.invalid')
		const where = `${request.method} ${url.pathname}`
		if (where === 'GET /api/state') {
			const state =
				model.kind === 'ok'
					? { kind: 'ok', name: model.name }
					: { kind: 'unset', message: model.message, missing: model.missing, example: MODEL_EXAMPLE }
			return sendJson(response, 200, { project: shown, model: state, live: live?.on() ?? false })
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
		if (where === 'GET /api/decisions') return sendJson(response, 200, { decisions: decisionRows(await record.read()) })
		if (where === 'GET /api/map') return sendJson(response, 200, { file: map.file, ...(await map.read(new Date())) })
		if (where === 'POST /api/map') {
			const body = await readJson(request)
			const signal = body.kind === 'ok' ? mapSignalOf(body.value) : body
			if (signal.kind !== 'ok') return sendJson(response, 400, { message: signal.problem })
			const states = await map.learn(signal.signal, signal.topics, new Date())
			return sendJson(response, 200, { states })
		}
		if (where === 'GET /api/open') return sendJson(response, 200, await openNow())
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
			const question = { text: asked.text }
			await desk.settled()
			if (desk.busy()) {
				return sendJson(response, 409, { message: 'ken is answering another question. Stop it, or wait for it.' })
			}
			const stop = new AbortController()
			// Closing the request, by Stop on the page or by closing the tab, stops the question.
			response.on('close', () => {
				if (!response.writableFinished) stop.abort()
			})
			if (request.socket.destroyed) stop.abort()
			response.writeHead(200, { ...HEADERS, 'content-type': 'application/x-ndjson; charset=utf-8' })
			response.flushHeaders()
			await desk.ask(model.chat, question.text, stop.signal, (line) => writeLine(response, line))
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

// Two of the three buttons under an answer. "Go deeper" asks a question, so it comes as a lens, and a question marks
// its topics itself, so the page never sends "asked".
const BUTTONS: MapSignal[] = ['know', 'too-much']

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

function sendJson(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' })
	response.end(JSON.stringify(value))
}

function sendFile(response: ServerResponse, file: PageFile) {
	response.writeHead(200, { ...HEADERS, 'content-type': file.type })
	response.end(file.body)
}

// The reader may have closed the request already; the question still ends and is saved.
function writeLine(response: ServerResponse, value: QuestionLine | { kind: 'error'; message: string }) {
	if (!response.destroyed) response.write(`${JSON.stringify(value)}\n`)
}
