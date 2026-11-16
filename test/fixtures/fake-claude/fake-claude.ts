import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'

// A stand-in for the `claude` command, found first on the PATH. Each run records how it was called and prints the
// next canned result, in the shape `claude -p --output-format json` prints. The test side and the command side share
// this file: the test calls fakeClaude, and the shell script beside it runs the block at the bottom.

export type FakeCall = { args: string[]; cwdEntries: string[]; systemPrompt: string; stdin: string }

// The result of a run that ended with this structured output, and the usage the test expects ken to see.
export function cliResult(
	structured: unknown,
	usage = { inputTokens: 900, cacheReadInputTokens: 80, cacheCreationInputTokens: 20, outputTokens: 30 },
) {
	return {
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: JSON.stringify(structured),
		structured_output: structured,
		modelUsage: { 'claude-fake': usage },
	}
}

export function fakeClaude(results: object[]): { calls: () => FakeCall[] } {
	const dir = mkdtempSync(path.join(tmpdir(), 'fake-claude-'))
	after(() => rmSync(dir, { recursive: true, force: true }))
	writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results))
	process.env.FAKE_CLAUDE_DIR = dir
	if (!process.env.PATH?.startsWith(import.meta.dirname))
		process.env.PATH = `${import.meta.dirname}:${process.env.PATH}`
	return {
		calls: () =>
			readFileSync(path.join(dir, 'calls.jsonl'), { encoding: 'utf8', flag: 'a+' })
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line)),
	}
}

if (import.meta.main) {
	const dir = process.env.FAKE_CLAUDE_DIR ?? ''
	const args = process.argv.slice(2)
	const systemFile = args[args.indexOf('--system-prompt-file') + 1] ?? ''
	const log = path.join(dir, 'calls.jsonl')
	const runsBefore = readFileSync(log, { encoding: 'utf8', flag: 'a+' }).split('\n').filter(Boolean).length
	const call: FakeCall = {
		args,
		cwdEntries: readdirSync(process.cwd()),
		systemPrompt: readFileSync(systemFile, 'utf8'),
		stdin: readFileSync(0, 'utf8'),
	}
	appendFileSync(log, `${JSON.stringify(call)}\n`)
	const results: object[] = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8'))
	process.stdout.write(
		JSON.stringify(results[runsBefore] ?? { type: 'result', is_error: true, result: 'no canned result' }),
	)
}
