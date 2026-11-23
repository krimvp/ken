import { onDay } from '../../follow-up/index.ts'
import { type History, kenHome, openHistory } from '../../history/index.ts'
import { type Knows, LEVELS, lookAtLayout, readLayoutAsk } from '../../layout/index.ts'
import {
	type MapRead,
	openMap,
	openNotes,
	openPrefs,
	type ReaderNotes,
	type ReaderPrefs,
	stateLine,
	type UnderstandingMap,
} from '../../map/index.ts'
import { fileRecordStore } from '../../record/index.ts'
import { findRoot, gitRepository } from '../../repo/index.ts'
import { layoutSources } from '../print-layout.ts'

type Part = { name: string } & Knows

// "ken map" prints what ken thinks this reader understands, topic by topic, then what it thinks they know of each
// top-level part, the files it keeps both in, and how to correct them. It needs no model. Exit code 0 means it
// printed, 2 means no repository or no commits.
export async function printMap(directory: string, json: boolean): Promise<number> {
	const opened = await layoutSources(directory)
	if (opened.kind !== 'ok') {
		process.stderr.write(`${opened.message}\n`)
		return 2
	}
	const { map, seen } = opened.sources
	const now = new Date()
	const top = await readLayoutAsk(opened.sources, { change: 'none' }, now)
	const [read, looked, look] = await Promise.all([
		map.read(now),
		seen.read(),
		top.kind === 'ok' ? lookAtLayout(opened.sources, top.ask, now) : null,
	])
	const parts = look?.boxes.map(({ name, knows }) => ({ name, ...knows })) ?? []
	for (const problem of [...read.problems, ...looked.problems]) process.stderr.write(`${problem}\n`)
	process.stdout.write(
		json
			? `${JSON.stringify({ file: map.file, ...read, seen: seen.file, parts }, null, 2)}\n`
			: `${mapText(map.file, read)}${partsText(seen.file, parts, now)}`,
	)
	return 0
}

// The reader's map of the project in this directory, and their notes and their choice of how much text beside it.
export async function mapOf(
	directory: string,
): Promise<
	| { kind: 'ok'; map: UnderstandingMap; notes: ReaderNotes; prefs: ReaderPrefs; history: History; root: string }
	| { kind: 'refused'; message: string }
> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') return { kind: 'refused', message: `${directory} is not inside a git repository.` }
	const repo = gitRepository(found.root)
	const home = kenHome(process.env)
	const record = fileRecordStore(found.root, repo)
	const [opened, notes, prefs, history] = await Promise.all([
		openMap(home, repo, record),
		openNotes(home, repo),
		openPrefs(home, repo),
		openHistory(home, repo, record),
	])
	if (opened.kind !== 'ok' || notes.kind !== 'ok' || prefs.kind !== 'ok' || history.kind !== 'ok') {
		return { kind: 'refused', message: `${found.root} has no commits yet.` }
	}
	return {
		kind: 'ok',
		map: opened.map,
		notes: notes.notes,
		prefs: prefs.prefs,
		history: history.history,
		root: found.root,
	}
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
		'To correct it, add a line to that file. Use heard-of, can-follow or could-change for depth and asked, said, wrote, toured or forgot for evidence. Copy the hash shown above. To set reply length, add a line with topic, date and detail (shorter or usual).',
		...(example ? [`For example: ${JSON.stringify(example)}`] : []),
		'',
	].join('\n')
}

// One line for each part, such as "Sandbox: read the code, last on 20 Nov, 1 commit since."
function partsText(file: string, parts: Part[], now: Date): string {
	const words = (part: Part) => LEVELS.find((each) => each.level === part.level)?.label.toLowerCase() ?? part.level
	const line = (part: Part) => {
		const last = part.last === null ? '' : `, last ${onDay(part.last, now)}`
		const since = part.since === 0 ? '' : `, ${part.since} ${part.since === 1 ? 'commit' : 'commits'} since`
		return `  ${part.name}: ${words(part)}${last}${since}.`
	}
	return [
		`What ken thinks you know of each part, from what you looked at: ${file}`,
		...parts.map(line),
		'To correct a part, press "Not right" on it on the page, or add a line to that file.',
		'',
	].join('\n')
}
