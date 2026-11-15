import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import {
	type Chat,
	MODEL_EXAMPLE,
	type ModelFlags,
	type ModelUnset,
	readModelConfig,
	startChat,
} from '../agent/index.ts'
import { kenHome, openHistory } from '../history/index.ts'
import { MERMAID_FILE, PAGE_FOLDER } from '../page/index.ts'
import { fileRecordStore } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'
import { refusal } from './guard-request.ts'
import { type PageFile, readPageFiles } from './page-files.ts'
import { type QuestionLine, questionDesk } from './question-desk.ts'

// model is the name of the model the page asks, or null when none is set and the page can only show earlier answers.
export type KenServer = { url: string; root: string; model: string | null; close(): Promise<void> }

const MAX_BODY_BYTES = 64 * 1024
const MAX_QUESTION_CHARS = 4000
// Mermaid puts a <style> element and style attributes in every drawing it makes, so styles may be inline. Nothing else
// is widened: scripts, images, fonts and requests still come only from this server, so a style cannot fetch anything
// from another host.
const HEADERS = {
	'cache-control': 'no-store',
	'x-content-type-options': 'nosniff',
	'content-security-policy':
		"default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

export async function openServer(options: {
	directory: string
	flags: ModelFlags
	env: Record<string, string | undefined>
	port: number
}): Promise<{ kind: 'ok'; server: KenServer } | { kind: 'refused'; message: string }> {
	const found = await findRoot(options.directory)
	if (found.kind !== 'ok') return { kind: 'refused', message: `${options.directory} is not inside a git repository.` }
	const { root } = found
	const repo = gitRepository(root)
	const opened = await openHistory(kenHome(options.env), repo)
	if (opened.kind !== 'ok') {
		return { kind: 'refused', message: `${root} has no commits yet, so ken has nothing to read.` }
	}
	const { history } = opened
	const config = readModelConfig(options.flags, options.env)
	let model: { kind: 'ok'; chat: Chat; name: string } | ModelUnset
	if (config.kind === 'ok') {
		const started = await startChat({ directory: root, model: config.config })
		if (started.kind !== 'ok') return { kind: 'refused', message: started.message }
		model = { kind: 'ok', chat: started.chat, name: config.config.model }
	} else {
		model = config
	}
	const desk = questionDesk(history, fileRecordStore(root, repo), repo)
	const shown = root.startsWith(`${homedir()}${path.sep}`) ? `~${root.slice(homedir().length)}` : root
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
			return sendJson(response, 200, { project: shown, model: state })
		}
		if (where === 'GET /api/questions') return sendJson(response, 200, { questions: await desk.rows() })
		if (where.startsWith('GET /api/questions/')) {
			const view = await desk.view(url.pathname.slice('/api/questions/'.length))
			return view ? sendJson(response, 200, view) : sendJson(response, 404, { message: 'There is no such question.' })
		}
		if (where === 'POST /api/questions') {
			if (model.kind !== 'ok') return sendJson(response, 503, { message: model.message })
			const question = await readQuestion(request)
			if (question.kind !== 'ok') return sendJson(response, 400, { message: question.problem })
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
		if (model.kind === 'ok') await model.chat.close()
		const busy = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
		if (busy) return { kind: 'refused', message: `Port ${options.port} is in use. Give another with --port.` }
		throw error
	}
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('the server is not listening on a TCP port')
	port = address.port

	async function close() {
		server.closeAllConnections()
		await desk.settled()
		await new Promise((resolve) => server.close(resolve))
		if (model.kind === 'ok') await model.chat.close()
	}

	const name = model.kind === 'ok' ? model.name : null
	return { kind: 'ok', server: { url: `http://127.0.0.1:${port}/`, root, model: name, close } }
}

async function readQuestion(
	request: IncomingMessage,
): Promise<{ kind: 'ok'; text: string } | { kind: 'refused'; problem: string }> {
	let size = 0
	const chunks: Buffer[] = []
	for await (const chunk of request) {
		size += chunk.length
		if (size > MAX_BODY_BYTES) return { kind: 'refused', problem: 'The request is too large.' }
		chunks.push(chunk)
	}
	let body: unknown
	try {
		body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
	} catch {
		return { kind: 'refused', problem: 'Send the question as JSON: {"question": "..."}.' }
	}
	const text = typeof body === 'object' && body !== null && 'question' in body ? body.question : undefined
	if (typeof text !== 'string' || text.trim() === '') return { kind: 'refused', problem: 'The question is empty.' }
	if (text.length > MAX_QUESTION_CHARS) {
		return { kind: 'refused', problem: `Keep the question under ${MAX_QUESTION_CHARS} characters.` }
	}
	return { kind: 'ok', text: text.trim() }
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
