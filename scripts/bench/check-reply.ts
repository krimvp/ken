// Checks the briefs of one run the way the reviewers did, from the run's saved reply: every quote is a file's lines in
// git at its commit, each point's line has at most BRIEF_BOUNDS.lineWords words, and no term is a code name. Then it prints each
// point beside its quoted lines, for a person or a model to judge whether the point is true against its quote.
//
// node scripts/bench/check-reply.ts --repo <project checkout> <run.ndjson>...
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { BRIEF_BOUNDS, type Item, wordCount } from '../../src/agent/index.ts'

const { values, positionals } = parseArgs({ options: { repo: { type: 'string' } }, allowPositionals: true })
if (!values.repo || positionals.length === 0) {
	process.stderr.write('Give --repo and one or more run files (the .ndjson lines run-questions.ts saves).\n')
	process.exit(2)
}
const repo = values.repo

// camelCase or PascalCase inside a word, a name in capitals with an underscore, or a dotted name. An acronym such as
// CLI or API is a word a maintainer says.
const CODE_NAME = /[a-z][A-Z]|\b[A-Z0-9]+_[A-Z0-9_]*\b|\w\.\w/

const files = new Map<string, string[] | null>()
function linesAt(commit: string, file: string): string[] | null {
	const key = `${commit}:${file}`
	if (!files.has(key)) {
		try {
			const text = execFileSync('git', ['-C', repo, 'show', key], { encoding: 'utf8', maxBuffer: 64 << 20 })
			files.set(key, text.split('\n'))
		} catch {
			files.set(key, null)
		}
	}
	return files.get(key) ?? null
}

type Quote = { path: string | null; commit: string; startLine: number; endLine: number; text: string }

function inGit(quote: Quote): boolean {
	if (quote.path === null) return false
	const lines = linesAt(quote.commit, quote.path)
	if (!lines) return false
	return lines.slice(quote.startLine - 1, quote.endLine).join('\n') === quote.text
}

let failed = 0
for (const run of positionals) {
	const events = readFileSync(run, 'utf8')
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line))
	const saved = events.find((event) => event.kind === 'saved')
	const items: Item[] = saved?.view?.entry?.reply?.items ?? []
	const counts = { quotes: 0, notInGit: 0, points: 0, longLines: 0, terms: 0, codeNames: 0 }
	const report: string[] = []
	for (const item of items) {
		if (item.kind === 'step') report.push('', `## Brief ${item.number}: ${item.text}`)
		if (item.kind !== 'card') continue
		const { card } = item
		const quotes: Quote[] =
			card.kind === 'claim' ? (card.claim.quotes as Quote[]) : card.kind === 'topic' ? card.topic.quotes : []
		const missing = quotes.filter((quote) => !inGit(quote))
		counts.quotes += quotes.length
		counts.notInGit += missing.length
		if (card.kind === 'claim' && card.claim.point) {
			const words = wordCount(card.claim.point.line)
			counts.points += 1
			const long = words > BRIEF_BOUNDS.lineWords
			if (long) counts.longLines += 1
			report.push('', `- Point: ${card.claim.point.line} (${words} words${long ? ', TOO LONG' : ''})`)
			report.push(`  More: ${card.claim.text}`)
			for (const quote of quotes) {
				report.push(
					`  > ${quote.path}:${quote.startLine}-${quote.endLine}${missing.includes(quote) ? ' NOT IN GIT' : ''}`,
				)
				report.push(...quote.text.split('\n').map((line) => `  | ${line}`))
			}
		}
		if (card.kind === 'topic' && item.step !== undefined) {
			counts.terms += 1
			const code = CODE_NAME.test(card.topic.name)
			if (code) counts.codeNames += 1
			report.push('', `- Term: ${card.topic.name}${code ? ' (CODE NAME)' : ''}: ${card.topic.note}`)
			for (const quote of quotes) report.push(`  > ${quote.path}:${quote.startLine} | ${quote.text}`)
		}
	}
	failed += counts.notInGit + counts.longLines + counts.codeNames
	process.stdout.write(`# ${run}\n${JSON.stringify(counts)}\n${report.join('\n')}\n\n`)
}
process.exit(failed > 0 ? 1 : 0)
