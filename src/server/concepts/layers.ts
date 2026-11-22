// The layers of what ken's model knows of a project, and the jobs that fill what is missing, in the order the queue
// fills them. Layer 0 is the project: its parts with the drawings of where it runs, then its main process drawn.
// Layer 1 is the brief of each part, in tour order. Layer 2 names the parts inside each part the reader has opened.
// Last come the questions each brief lists, answered ahead of the reader. Plain code: it reads the layout, the
// reader's history and what they opened, and asks no model. What is missing is worked out again from what exists each
// time, so a server that starts again, or a run that failed halfway, ends with the same jobs.
import { type LayoutSources, lookAtLayout, readLayoutAsk, tourOrder, under } from '../../layout/index.ts'
import type { ReaderSeen } from '../../map/index.ts'
import type { conceptReads } from './brief.ts'
import { partId, questionId } from './concept.ts'

// 0 the project, 1 a part's brief, 2 the parts inside a part, 3 a question a brief lists.
export type Layer = 0 | 1 | 2 | 3

// key is the job's name for what it makes (see lensKey). lens is what the page would send to have it made.
export type LayerJob = {
	key: string
	kind: 'parts' | 'process' | 'explain' | 'inner' | 'answer'
	concept: string | null
	title: string
	order: number
	layer: Layer
	lens: Record<string, unknown>
}

// What the reader looks at now, as the page says: the brief open in the drawer, and the level on the Architecture
// canvas, or null on another page.
export type Looking = { brief: string | null; within: string[] | null }

// The questions of each brief ken answers ahead of the reader. Each is a model run, so only the first few.
export const QUESTIONS_PER_PART = 2

// The name of the thing a lens makes, so a job ken queued and the same request from the reader are one job. A lens
// whose thing has no name of its own, such as a question typed in the reader's words, gets none.
export function lensKey(lens: unknown): string | null {
	const field = (name: string) => (typeof lens === 'object' && lens !== null ? Reflect.get(lens, name) : undefined)
	const within = field('within')
	const paths = Array.isArray(within) ? within.map(String).toSorted() : []
	const text = field('text')
	switch (field('kind')) {
		case 'parts':
			return `parts:${paths.join(',')}`
		case 'views':
			return 'views:'
		case 'view':
			return typeof text === 'string' ? `view:${paths.join(',')}:${text.trim()}` : null
		case 'explain': {
			const part = field('part')
			return typeof part === 'string' ? `explain:${partId(paths, part)}` : `explain:${paths.join(',')}:every`
		}
		case 'answer': {
			const concept = field('concept')
			return typeof concept === 'string' && typeof text === 'string' ? `answer:${questionId(concept, text)}` : null
		}
		default:
			return null
	}
}

export function layerPlan(layout: LayoutSources, reads: ReturnType<typeof conceptReads>, seen: ReaderSeen) {
	let looking: Looking = { brief: null, within: null }

	async function levelAt(within: string[], now: Date) {
		const ask = await readLayoutAsk(layout, { within, change: 'none' }, now)
		return ask.kind === 'ok' ? await lookAtLayout(layout, ask.ask, now) : null
	}

	// The paths of the parts the reader opened, from the lines ken keeps on what they looked at.
	async function opened(): Promise<string[]> {
		const { lines } = await seen.read()
		return lines.flatMap((line) => (line.did === 'opened' ? line.paths : []))
	}

	// Every job whose thing is missing or no longer matches the code, in the order of the layers.
	async function missing(now: Date): Promise<LayerJob[]> {
		const top = await levelAt([], now)
		if (!top) return []
		const job = (made: Omit<LayerJob, 'key'>): LayerJob => ({ ...made, key: lensKey(made.lens) ?? '' })
		if (!top.named) {
			const lens = { kind: 'parts', within: [], name: null }
			return [job({ kind: 'parts', concept: null, title: 'Naming the main parts', order: 0, layer: 0, lens })]
		}
		const jobs: LayerJob[] = []
		const [flow] = top.named.flows
		const drawn = (await reads.processes([], now))?.processes ?? []
		if (flow && drawn.length === 0) {
			const lens = { kind: 'view', within: [], name: null, text: flow }
			jobs.push(job({ kind: 'process', concept: null, title: `Drawing ${flow}`, order: 1, layer: 0, lens }))
		}
		const looked = await opened()
		const order = tourOrder(top.boxes.filter((box) => box.state !== 'gone'))
		for (const [at, stop] of order.entries()) {
			const concept = partId([], stop.name)
			const brief = await reads.brief(concept, now)
			if (!brief) continue
			if (!brief.explained || brief.staleFiles) {
				const lens = { kind: 'explain', within: [], part: stop.name }
				jobs.push(job({ kind: 'explain', concept, title: `Explaining ${stop.name}`, order: 100 + at, layer: 1, lens }))
				continue
			}
			const asked = brief.questions.filter((question) => !question.answered).slice(0, QUESTIONS_PER_PART)
			for (const [k, question] of asked.entries()) {
				const lens = { kind: 'answer', concept, text: question.text }
				const title = `Answering "${question.text}"`
				jobs.push(job({ kind: 'answer', concept: question.id, title, order: 300 + at * 10 + k, layer: 3, lens }))
			}
			const box = top.boxes.find((each) => each.name === stop.name)
			const opens = box?.opens && looked.some((path) => box.paths.some((place) => under(path, place)))
			if (!box || !opens) continue
			const within = box.paths.toSorted()
			if ((await levelAt(within, now))?.named) continue
			const lens = { kind: 'parts', within, name: box.name }
			const title = `Naming the parts inside ${box.name}`
			jobs.push(job({ kind: 'inner', concept, title, order: 200 + at, layer: 2, lens }))
		}
		return jobs
	}

	async function fresh(key: string): Promise<boolean> {
		return !(await missing(new Date())).some((job) => job.key === key)
	}

	// How near a job is to what the reader looks at: 2 when it fills it, 3 for the layer below a part they opened, 4
	// for the rest. With a brief open the reader looks at that brief, not at the level behind the drawer.
	function rankOf(job: { layer: Layer; concept: string | null }): 2 | 3 | 4 {
		const onTop = looking.within?.length === 0 && looking.brief === null
		if (job.layer === 1 && (job.concept === looking.brief || onTop)) return 2
		if (job.layer === 0 && onTop) return 2
		if (job.layer === 2) return 3
		return 4
	}

	return {
		missing,
		fresh,
		rankOf,
		look(now: Looking) {
			looking = now
		},
	}
}
