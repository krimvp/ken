import { onDay, openItems, openQuestion, personLens, rangeLens } from '../../follow-up/index.ts'
import { areaQuestion, catchUpQuestion } from '../../map/index.ts'
import { fileRecordStore } from '../../record/index.ts'
import { gitRepository, parsePath } from '../../repo/index.ts'
import { mapOf } from './print-map.ts'

// "ken catch-up", "ken area <path>", "ken follow-up", "ken who <author>" and "ken since <day>" write their question from
// what ken knows without a model: the reader's map, the project record and the reader's history. The terminal prints it
// before the agent answers, so the list stands even when no model is set. empty says there is nothing to ask about.
export async function lensQuestion(
	lens:
		| { kind: 'catch-up' | 'follow-up' }
		| { kind: 'area'; path: string }
		| { kind: 'who'; author: string; since: string }
		| { kind: 'since'; since: string },
	directory: string,
): Promise<{ kind: 'ok'; text: string; empty: boolean } | { kind: 'refused'; message: string }> {
	const opened = await mapOf(directory)
	if (opened.kind !== 'ok') return opened
	const repo = gitRepository(opened.root)
	const store = fileRecordStore(opened.root, repo)
	const [{ states }, record] = await Promise.all([opened.map.read(new Date()), store.read()])
	if (lens.kind === 'area') {
		const area = parsePath(lens.path)
		if (area.kind !== 'ok') return { kind: 'refused', message: `Name a folder or a file: ${area.reason}.` }
		return { kind: 'ok', text: areaQuestion(area.path, states, record, onDay), empty: false }
	}
	if (lens.kind === 'follow-up') return { kind: 'ok', ...openQuestion(await openItems(repo, record, states)) }
	const asked = await opened.history.list()
	if (lens.kind === 'who' || lens.kind === 'since') {
		const facts = { record, states, lastQuestion: asked.at(-1) }
		const written =
			lens.kind === 'who'
				? await personLens(repo, facts, lens, new Date())
				: await rangeLens(repo, facts, lens.since, new Date())
		return written.kind === 'ok' ? { kind: 'ok', ...written.question } : { kind: 'refused', message: written.problem }
	}
	const head = await repo.resolve('HEAD')
	return {
		kind: 'ok',
		text: catchUpQuestion({ states, record, asked, head: head.kind === 'ok' ? head.commit : null, day: onDay }),
		empty: false,
	}
}
