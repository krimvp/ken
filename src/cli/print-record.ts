import { describeEntry, entryLine, fileRecordStore, type Kind } from '../record/index.ts'
import { findRoot, gitRepository } from '../repo/index.ts'

const ORDER: Kind[] = ['work', 'decision', 'topic', 'note']

// "ken record" lists the project record, pieces of work and decisions first. "ken record <id>" prints one entry in
// full. Neither needs a model. Exit code 0 means it printed, 1 means no such entry, 2 means no repository.
export async function printRecord(directory: string, id: string | undefined, json: boolean): Promise<number> {
	const found = await findRoot(directory)
	if (found.kind !== 'ok') {
		process.stderr.write(`${directory} is not inside a git repository.\n`)
		return 2
	}
	const repo = gitRepository(found.root)
	const record = await fileRecordStore(found.root, repo).read()
	for (const problem of record.problems) process.stderr.write(`${problem}\n`)
	const write = (value: unknown, text: string) =>
		process.stdout.write(`${json ? JSON.stringify(value, null, 2) : text}\n`)

	if (id === undefined) {
		const listed = [...record.current].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
		const text =
			listed.length === 0 ? `The project record in ${found.root} is empty.` : listed.map(entryLine).join('\n')
		write(listed, text)
		return 0
	}
	const entry = record.entries.find((other) => other.id === id)
	if (!entry) {
		process.stderr.write(`There is no entry ${id} in the project record. Run "ken record" to list them.\n`)
		return 1
	}
	write(entry, await describeEntry(repo, record, entry))
	return 0
}
