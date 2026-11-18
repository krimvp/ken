import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { buildRepository } from '../fixtures/build-repository.ts'

// npm puts an installed ken under node_modules, where Node will not strip types, so the tests run a copy from there.
const checkout = path.join(import.meta.dirname, '../..')
const prefix = mkdtempSync(path.join(tmpdir(), 'ken-prefix-'))
after(() => rmSync(prefix, { recursive: true, force: true }))
const installed = path.join(prefix, 'lib/node_modules/ken')
for (const folder of ['bin', 'src', 'scripts']) {
	cpSync(path.join(checkout, folder), path.join(installed, folder), { recursive: true })
}
cpSync(path.join(checkout, 'package.json'), path.join(installed, 'package.json'))
symlinkSync(path.join(checkout, 'node_modules'), path.join(installed, 'node_modules'))

test('the installed ken reads the project in the folder it is started in, with no --repo', async () => {
	const { root } = buildRepository([{ message: 'feat: start', files: { 'server/app.py': 'print(1)\n' } }])
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))

	const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		execFile(
			path.join(installed, 'bin/ken.js'),
			['layout'],
			{ cwd: path.join(root, 'server'), env: { ...process.env, KEN_HOME: home } },
			(error, stdout, stderr) => {
				resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
			},
		)
	})

	assert.equal(code, 0, stderr)
	assert.match(stdout, /the whole project/)
	assert.match(stdout, /server, 1 file/)
	assert.equal(stderr, '', 'no warning from Node on every run')
})

test('the installed ken-claude-endpoint starts and says what to set', async () => {
	const endpoint = spawn(path.join(installed, 'bin/ken-claude-endpoint.js'), ['--port', '0'])
	after(() => endpoint.kill())
	let printed = ''
	for await (const part of endpoint.stdout) {
		printed += part
		if (printed.split('\n').length > 2) break
	}
	assert.match(printed, /listening on http:\/\/127\.0\.0\.1:\d+\/v1/)
	assert.match(printed, /KEN_BASE_URL=http:\/\/127\.0\.0\.1:\d+\/v1/)
})
