import type { VerifiedQuote } from '../checks/index.ts'
import { diagramElements } from '../diagram/index.ts'
import type { Repository } from '../repo/index.ts'
import { decisionWork } from './decision-work.ts'
import type { Decision, RecordEntry } from './entry.ts'
import type { RecordRead } from './file-record-store.ts'
import { noteFreshness } from './note-freshness.ts'

// One line per entry, for a list: its kind, id and what names it.
export function entryLine(entry: RecordEntry): string {
	const head = `${entry.kind} ${entry.id}`
	switch (entry.kind) {
		case 'work': {
			const commits = entry.commits.length === 1 ? '1 commit' : `${entry.commits.length} commits`
			return `${head} "${entry.title}", ${short(entry.range.base)}..${short(entry.range.head)}, ${commits}`
		}
		case 'decision':
			return `${head} "${entry.question}" [${decisionMark(entry)}]${entry.work ? `, in work ${entry.work}` : ''}`
		case 'topic':
			return `${head} "${entry.name}"`
		case 'note':
			return `${head}, on topic ${entry.topic}`
		default:
			return entry satisfies never
	}
}

// One entry in full, as plain text. Quotes print the way read_file prints lines, so a model can copy them back. A
// topic shows its newest note and whether that note still matches the code at HEAD.
export async function describeEntry(
	repo: Repository,
	record: RecordRead,
	entry: RecordEntry,
	signal?: AbortSignal,
): Promise<string> {
	const replacedBy = record.entries.find((other) => other.replaces === entry.id)
	const lines = [entryLine(entry), `written ${entry.at}`]
	if (entry.replaces) lines.push(`replaces ${entry.replaces}`)
	if (replacedBy) lines.push(`replaced by ${replacedBy.id}, which reads return instead`)
	switch (entry.kind) {
		case 'work': {
			lines.push(`range ${entry.range.base}..${entry.range.head}`, `dates ${entry.first} to ${entry.last}`)
			lines.push('commits, newest first, with who did each:')
			for (const commit of entry.commits) lines.push(`  ${commit.hash} ${commit.by}`)
			lines.push(`summary: ${entry.summary}`)
			for (const [index, statement] of entry.statements.entries()) {
				lines.push(
					`statement ${index + 1} [${statement.label}]: ${statement.text}`,
					...statement.quotes.flatMap(quoted),
				)
			}
			if (entry.risks?.length === 0) lines.push('risks: none found')
			for (const [index, risk] of (entry.risks ?? []).entries()) {
				lines.push(`risk ${index + 1} [${risk.label}]: ${risk.text}`, ...risk.quotes.flatMap(quoted))
			}
			for (const [index, diagram] of entry.diagrams.entries()) {
				lines.push(`diagram ${index + 1}, ${diagram.kind} [${diagram.label}]: ${diagram.title}`)
				for (const element of diagramElements(diagram)) {
					const label = element.label === null ? '' : ` [${element.label}]`
					lines.push(`  ${element.number}. ${element.text}${label}`, ...element.quotes.flatMap(quoted))
				}
			}
			const decisions = record.current.filter(
				(other) => other.kind === 'decision' && decisionWork(other, record) === entry.id,
			)
			lines.push(
				decisions.length === 0 ? 'decisions: none' : 'decisions:',
				...decisions.map((d) => `  ${entryLine(d)}`),
			)
			break
		}
		case 'decision': {
			if (entry.logged) {
				const by = entry.logged.by === null ? '' : ` by ${entry.logged.by}`
				const head = entry.logged.head === null ? 'before the first commit' : `while HEAD was ${entry.logged.head}`
				lines.push(`logged with ken decide${by}, ${head}`)
			}
			const work = decisionWork(entry, record)
			if (work !== null && entry.work === null) {
				lines.push(`belongs to work ${work}, whose commits came after the commit it was logged at`)
			}
			lines.push(`chosen: ${entry.chosen}`)
			if (entry.reason) lines.push(`reason: ${entry.reason.text}`, ...entry.reason.quotes.flatMap(quoted))
			if (entry.rejected.length === 0) lines.push('rejected: none shown in the code or the history')
			for (const rejected of entry.rejected) lines.push(`rejected: ${rejected.option}, because ${rejected.reason}`)
			lines.push(`undo: ${entry.undo}`, `needs the owner: ${entry.needsOwner ? 'yes' : 'no'}`)
			lines.push(...entry.quotes.flatMap(quoted))
			break
		}
		case 'topic': {
			lines.push(...entry.quotes.flatMap(quoted))
			const note = record.current.findLast((other) => other.kind === 'note' && other.topic === entry.id)
			if (note?.kind !== 'note') {
				lines.push('note: none')
				break
			}
			const freshness = await noteFreshness(repo, entry, note, signal)
			const state =
				freshness.kind === 'fresh'
					? 'fresh: the quoted code is unchanged at HEAD'
					: `stale: the quoted code changed at HEAD in ${freshness.changed.join(', ')}`
			lines.push(`note ${note.id}, ${state}:`, note.text)
			break
		}
		case 'note':
			lines.push(`code hash ${entry.codeHash}`, entry.text)
			break
		default:
			return entry satisfies never
	}
	return lines.join('\n')
}

// Which of the two kinds of recorded decision this is, so a reader can tell a logged one from a quoted message.
function decisionMark(decision: Decision): string {
	const by = decision.logged?.by
	if (decision.logged) return by ? `recorded, logged by ${by}` : 'recorded, logged with ken decide'
	return decision.label === 'recorded' ? 'recorded from a commit message' : decision.label
}

function quoted(quote: VerifiedQuote): string[] {
	const span =
		quote.startLine === quote.endLine ? `line ${quote.startLine}` : `lines ${quote.startLine}-${quote.endLine}`
	const rows = quote.text.split('\n').map((text, offset) => `${String(quote.startLine + offset).padStart(6)}\t${text}`)
	const source = quote.path === null ? `the message of ${quote.commit}` : `${quote.path} at ${quote.commit}`
	return [`  quote ${source}, ${span}:`, ...rows]
}

function short(commit: string): string {
	return commit.slice(0, 12)
}
