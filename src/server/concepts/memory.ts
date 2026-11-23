// What ken holds, as the model's memory tools ask for it: what ken's model said of a concept, a named level, and every
// thing to know of a saved brief or answer and every term, with the lines each quotes. Plain code over the layout, the
// record and the reader's history, read again on each call, so it holds what was saved a moment ago.
import type { Fact, Known, KnownLevel, Memory, QuestionFocus } from '../../agent/index.ts'
import type { History } from '../../history/index.ts'
import { type LayoutSources, lookAtLayout, readerPart, readLayoutAsk } from '../../layout/index.ts'
import { sameName } from '../../record/index.ts'
import { type conceptReads, readerLine } from './brief.ts'
import { parseConcept, partId, termId } from './concept.ts'
import { answeredOf, answersOf, fileQuotes, toldOfPart } from './told.ts'

export function memoryOf(layout: LayoutSources, reads: ReturnType<typeof conceptReads>, history: History): Memory {
	// A concept by its id, or a part, term or process by the name the reader sees.
	async function known(about: string): Promise<Known | null> {
		const now = new Date()
		const id = parseConcept(about)
			? about
			: (await reads.concepts(now)).find((row) => sameName(row.name, about.replace(/^part::/, '')))?.id
		const brief = id ? await reads.brief(id, now) : null
		if (!brief) return null
		return {
			id: brief.id,
			kind: brief.kind,
			name: brief.name,
			line: brief.line,
			reader: readerLine(brief.knows),
			quotes: brief.quotes ?? [],
			changed: brief.staleFiles ?? [],
			links: [
				...brief.sideways.uses.map((link) => `From ${brief.name} to ${link.name}: ${link.verb} (${link.id})`),
				...brief.sideways.usedBy.map((link) => `From ${link.name} to ${brief.name}: ${link.verb} (${link.id})`),
				...[...(brief.inside ?? []), ...(brief.parts ?? [])].map((child) => `Contains ${child.name} (${child.id})`),
			],
			points: brief.explained ? brief.points.map(({ line, quotes }) => ({ line, quotes })) : [],
			terms: brief.terms.map((term) => term.name),
			questions: brief.questions.map(({ text, answered }) => ({ text, answered })),
		}
	}

	async function level(within: string[]): Promise<KnownLevel | null> {
		const now = new Date()
		const ask = await readLayoutAsk(layout, { within, change: 'none' }, now)
		if (ask.kind !== 'ok') return null
		const look = await lookAtLayout(layout, ask.ask, now)
		if (!look.named) return null
		const { explained } = await reads.levelTold(look)
		return {
			within: look.within,
			about: look.named.about ?? null,
			parts: look.boxes.map((box) => ({
				name: box.name,
				job: box.job,
				paths: box.paths,
				explained: explained.includes(box.name),
			})),
			arrows: look.arrows.map(({ from, to, text }) => ({ from, to, text })),
			flows: look.named.flows,
		}
	}

	// The newest brief of each part and the newest answer to each question, then the terms of the record.
	async function facts(): Promise<Fact[]> {
		const answered = answeredOf(await history.list())
		const parts = new Map<string, Fact[]>()
		for (const { reply } of answered) {
			const { tour } = reply
			for (const stop of tour?.stops ?? []) {
				const id = partId(tour?.within ?? [], stop.name)
				const told = parts.has(id) ? null : toldOfPart(answered, tour?.within ?? [], stop.name)
				if (!told) continue
				const kind = 'brief' as const
				parts.set(
					id,
					told.points.map((point) => ({ about: id, name: stop.name, kind, text: point.more, quotes: point.quotes })),
				)
			}
		}
		const answers = answersOf(answered).flatMap((answer) =>
			answer.told.points.map((point) => ({
				about: answer.id,
				name: answer.text,
				kind: 'answer' as const,
				text: point.more,
				quotes: point.quotes,
			})),
		)
		const { current } = await layout.record.read()
		const terms = current.flatMap((entry) => {
			if (entry.kind !== 'topic') return []
			const note = current.findLast((each) => each.kind === 'note' && each.topic === entry.id)
			const text = note?.kind === 'note' ? note.text : ''
			return [
				{ about: termId(entry.name), name: entry.name, kind: 'term' as const, text, quotes: fileQuotes(entry.quotes) },
			]
		})
		return [...[...parts.values()].flat(), ...answers, ...terms]
	}

	return {
		known,
		level,
		facts,
		async readerPart(question, record, signal) {
			const found = await readerPart(layout, question, record, signal)
			if (!found) return null
			const { name, commit, within, reader, source, neighbor } = found
			const part = { name, id: partId(within, name) }
			const focus: QuestionFocus = source
				? { part, commit, path: source.path, start: 1, end: source.end }
				: { part, commit, view: 'parts', concepts: [part.id], earlier: found.earlier }
			const lines = [
				reader ? `Reader's map for ${name}: ${reader}` : '',
				`The layout at ${found.drawnAt.slice(0, 7)} names this part ${JSON.stringify(name)}. Open ${part.id} with memory_known for more.`,
				neighbor
					? `Another part in the same layout is ${JSON.stringify(neighbor.name)}. Its path ${JSON.stringify(neighbor.path)} exists at this commit.`
					: '',
				neighbor?.source
					? `Ken also read lines 1 to ${neighbor.source.end} of ${JSON.stringify(neighbor.path)} at ${commit}:\n${neighbor.source.text}`
					: '',
				neighbor?.arrow ? `The saved layout connects them: ${JSON.stringify(neighbor.arrow)}.` : '',
				source
					? `Ken read ${JSON.stringify(source.path)} at ${commit}. Lines 1 to ${source.end} are quoted as data:\n${source.text}`
					: '',
				'Base your explanation and next reading suggestion on this evidence. Check other files before suggesting them. Use show to quote the relevant lines.',
			]
			return { focus, text: lines.filter(Boolean).join('\n') }
		},
	}
}
