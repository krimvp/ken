// Check the saved drawing against the commit on the canvas. Several items can cite the same line.
import { type RecordEntry, topicCode } from '../record/index.ts'
import type { CommitHash, Repository } from '../repo/index.ts'

type Layout = Extract<RecordEntry, { kind: 'layout' }>
type Views = NonNullable<Layout['views']>
type Quotes = NonNullable<Views['world']>['outside'][number]['quotes']
export type ChangedViewItem = { view: 'world' | 'runtime'; id: string; name: string; files: string[] }

// Reopening a brief at the same commit sees the same checked lines. Keep only the last drawing per repository.
const last = new WeakMap<Repository, { id: string; at: CommitHash; changed: ChangedViewItem[] }>()

export async function changedViewItems(
	repo: Repository,
	id: string,
	views: Views,
	at: CommitHash,
	signal?: AbortSignal,
) {
	const cached = last.get(repo)
	if (cached?.id === id && cached.at === at) return cached.changed
	const items: (Omit<ChangedViewItem, 'files'> & { quotes: Quotes })[] = []
	function add(view: ChangedViewItem['view'], id: string, name: string, quotes: Quotes) {
		const older = quotes.filter((quote) => quote.commit !== at)
		if (older.length) items.push({ view, id, name, quotes: older })
	}
	const { world, runtime } = views
	for (const o of world?.outside ?? []) add('world', o.id, o.name, o.quotes)
	for (const c of world?.crossings ?? []) add('world', c.id, c.text, c.quotes)
	for (const f of runtime?.frames ?? [])
		add('runtime', f.id, f.name, f.copies ? [...f.quotes, f.copies.quote] : f.quotes)
	for (const t of runtime?.things ?? []) {
		if (t.kind === 'outside') {
			const o = world?.outside.find((each) => each.id === t.id)
			if (o) add('runtime', t.id, o.name, o.quotes)
		} else add('runtime', t.id, t.kind === 'part' ? t.part : t.name, t.quotes)
	}
	for (const c of runtime?.crossings ?? []) add('runtime', c.id, c.text, [...c.quotes.from, ...c.quotes.to])
	if (items.length === 0) return []
	const key = (quote: Quotes[number]) => JSON.stringify([quote.path, quote.text])
	const unique = new Map(items.flatMap(({ quotes }) => quotes.map((q) => [key(q), q] as const)))
	const { gone } = await topicCode(repo, { quotes: [...unique.values()] }, signal, at)
	const missing = new Set(gone.map(key))
	const changed = items.flatMap(({ quotes, ...item }) => {
		const files = [...new Set(quotes.flatMap((q) => (q.path && missing.has(key(q)) ? [q.path] : [])))]
		return files.length ? [{ ...item, files }] : []
	})
	last.set(repo, { id, at, changed })
	return changed
}
