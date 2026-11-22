import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { type KenServer, openServer } from '../../src/server/index.ts'

const KEY_ENV = 'KEN_TEST_PAGE_KEY'
process.env[KEY_ENV] = 'scripted-model-key'

// A new folder for one reader's home, removed when the test file ends.
export function readerHome(): string {
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	return home
}

// ken's server on one project, as "ken open" starts it. baseUrl is the scripted model's, or null for no model. ken fills
// nothing by itself unless env turns it on, so a script holds only the turns a test asks for. The server closes when
// the test file ends.
export async function openKen(
	directory: string,
	home: string,
	baseUrl: string | null = null,
	env: Record<string, string> = {},
): Promise<KenServer> {
	const model = baseUrl
		? { KEN_MODEL: 'scripted', KEN_BASE_URL: baseUrl, KEN_API_KEY_ENV: KEY_ENV, [KEY_ENV]: process.env[KEY_ENV] }
		: {}
	const opened = await openServer({
		directory,
		flags: {},
		env: { KEN_HOME: home, KEN_BACKGROUND: 'off', ...model, ...env },
		port: 0,
	})
	if (opened.kind !== 'ok') throw new Error(opened.message)
	after(() => opened.server.close())
	return opened.server
}

// Sends a request the way the page does, from the server's own origin. A body makes it a POST.
export async function call(server: KenServer, route: string, body?: object): Promise<{ status: number; text: string }> {
	const url = new URL(route, server.url)
	const req = httpRequest(url, {
		method: body ? 'POST' : 'GET',
		headers: { origin: url.origin, 'content-type': 'application/json' },
	})
	const answered = new Promise<{ status: number; text: string }>((resolve, reject) => {
		req.on('error', reject)
		req.on('response', (res) => {
			let text = ''
			res.on('data', (chunk) => (text += chunk))
			res.on('error', reject)
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
		})
	})
	req.end(body ? JSON.stringify(body) : undefined)
	return await answered
}

export async function json(server: KenServer, route: string, body?: object) {
	const { status, text } = await call(server, route, body)
	assert.equal(status, 200, text)
	return JSON.parse(text)
}

// The lines a question streams, from "asked" to "saved".
export async function ask(server: KenServer, body: object) {
	const { status, text } = await call(server, '/api/questions', body)
	assert.equal(status, 200, text)
	return text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))
}
