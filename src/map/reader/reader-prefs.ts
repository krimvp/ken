// How much text this reader wants: ~/.ken/projects/<project id>/prefs.json, beside the map and never in the
// repository. It is one small file that holds the reader's choice now, which they can open and change. The page
// shows more or fewer words by it, and ken tells its model the choice in plain words at the start of every run.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Repository } from '../../repo/index.ts'

// pictures: a drawing and one short line. balanced: a sentence under each line. words: a short paragraph too.
export const TEXT_PREFS = ['pictures', 'balanced', 'words'] as const
export type TextPref = (typeof TEXT_PREFS)[number]

export type Prefs = { text: TextPref }

// ken is built for a reader who thinks in pictures, so that is the choice until they make one.
const UNSET: Prefs = { text: 'pictures' }

const TOLD: Record<TextPref, string> = {
	pictures:
		'The reader takes things in as pictures first: they look at a drawing and read one short line before any paragraph. Lead with the short line, and keep every sentence short and literal.',
	balanced:
		'The reader wants pictures and words in balance: a short line first, then one sentence that says it in full.',
	words:
		'The reader wants more words: after the short line they read the full telling, so give it, in plain sentences.',
}

export type ReaderPrefs = {
	file: string
	// The reader's choice, or the choice ken starts with when the file is missing or does not parse.
	read(): Promise<Prefs>
	write(prefs: Prefs): Promise<Prefs>
}

export async function openPrefs(
	home: string,
	repo: Repository,
	signal?: AbortSignal,
): Promise<{ kind: 'ok'; prefs: ReaderPrefs } | { kind: 'no-commits' }> {
	const first = await repo.firstCommit(signal)
	if (first === null) return { kind: 'no-commits' }
	const file = path.join(home, 'projects', first, 'prefs.json')
	return {
		kind: 'ok',
		prefs: {
			file,
			async read() {
				const text = await readFile(file, 'utf8').catch(() => '')
				return parsePrefs(text) ?? UNSET
			},
			async write(prefs) {
				await mkdir(path.dirname(file), { recursive: true })
				await writeFile(file, `${JSON.stringify(prefs, null, '\t')}\n`)
				return prefs
			},
		},
	}
}

// The reader's choice as it comes from the page or from the file. null when it names none of the three.
export function prefsOf(value: unknown): Prefs | null {
	const text = typeof value === 'object' && value !== null ? Reflect.get(value, 'text') : undefined
	const known = TEXT_PREFS.find((each) => each === text)
	return known ? { text: known } : null
}

// The choice as one sentence for the model.
export function prefsLine(prefs: Prefs): string {
	return TOLD[prefs.text]
}

function parsePrefs(text: string): Prefs | null {
	try {
		return prefsOf(JSON.parse(text))
	} catch {
		return null
	}
}
