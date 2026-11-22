// The layers of what ken's model knows of a project, and the jobs that fill what is missing, in the order the queue
// fills them. Layer 0 is the project: its parts with the drawings of where it runs, then its main process drawn.
// Layer 1 is the brief of each part, in tour order. Layer 2 names the parts inside each part the reader has opened.
// Last come two questions the briefs of the parts the reader opened list, answered ahead of the reader. Nothing more,
// so the queue ends. Plain code: it reads the layout, the
// reader's history and what they opened, and asks no model. What is missing is worked out again from what exists each
// time, so a server that starts again, or a run that failed halfway, ends with the same jobs.
import { type LayoutSources, lookAtLayout, under } from '../../layout/index.ts'
import type { ReaderSeen } from '../../map/index.ts'
import type { conceptReads } from './brief.ts'
import { parseConcept, partId, questionId } from './concept.ts'

// 0 the project, 1 a part's brief, 2 the parts inside a part, 3 a question a brief lists.
export type Layer = 0 | 1 | 2 | 3

// key is the job's name for what it makes (see lensKey). lens is what the page would send to have it made.
export type LayerJob = {
	key: string
	kind: 'parts' | 'views' | 'process' | 'explain' | 'inner' | 'answer'
	concept: string | null
	title: string
	order: number
	layer: Layer
	lens: Record<string, unknown>
}

// What the reader looks at now, as the page says: the brief open in the drawer, and the level on the Architecture
// canvas, or null on another page.
export type Looking = { brief: string | null; within: string[] | null }

// The questions ken answers ahead of the reader, in all. Each is a model run, so only the first few.
const QUESTIONS_AHEAD = 2

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
	let openedArchitecture = false

	// The paths of the parts the reader opened, from the lines ken keeps on what they looked at.
	async function opened(): Promise<string[]> {
		const { lines } = await seen.read()
		return lines.flatMap((line) => (line.did === 'opened' ? line.paths : []))
	}

	// Every job whose thing is missing or no longer matches the code, in the order of the layers.
	async function missing(now: Date): Promise<LayerJob[]> {
		const head = await layout.repo.resolve('HEAD')
		if (head.kind !== 'ok') return []
		// Jobs prepare explanations of committed code. The reader's uncommitted changes need no snapshot here.
		const top = await lookAtLayout(layout, { at: head.commit, within: [], change: null, own: null }, now)
		const job = (made: Omit<LayerJob, 'key'>): LayerJob => ({ ...made, key: lensKey(made.lens) ?? '' })
		if (!top.named) {
			const lens = { kind: 'parts', within: [], name: null }
			const title = 'ken is naming the main parts of the project.'
			return [job({ kind: 'parts', concept: null, title, order: 0, layer: 0, lens })]
		}
		const jobs: LayerJob[] = []
		const missingViews = openedArchitecture && !top.views?.world && !top.views?.runtime
		if (missingViews || top.views?.stale?.length) {
			jobs.push(
				job({
					kind: 'views',
					concept: null,
					title: missingViews ? 'ken is drawing the architecture.' : 'ken is updating the architecture drawings.',
					order: 0,
					layer: 0,
					lens: { kind: 'views', within: [] },
				}),
			)
		}
		const [flow] = top.named.flows
		const progress = await reads.levelProgress(top, now)
		if (flow && !progress.hasProcess) {
			const lens = { kind: 'view', within: [], name: null, text: flow }
			const title = `ken is drawing a process: ${flow}.`
			jobs.push(job({ kind: 'process', concept: null, title, order: 1, layer: 0, lens }))
		}
		const looked = await opened()
		const order = top.tour ?? []
		let ahead = QUESTIONS_AHEAD
		for (const [at, stop] of order.entries()) {
			const concept = partId([], stop.name)
			const opened = looked.some((path) => stop.paths.some((place) => under(path, place)))
			const questions = await progress.firstQuestions(stop.name, opened ? ahead : 0)
			if (!questions) {
				const lens = { kind: 'explain', within: [], part: stop.name }
				const title = `ken is explaining ${stop.name}.`
				jobs.push(job({ kind: 'explain', concept, title, order: 100 + at, layer: 1, lens }))
				continue
			}
			if (!opened) continue
			// An answered or stopped question still uses its place in the two the project prepares.
			ahead -= questions.length
			for (const [k, question] of questions.entries()) {
				if (question.answered) continue
				const lens = { kind: 'answer', concept, text: question.text }
				const title = `ken is answering a question ahead of you: ${question.text}`
				jobs.push(job({ kind: 'answer', concept: question.id, title, order: 300 + at * 10 + k, layer: 3, lens }))
			}
			const box = top.boxes.find((each) => each.name === stop.name)
			if (!box?.opens || box.inside !== null) continue
			const within = box.paths.toSorted()
			const lens = { kind: 'parts', within, name: box.name }
			const title = `ken is naming the parts inside ${box.name}.`
			jobs.push(job({ kind: 'inner', concept, title, order: 200 + at, layer: 2, lens }))
		}
		return jobs
	}

	async function fresh(key: string): Promise<boolean> {
		return !(await missing(new Date())).some((job) => job.key === key)
	}

	// How near a job is to what the reader looks at: 2 when it fills it, 3 for the layer below a part they opened, 4
	// for the rest. With a brief open the reader looks at that brief, not at the level behind the drawer.
	function rankOf(job: { key: string; layer: Layer; concept: string | null; kind?: string }): 2 | 3 | 4 {
		const onTop = looking.within?.length === 0 && looking.brief === null
		const onCanvas = looking.brief === null && looking.within !== null
		if (job.layer === 1 && (job.concept === looking.brief || onTop)) return 2
		if (job.layer === 0 && onTop) return 2
		if (job.layer === 2 && onCanvas && job.key === lensKey({ kind: 'parts', within: looking.within })) return 2
		if (job.kind === 'views' && looking.brief) {
			const kind = parseConcept(looking.brief)?.kind
			if (kind === 'outside' || kind === 'store' || kind === 'frame' || kind === 'crossing') return 2
		}
		if (job.layer === 2) return 3
		return 4
	}

	return {
		missing,
		fresh,
		rankOf,
		look(now: Looking) {
			looking = now
			if (now.within?.length === 0 && now.brief === null) openedArchitecture = true
		},
	}
}
