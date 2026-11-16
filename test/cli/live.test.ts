import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'
import { scriptedModel } from '../fixtures/scripted-model.ts'

const KEN = path.join(import.meta.dirname, '../../src/cli/main.ts')
const RETRY = 'export function retry(times: number) {\n\tfor (let i = 0; i < times; i++) attempt()\n}\n'
const WAIT_LINE = '\tfor (let i = 0; i < times; i++) attempt(), sleep(100)'

test('ken live prints the Now block, then a note for a commit as it lands, and stops on a signal', async () => {
	const { root, hashes } = buildRepository([{ message: 'feat: retry', files: { 'src/retry.ts': RETRY } }])
	const [first = ''] = hashes
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const args: Record<string, unknown> = {}
	const model = await scriptedModel([{ tool: 'ken__answer', args }, { text: 'Done.' }])
	const env = {
		...process.env,
		KEN_HOME: home,
		KEN_MODEL: 'scripted',
		KEN_BASE_URL: model.baseUrl,
		KEN_API_KEY_ENV: 'KEN_TEST_LIVE_CLI_KEY',
		KEN_TEST_LIVE_CLI_KEY: 'scripted-model-key',
	}
	const ken = spawn('node', [KEN, 'live', '--repo', root], { env })
	let out = ''
	const seen = (text: string) =>
		new Promise<void>((resolve, reject) => {
			const check = () => (out.includes(text) ? resolve() : undefined)
			ken.stdout.on('data', (chunk) => {
				out += chunk
				check()
			})
			ken.on('exit', () => reject(new Error(`ken live ended before it printed "${text}":\n${out}`)))
			check()
		})
	const exited = new Promise<number | null>((resolve) => ken.on('exit', resolve))

	await seen('Now, from git and the saved session:')
	writeFileSync(path.join(root, 'src/retry.ts'), RETRY.replace('attempt()', 'attempt(), sleep(100)'))
	execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--all', '-m', 'feat: wait'], { cwd: root })
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
	Object.assign(args, {
		scope: { base: first, head },
		summary: 'Retries now wait 100 ms between attempts.',
		statements: [
			{
				text: 'Each attempt waits.',
				label: 'inferred',
				quotes: [{ path: 'src/retry.ts', commit: head, text: WAIT_LINE }],
			},
		],
		risks: [],
	})
	await seen('Retries now wait 100 ms between attempts.')
	ken.kill('SIGINT')

	assert.equal(await exited, 0, out)
	assert.ok(out.includes(`on the commits ${first.slice(0, 7)}..${head.slice(0, 7)}`), out)
	assert.ok(out.includes('its quotes passed first time'), out)
	assert.ok(out.includes('ken stopped. This run wrote 1 notes'), out)
})
