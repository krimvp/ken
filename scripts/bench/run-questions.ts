// Runs a fixed set of questions against a ken server and writes one line per run: what it cost and what came back.
// Each run starts from a fresh copy of the project and of KEN_HOME, so no run reads what another wrote, and starts its
// own ken server, which reads the source once. A small proxy sits between ken and the model endpoint: it counts the
// requests, adds up the usage the endpoint reports, and holds a request that gets a 429 until the endpoint is free.
//
// node scripts/bench/run-questions.ts --ken <ken checkout> --project aigent --repo <dir> --home <dir> --out <dir>
//   [--questions one,every,answer1,answer2,parts,views] [--times 1] [--label main] [--port 4400]
//   [--upstream http://127.0.0.1:4142]
import { spawn } from 'node:child_process'
import { appendFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

// The fixed set, on the review copies of aigent and of the shop. The two answer questions are ones the current briefs
// of these parts list, the same text every time.
const PROJECTS: Record<string, { part: string; asked: [string, string] }> = {
	aigent: {
		part: 'Plugin engine',
		asked: [
			'What happens to a call whose gate times out?',
			'How does a resumed session rebuild its state from the record log?',
		],
	},
	shop: {
		part: 'Orders service',
		asked: [
			'What happens when the bus is down while the outbox loop runs?',
			'Why is the event written to a table instead of published straight from the handler?',
		],
	},
}

type Asked = { project: { part: string; asked: [string, string] } }

// "parts" runs on a copy whose record holds no named layout, so the model names the top level from the folders.
const QUESTIONS: Record<string, { body: (asked: Asked) => object; dropLayouts?: true }> = {
	one: { body: ({ project }) => ({ lens: { kind: 'explain', within: [], part: project.part } }) },
	every: { body: () => ({ lens: { kind: 'explain', within: [] } }) },
	answer1: { body: ({ project }) => answerBody(project.part, project.asked[0]) },
	answer2: { body: ({ project }) => answerBody(project.part, project.asked[1]) },
	parts: { body: () => ({ lens: { kind: 'parts', within: [] } }), dropLayouts: true },
	views: { body: () => ({ lens: { kind: 'views', within: [] } }) },
}

function answerBody(part: string, text: string) {
	return { lens: { kind: 'answer', concept: `part::${part}`, text } }
}

const { values } = parseArgs({
	options: {
		ken: { type: 'string' },
		project: { type: 'string' },
		repo: { type: 'string' },
		home: { type: 'string' },
		out: { type: 'string' },
		questions: { type: 'string', default: Object.keys(QUESTIONS).join(',') },
		times: { type: 'string', default: '1' },
		label: { type: 'string', default: 'run' },
		port: { type: 'string', default: '4400' },
		upstream: { type: 'string', default: 'http://127.0.0.1:4142' },
	},
})

const { ken, project: projectName, repo, home, out } = values
const project = projectName === undefined ? undefined : PROJECTS[projectName]
if (!ken || !repo || !home || !out || !project || !projectName) {
	process.stderr.write(`Give --ken, --repo, --home, --out and --project, one of ${Object.keys(PROJECTS).join(', ')}.\n`)
	process.exit(2)
}
const port = Number(values.port)
const proxyPort = port + 10
const upstream = new URL(values.upstream)

// What the proxy saw during one run.
type Seen = { requests: number; busy: number; waited: number; failed: number; input: number; output: number }
let seen: Seen = { requests: 0, busy: 0, waited: 0, failed: 0, input: 0, output: 0 }

const proxy = createServer(async (req, res) => {
	let body = ''
	for await (const part of req) body += part
	for (;;) {
		const answer = await forward(req.method ?? 'POST', req.url ?? '/', req.headers, body)
		if (answer.status === 429) {
			seen.busy += 1
			seen.waited += 5
			await sleep(5000)
			continue
		}
		if (answer.status !== 200) seen.failed += 1
		else seen.requests += 1
		const usage = usageOf(answer.text)
		seen.input += usage.input
		seen.output += usage.output
		res.writeHead(answer.status, answer.headers)
		res.end(answer.text)
		return
	}
})
await new Promise<void>((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve))

function forward(method: string, url: string, sent: IncomingHttpHeaders, body: string) {
	const { host: _host, 'content-length': _length, ...headers } = sent
	return new Promise<{ status: number; headers: Record<string, string>; text: string }>((resolve, reject) => {
		const call = httpRequest(
			{
				host: upstream.hostname,
				port: upstream.port,
				path: url,
				method,
				headers,
			},
			async (answer) => {
				let text = ''
				for await (const part of answer) text += part
				const type = String(answer.headers['content-type'] ?? 'application/json')
				resolve({ status: answer.statusCode ?? 502, headers: { 'content-type': type }, text })
			},
		)
		call.on('error', reject)
		call.end(body)
	})
}

// The endpoint streams server-sent events; the last chunk with usage carries the request's tokens.
function usageOf(text: string): { input: number; output: number } {
	let found = { input: 0, output: 0 }
	for (const line of text.split('\n')) {
		if (!line.startsWith('data: {')) continue
		const usage = JSON.parse(line.slice(6)).usage
		if (usage) found = { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
	}
	return found
}

await mkdir(out, { recursive: true })
const names = values.questions.split(',')
for (let time = 1; time <= Number(values.times); time += 1) {
	for (const name of names) {
		const question = QUESTIONS[name]
		if (!question) throw new Error(`no question ${name}: give one of ${Object.keys(QUESTIONS).join(', ')}`)
		const line = await runOnce(name, question)
		await appendFile(path.join(out, 'runs.ndjson'), `${JSON.stringify(line)}\n`)
		process.stdout.write(`${JSON.stringify(line)}\n`)
	}
}
proxy.close()

async function runOnce(name: string, question: (typeof QUESTIONS)[string]) {
	const id = `${values.label}-${projectName}-${name}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
	const work = path.join(out as string, 'work', id)
	const copy = path.join(work, 'repo')
	const kenHome = path.join(work, 'home')
	await cp(repo as string, copy, { recursive: true })
	await cp(home as string, kenHome, { recursive: true })
	if (question.dropLayouts) await rm(path.join(copy, '.ken', 'record', 'layouts.jsonl'), { force: true })
	seen = { requests: 0, busy: 0, waited: 0, failed: 0, input: 0, output: 0 }
	const server = spawn(
		process.execPath,
		[path.join(ken as string, 'src/cli/main.ts'), 'open', '--port', String(port)],
		{
			cwd: copy,
			env: {
				...process.env,
				KEN_HOME: kenHome,
				KEN_MODEL: 'opus',
				KEN_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
				KEN_API_KEY_ENV: 'KEN_LOCAL_KEY',
				KEN_LOCAL_KEY: 'not-a-key-12345',
				BROWSER: 'none',
			},
			stdio: ['ignore', 'ignore', 'pipe'],
		},
	)
	let stderr = ''
	server.stderr.on('data', (chunk) => {
		stderr += chunk
	})
	try {
		await waitForServer()
		const started = performance.now()
		const lines = await ask(question.body({ project: project as Asked['project'] }))
		const wall = Math.round((performance.now() - started) / 100) / 10
		await writeFile(path.join(out as string, `${id}.ndjson`), lines.map((each) => JSON.stringify(each)).join('\n'))
		const usage = lines.find((each) => each.kind === 'usage')
		const saved = lines.find((each) => each.kind === 'saved')
		const end = lines.findLast((each) => each.kind === 'done' || each.kind === 'error')
		return {
			label: values.label,
			project: projectName,
			lens: name,
			inputTokens: usage?.inputTokens ?? null,
			outputTokens: usage?.outputTokens ?? null,
			seconds: usage?.seconds ?? null,
			wall,
			requests: seen.requests,
			sentBack: lines.filter((each) => each.kind === 'step' && each.step?.kind === 'sent-back').length,
			replyId: saved?.view?.entry?.id ?? null,
			outcome: end?.kind === 'done' ? end.outcome : `error: ${end?.message ?? lines.at(-1)?.message ?? 'no end'}`,
			// Seconds the endpoint was busy with another caller's request, which ken's seconds include.
			waited: seen.waited,
			proxy: { input: seen.input, output: seen.output, busy: seen.busy, failed: seen.failed },
		}
	} catch (error) {
		return { label: values.label, project: projectName, lens: name, outcome: `error: ${String(error)}`, stderr }
	} finally {
		server.kill()
		await new Promise((resolve) => server.once('exit', resolve))
	}
}

async function waitForServer() {
	for (let tries = 0; tries < 120; tries += 1) {
		const up = await fetch(`http://127.0.0.1:${port}/api/state`).then(
			(answer) => answer.ok,
			() => false,
		)
		if (up) return
		await sleep(500)
	}
	throw new Error('ken did not start')
}

// The server sends one JSON line per event while the question runs. A 409 means another question holds the desk.
// biome-ignore lint/suspicious/noExplicitAny: the lines are ken's events, read as plain JSON
async function ask(body: object): Promise<any[]> {
	const answer = await fetch(`http://127.0.0.1:${port}/api/questions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
		body: JSON.stringify(body),
	})
	const text = await answer.text()
	if (!answer.ok) throw new Error(`ken answered ${answer.status}: ${text}`)
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line))
}
