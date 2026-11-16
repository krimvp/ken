import { kenHome, openHistory } from '../../history/index.ts'
import { areaQuestion, catchUpQuestion } from '../../map/index.ts'
import { fileRecordStore } from '../../record/index.ts'
import { gitRepository, parsePath } from '../../repo/index.ts'
import { mapOf } from './print-map.ts'

// "ken catch-up" and "ken area <path>" write their question from what ken knows without a model: the reader's map, the
// project record and the reader's history. The terminal prints it before the agent answers, so the list stands even
// when no model is set.
export async function lensQuestion(
	lens: { kind: 'catch-up' } | { kind: 'area'; path: string },
	directory: string,
): Promise<{ kind: 'ok'; text: string } | { kind: 'refused'; message: string }> {
	const opened = await mapOf(directory)
	if (opened.kind !== 'ok') return opened
	const repo = gitRepository(opened.root)
	const [{ states }, record] = await Promise.all([
		opened.map.read(new Date()),
		fileRecordStore(opened.root, repo).read(),
	])
	if (lens.kind === 'area') {
		const area = parsePath(lens.path)
		if (area.kind !== 'ok') return { kind: 'refused', message: `Name a folder or a file: ${area.reason}.` }
		return { kind: 'ok', text: areaQuestion(area.path, states, record) }
	}
	const history = await openHistory(kenHome(process.env), repo)
	const asked = history.kind === 'ok' ? await history.history.list() : []
	const head = await repo.resolve('HEAD')
	return {
		kind: 'ok',
		text: catchUpQuestion({ states, record, asked, head: head.kind === 'ok' ? head.commit : null }),
	}
}
