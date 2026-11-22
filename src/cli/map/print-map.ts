import { kenHome } from '../../history/index.ts'
import {
	type MapRead,
	openMap,
	openNotes,
	type ReaderNotes,
	stateLine,
	type UnderstandingMap,
} from '../../map/index.ts'
import { fileRecordStore } from '../../record/index.ts'
import { findRoot, gitRepository } from '../../repo/index.ts'

// "ken map" prints what ken thinks this reader understands, the file it keeps that in, and how to correct it. It needs
// no model. Exit code 0 means it printed, 2 means no repository or no commits.
export async function printMap(directory: string, json: boolean): Promise<number> {
	const opened = await mapOf(directory)
	if (opened.kind !== 'ok') {
		process.stderr.write(`${opened.message}\n`)
		return 2
	}
	const { map } = opened
	const read = await map.read(new Date())
	for (const problem of read.problems) process.stderr.write(`${problem}\n`)
	process.stdout.write(json ? `${JSON.stringify({ file: map.file, ...read }, null, 2)}\n` : mapText(map.file, read))
	return 0
}

// The reader's map of the project in this directory, and their notes beside it.
export async function mapOf(
	directory: string,
): Promise<
	{ kind: 'ok'; map: UnderstandingMap; notes: ReaderNotes; root: string } | { kind: 'refused'; message: string }
> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') return { kind: 'refused', message: `${directory} is not inside a git repository.` }
	const repo = gitRepository(found.root)
	const home = kenHome(process.env)
	const [opened, notes] = await Promise.all([
		openMap(home, repo, fileRecordStore(found.root, repo)),
		openNotes(home, repo),
	])
	if (opened.kind !== 'ok' || notes.kind !== 'ok') {
		return { kind: 'refused', message: `${found.root} has no commits yet.` }
	}
	return { kind: 'ok', map: opened.map, notes: notes.notes, root: found.root }
}

function mapText(file: string, { states }: MapRead): string {
	const example = states[0] && {
		topic: states[0].topic,
		depth: 'could-change',
		evidence: 'wrote',
		date: new Date().toISOString().slice(0, 10),
		hash: states[0].hash,
	}
	return [
		`Your understanding map: ${file}`,
		...(states.length === 0 ? ['The project record has no topics yet. Ask about a part of the project first.'] : []),
		...states.map((state) => `  ${stateLine(state)} [hash ${state.hash}]`),
		'To correct it, add a line to that file. ken reads the newest line for each topic. Depth is heard-of, can-follow or could-change; evidence is asked, read, said or wrote; the hash is the one shown above.',
		...(example ? [`For example: ${JSON.stringify(example)}`] : []),
		'',
	].join('\n')
}
