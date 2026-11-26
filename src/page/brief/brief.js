// The brief: one concept the reader can take in within a few minutes, in a drawer on the right, over the page they
// are on. From the top: the trail of briefs they came through, the kind and the minutes, the name and the one line
// that defines it, a picture, the things to know, each a line beside a small drawing, its terms, and what ken thinks
// the reader knows of it with "Not right?". At the foot, always in the same place: the three ways on, Sideways,
// Questions and Deeper. The setting for text decides how much stands under each line. A concept ken's
// model has not explained yet still opens, with what git says of it and one button for the rest.

import { runtimePicture } from '../arch-views/switch.js'
import { inLine, jobLineHtml, jobOf } from '../jobs/jobs.js'
import { KNOWN, levelLabel } from '../level/level-state.js'
import { DOING } from '../level/runs.js'
import { partClass, partOfFile } from '../project/part-colours.js'
import { placeParts } from '../project/parts-picture.js'
import { icon, KIND_ICONS, levelMark } from '../shell/icons.js'
import { readPlace, writePlace } from '../shell/place.js'
import { codeLines, count, esc, lineSpan, prose, quoteBody, quoteSource, RUN_COST } from '../views/format.js'
import { readConcept } from './concept-id.js'
import { drawingHtml } from './drawings.js'
import {
	isViewKind,
	viewDeeperCount,
	viewDeeperHtml,
	viewKindHtml,
	viewMainHtml,
	viewSidewaysHtml,
	withEnds,
} from './view-kinds.js'

export const TEXTS = { pictures: 'Pictures first', balanced: 'Balanced', words: 'More words' }
const KINDS = {
	part: 'Part',
	file: 'File',
	process: 'Process',
	step: 'Step',
	term: 'Term',
	question: 'Question',
	decision: 'Decision',
	arrow: 'Arrow',
	change: 'Change',
	project: 'Project',
}
export const WAYS = {
	sideways: ['Sideways', 'What it is next to'],
	questions: ['Questions', 'Worth asking'],
	deeper: ['Deeper', 'Inside it'],
}

// The files a brief is about, for what the page tells ken: the part's own paths, or the files its quotes are in.
export function pathsOf(brief) {
	if (brief.source) return [brief.source.path]
	if (brief.paths?.length > 0) return brief.paths
	const concept = readConcept(brief.id)
	if (brief.deeper) return brief.deeper.within.split(',')
	if (concept?.kind === 'part') return concept.within.filter((path) => path.split('/').at(-1) === concept.name)
	const quoted = [
		...(brief.quotes ?? []),
		...brief.points.flatMap((point) => point.quotes),
		...(brief.steps ?? []).flatMap((step) => step.quotes),
	]
	return [...new Set(quoted.map((quote) => quote.path).filter((path) => typeof path === 'string'))]
}

// The class of the colour a brief takes: its part's, or that of the part its first file sits in.
export function colourOf(brief) {
	const own = partClass(brief.name)
	if (own) return own
	const file = pathsOf(brief)[0]
	return file ? partClass(partOfFile(file) ?? '') : ''
}

const waysCount = (brief) => ({
	sideways: byPart(brief.sideways.uses).length + byPart(brief.sideways.usedBy).length + brief.sideways.processes.length,
	questions: brief.questions.length + brief.decisions.length,
	deeper: isViewKind(brief.kind) ? viewDeeperCount(brief) : brief.deeper ? brief.deeper.parts || brief.deeper.files : 0,
})

// A row that opens another brief.
export function rowHtml({ id, name, note, key, swatch = null, number = null }) {
	const concept = readConcept(id)
	const lead =
		number !== null
			? `<span class="k-row-num k-num ${swatch ?? ''}">${number}</span>`
			: swatch !== null
				? `<span class="k-row-ic"><span class="k-sw ${swatch}"></span></span>`
				: `<span class="k-row-ic">${icon(KIND_ICONS[concept?.kind] ?? 'term')}</span>`
	return `<li><button class="k-row" data-act="brief-open" data-concept="${esc(id)}" data-key="${key}">${lead}<span class="k-row-main"><b>${prose(name)}</b>${note ? `<span class="k-row-note">${prose(note)}</span>` : ''}</span>${icon('right', 'k-row-go')}</button></li>`
}

// A part of the project as a row that opens its brief.
export const partRowHtml = ({ id, name, note, i }) =>
	rowHtml({ id, name, note, key: `brief-part-${i}`, swatch: partClass(name) })

const swatchOf = (id) => {
	const concept = readConcept(id)
	return concept?.kind === 'part'
		? partClass(concept.name) || partClass(partOfFile(concept.within[0] ?? '') ?? '')
		: null
}

function quotesHtml(quotes) {
	return quotes
		.map((quote) => quoteBody(quote, `<code>${esc(quote.path)}</code>, ${lineSpan(quote.startLine, quote.endLine)}. `))
		.join('')
}

// The part's level as a small map, with the part lit: where it stands among the others.
function mapHtml(brief, look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)]).filter(([a, b]) => a >= 0 && b >= 0)
	if (look.boxes.length > 6) return ''
	const { rows, cols, cells } = placeParts(look.boxes.length, links)
	const mid = (cell) => `${cell.col * 100 + 50} ${cell.row * 100 + 50}`
	const lines = links.map(([a, b]) => `<path d="M${mid(cells[a])}L${mid(cells[b])}"/>`)
	const inner = look.within.length > 0 ? partClass(partOfFile(look.within[0]) ?? '') : null
	const boxes = look.boxes.map((box, i) => {
		const lit = brief.lit ? brief.lit.includes(box.name) : box.name === brief.name
		return `<span class="k-map-box ${inner ?? partClass(box.name)}${lit ? ' is-lit' : ''}" style="grid-row:${cells[i].row + 1};grid-column:${cells[i].col + 1}"><span class="k-map-name">${esc(box.name)}</span></span>`
	})
	return `<div class="k-pic k-map" style="--cols:${cols}" role="img" aria-label="${esc(brief.name)} among the ${look.boxes.length} parts of its level"><svg viewBox="0 0 ${cols * 100} ${rows * 100}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${boxes.join('')}</div>`
}

// A process as its stops in order, each in the colour of its part.
function stepsPicHtml(brief) {
	const beads = brief.steps.map(
		(step) => `<span class="k-bead k-num ${step.part ? (swatchOf(step.part) ?? '') : ''}">${step.n}</span>`,
	)
	return `<div class="k-pic k-steps-pic" aria-hidden="true">${beads.join('<span class="k-steps-line"></span>')}</div>`
}

function pictureHtml(brief, look) {
	if (brief.steps?.length > 0) return stepsPicHtml(brief)
	if ((brief.kind === 'part' || brief.kind === 'file' || brief.lit) && look) return mapHtml(brief, look)
	if (brief.usedIn?.length > 0) {
		const parts = brief.usedIn.map(
			(part) =>
				`<span class="k-map-box is-lit ${swatchOf(part.id) ?? ''}"><span class="k-map-name">${esc(part.name)}</span></span>`,
		)
		return `<div class="k-pic k-used" role="img" aria-label="Used in ${esc(brief.usedIn.map((part) => part.name).join(', '))}"><span class="k-eyebrow">Used in</span>${parts.join('')}</div>`
	}
	return ''
}

function pointHtml(point, i, ui) {
	const open = ui.openQuotes.has(i)
	const refs = point.quotes.map((quote) => `${quote.path}:${quote.startLine}`)
	const show = open
		? 'Hide the lines'
		: point.quotes.length === 1
			? 'Show the line it rests on'
			: `Show the ${point.quotes.length} quotes it rests on`
	// In "Pictures first" the way to the quoted lines is the small mark at the end of the line, named for a screen
	// reader, so no words stand under the line.
	const ref =
		point.quotes.length === 0
			? ''
			: `<button class="k-point-ref" data-act="brief-quote" data-index="${i}" data-key="point-${i}" aria-expanded="${open}" aria-label="${show}" title="${show}"><span class="k-point-files k-mono">${esc(refs.join(', '))}</span><span class="k-point-show">${show}</span>${icon('code', 'k-point-mark')}</button>`
	const label = point.drawing?.label ? `<span class="k-drawing-label">${esc(point.drawing.label)}</span>` : ''
	return `<li class="k-point">
		<span class="k-point-draw">${drawingHtml(point.drawing)}${label}</span>
		<div class="k-point-words">
			<p class="k-point-line">${prose(point.line)}</p>
			${point.more ? `<p class="k-point-more">${prose(point.more)}</p>` : ''}
			${point.long ? `<p class="k-point-long">${prose(point.long)}</p>` : ''}
			${ref}
			${open ? `<div class="k-quotes">${quotesHtml(point.quotes)}</div>` : ''}
		</div>
	</li>`
}

// The reader can ask for a first explanation or update one whose evidence changed. While ken's queue holds the
// brief's run, every tab says the same: its place in line and when it starts, or how long it has run, from the queue.
function explainHtml(brief, env, ui) {
	const run = env.running?.onHome
	const job = jobOf(env.jobs ?? [], brief.id)
	const what = brief.kind === 'question' ? 'answered this' : 'explained this'
	if (job && !brief.staleFiles) {
		const reading = jobLineHtml(job, brief.kind === 'question' ? 'answering this' : 'reading this part')
		const act =
			job.state.kind === 'waiting'
				? `<button class="k-btn is-quiet k-run-btn" data-act="brief-explain" data-key="brief-explain"${env.off ? ' disabled' : ''}><span>${brief.kind === 'question' ? 'Answer now' : 'Explain now'}</span><small>It goes first</small></button>`
				: job.by === 'reader'
					? `<button class="k-link" data-act="job-stop" data-job="${esc(job.key)}" data-key="brief-stop">Stop</button>`
					: ''
		return `<div class="k-unexplained">${reading}<p class="k-muted">The brief fills in here when ken is done.</p>${act}</div>`
	}
	if (run?.kind === 'explain' && run.concept === brief.id) return workingHtml(run, env)
	if (!brief.explain) {
		return `<div class="k-unexplained"><p>ken's model has not ${what} yet.</p></div>`
	}
	const current = brief.checkedAt
		? brief.staleFiles
				.map((path, i) => {
					const start = brief.quotes?.find((quote) => quote.path === path)?.startLine ?? 1
					return `<button class="k-link" data-act="brief-source" data-key="current-source-${i}" data-path="${esc(path)}" data-commit="${esc(brief.checkedAt)}" data-start="${start}">Read ${esc(path)} at ${esc(brief.checkedAt.slice(0, 7))}</button>`
				})
				.join(' ')
		: ''
	const status = brief.staleFiles
		? `ken could not match the saved quotes to the current code in ${brief.staleFiles.join(', ')}.`
		: `ken's model has not ${what} yet. What is here comes from git.`
	const does = brief.staleFiles
		? brief.explain.lens.kind === 'views'
			? 'Update the drawings'
			: 'Update this brief'
		: brief.kind === 'question'
			? 'Ask ken to answer it'
			: 'Ask ken to explain it'
	return `<div class="k-unexplained">
		<p>${esc(status)}</p>
		${current}
		<button class="k-btn is-big k-run-btn" data-act="${brief.explain.lens.kind === 'views' ? 'arch-draw-views' : 'brief-explain'}" data-key="brief-explain"${env.off ? ' disabled' : ''}><span>${does}</span><small>${RUN_COST}</small></button>
		${env.off ? `<p class="k-muted">${esc(env.off)}</p>` : ''}
		${ui.problem ? `<p class="k-ask-problem" role="alert">${esc(ui.problem)}</p>` : ''}
	</div>`
}

function workingHtml(run, env) {
	const tools = env.running.q.steps.filter((step) => step.kind === 'tool').length
	const newest = env.running.q.steps.findLast((step) => step.kind === 'tool')?.text ?? ''
	return `<div class="k-unexplained" role="status"><p><span class="k-spin" aria-hidden="true"></span> <b>${DOING[run.kind][1]}.</b></p><p class="k-muted k-num k-clock">${Math.round(env.seconds)} s so far, ${count(tools, 'action', 'actions')}</p>${newest ? `<p class="k-muted k-working-step">${prose(newest)}</p>` : ''}<button class="k-link" data-act="stop" data-key="brief-stop">Stop</button></div>`
}

function mainHtml(brief, { ui, env, prefs, look, views, inner, runtime, home }) {
	const texts = Object.entries(TEXTS).map(
		([text, name]) =>
			`<button data-act="pref-text" data-text="${text}" data-key="brief-text-${text}" aria-pressed="${prefs.text === text}">${name}</button>`,
	)
	const about = brief.about
		? `<p class="k-about">About <button class="k-link" data-act="brief-open" data-concept="${esc(brief.about.id)}" data-key="brief-about">${esc(brief.about.name)}</button></p>`
		: ''
	const points =
		brief.points.length === 0
			? ''
			: `<h3 class="k-eyebrow">${brief.kind === 'question' ? 'The answer' : count(brief.points.length, 'thing to know', 'things to know')}</h3><ul class="k-points">${brief.points.map((point, i) => pointHtml(point, i, ui)).join('')}</ul>`
	const steps =
		brief.steps?.length > 0
			? `<h3 class="k-eyebrow">${count(brief.steps.length, 'step', 'steps')}</h3><ol class="k-rows">${brief.steps
					.map((step) =>
						rowHtml({
							id: `step:${readConcept(brief.id).name}:${step.n}`,
							name: step.line,
							note: step.part ? readConcept(step.part).name : '',
							key: `brief-step-${step.n}`,
							swatch: step.part ? swatchOf(step.part) : '',
							number: step.n,
						}),
					)
					.join('')}</ol>`
			: ''
	const why = brief.why
		? `<h3 class="k-eyebrow">Why (${esc(brief.reasonSource)})</h3><p class="k-why">${prose(brief.why)}</p>
			${brief.reasonQuotes?.length ? `<details class="dv-quotes"><summary>Show the evidence for this reason</summary>${brief.reasonQuotes.map((quote) => quoteBody(quote, `${quoteSource(quote)}. `)).join('')}</details>` : ''}`
		: brief.kind === 'decision'
			? '<p>No reason was recorded.</p>'
			: ''
	const lines =
		brief.quotes?.length > 0
			? `<h3 class="k-eyebrow">${brief.kind === 'decision' ? 'Where the choice appears in code' : isViewKind(brief.kind) ? (brief.staleFiles ? 'Source for the earlier drawing' : 'ken found this in') : brief.quotes.length === 1 ? 'The lines it rests on' : `The ${brief.quotes.length} quotes it rests on`}</h3><div class="k-quotes">${quotesHtml(brief.quotes)}</div>`
			: ''
	const terms =
		brief.terms.length === 0
			? ''
			: `<h3 class="k-eyebrow">Its terms</h3><div class="k-terms">${brief.terms
					.map(
						(term, i) =>
							`<button class="k-chip" data-act="brief-open" data-concept="${esc(term.id)}" data-key="brief-term-${i}">${icon('term')}${esc(term.name)}</button>`,
					)
					.join('')}</div>`
	const kind = isViewKind(brief.kind)
		? viewKindHtml(brief.kind)
		: `<span class="k-kind">${icon(KIND_ICONS[brief.kind] ?? 'term')}${KINDS[brief.kind] ?? 'Concept'}</span>`
	return `<div class="k-brief-top">
			${kind}
			<span class="k-min">${icon('clock')}<span class="k-num">${brief.minutes}</span> min</span>
			<span class="k-seg k-text-seg" role="group" aria-label="How much text">${texts.join('')}</span>
		</div>
		<h2 class="k-brief-name" id="brief-name" tabindex="-1"><span class="k-sw"></span><span>${prose(brief.name)}</span></h2>
		${brief.replacedBy ? `<p class="dv-replaced"><strong>A later decision replaces this one.</strong> <button class="k-link" data-act="brief-open" data-concept="${esc(brief.replacedBy)}" data-key="brief-later-decision">Open the later decision</button></p>` : ''}
		${brief.staleFiles ? explainHtml(brief, env, ui) : ''}
		<p class="k-brief-line">${isViewKind(brief.kind) && brief.staleFiles ? 'Earlier drawing. ' : ''}${prose(brief.line)}</p>
		${brief.note ? `<p class="k-brief-note"><span class="k-eyebrow">What the record says it means</span>${prose(brief.note)}</p>` : ''}
		${about}
		${
			// Opened from "Where it runs", the picture is that drawing in small, with the brief's own thing lit.
			isViewKind(brief.kind) || (runtime && brief.kind === 'part')
				? `${runtimePicture(views, brief.id, partClass) || pictureHtml(brief, look)}${isViewKind(brief.kind) ? viewMainHtml(brief, views) : ''}`
				: pictureHtml(brief, look)
		}
		${brief.html ?? ''}
		${brief.explained || brief.staleFiles ? '' : explainHtml(brief, env, ui)}
		${fromGitHtml(brief, inner)}
		${points}
		${steps}
		${why}
		${lines}
		${terms}
		${knowsHtml(brief, home, ui)}
		${brief.kind === 'decision' ? '' : `<p class="k-trust">${esc(brief.trust)}</p>`}`
}

const backHtml = '<button class="k-back" data-act="brief-way" data-way="" data-key="brief-back">'

// Two arrows can join the same two parts: the part is one row, with both verbs.
function byPart(rows) {
	const parts = new Map()
	for (const row of rows) {
		const have = parts.get(row.id)
		const verbs = row.verb ? [row.verb] : []
		if (have) have.verbs.push(...verbs)
		else parts.set(row.id, { ...row, verbs })
	}
	return [...parts.values()]
}

function sidewaysHtml(brief) {
	const uses = byPart(brief.sideways.uses)
	const usedBy = byPart(brief.sideways.usedBy)
	const { processes } = brief.sideways
	const group = (title, rows, key, note) =>
		rows.length === 0
			? ''
			: `<h3 class="k-eyebrow">${title}</h3><ul class="k-rows">${rows.map((row, i) => rowHtml({ id: row.id, name: row.name, note: note(row), key: `${key}-${i}`, swatch: swatchOf(row.id) })).join('')}</ul>`
	const none =
		uses.length + usedBy.length + processes.length === 0
			? '<p class="k-none">Nothing stands next to it: no arrow goes to it or from it, and no drawn process passes through it.</p>'
			: ''
	return `${backHtml}${icon('left')}The brief</button>
		<h2 class="k-way-name" id="brief-name" tabindex="-1">Next to ${prose(brief.name)}</h2>
		${group('Used by', usedBy, 'by', (row) => row.verbs.map((verb) => `${verb} it`).join(', and '))}
		${group('It uses', uses, 'uses', (row) => row.verbs.join(', and '))}
		${group('Processes that pass through', processes, 'through', (row) => count(row.steps, 'step', 'steps'))}
		${none}`
}

function questionsHtml(brief, { ui, env }) {
	const run = env.running?.onHome
	const asking = run?.kind === 'answer' && run.concept === brief.id ? run : null
	const rows = brief.questions.map((question, i) => {
		if (question.answered)
			return rowHtml({ id: question.id, name: question.text, note: 'Answered', key: `brief-q-${i}` })
		const busy = asking?.text === question.text
		const ahead = jobOf(env.jobs ?? [], question.id)
		const note = busy
			? "ken's model is answering it."
			: ahead?.state.kind === 'running'
				? 'ken is preparing an answer now.'
				: ahead
					? `ken is preparing an answer: ${inLine(ahead.place)}.`
					: 'No answer yet.'
		// Pressing it while ken prepares the answer joins that run, so the button opens it rather than offering a run.
		const button = ahead
			? '<span>Open it</span><small>It fills in as ken writes it</small>'
			: "<span>Ask ken</span><small>One run of ken's model</small>"
		return `<li class="k-row is-open"><span class="k-row-ic">${icon('question')}</span><span class="k-row-main"><b>${prose(question.text)}</b><span class="k-row-note">${note}</span></span><button class="k-btn is-quiet k-run-btn" data-act="brief-answer" data-index="${i}" data-key="brief-ask-${i}"${env.off ? ' disabled' : ''}>${button}</button></li>`
	})
	const decided =
		brief.decisions.length === 0
			? ''
			: `<h3 class="k-eyebrow">Decided here</h3>${brief.decisions
					.map(
						(d, i) =>
							`<div class="k-decision"><button class="k-decision-name" data-act="brief-open" data-concept="${esc(d.id)}" data-key="brief-d-${i}">${icon('decision')}<b>${prose(d.question)}</b>${icon('right', 'k-row-go')}</button><p><span class="k-eyebrow">Chosen</span>${prose(d.chosen)}</p>${d.why ? `<p><span class="k-eyebrow">Why (${esc(d.reasonSource)})</span>${prose(d.why)}</p>` : ''}</div>`,
					)
					.join('')}`
	const none = rows.length === 0 ? '<p class="k-none">ken has no question written out for this yet.</p>' : ''
	const working =
		asking && !brief.questions.some((question) => question.text === asking.text) ? workingHtml(asking, env) : ''
	return `${backHtml}${icon('left')}The brief</button>
		<h2 class="k-way-name" id="brief-name" tabindex="-1">Questions about ${prose(brief.name)}</h2>
		${none}
		<ul class="k-rows">${rows.join('')}</ul>
		${decided}
		${working}
		<form class="k-askbox" id="brief-ask-form" autocomplete="off">
			<label class="k-eyebrow" for="brief-ask-text">Ask your own</label>
			<div><input id="brief-ask-text" name="text" data-key="brief-ask-text" maxlength="4000" placeholder="A question about ${esc(brief.name)}" /><button class="k-btn" type="submit" data-key="brief-ask-send"${env.off ? ' disabled' : ''}>Ask ken</button></div>
			<p class="k-muted">${env.off ? esc(env.off) : RUN_COST}</p>
			${ui.problem ? `<p class="k-ask-problem" role="alert">${esc(ui.problem)}</p>` : ''}
		</form>`
}

// inner is the level inside the part, once the page has read it: null while it reads.
// What is inside a part, one row each, with the sentence ken's model wrote of a file when it wrote one.
const insideRows = (brief, inner, key) =>
	(inner?.boxes ?? []).map((box, i) =>
		rowHtml({
			id: `part:${brief.deeper.within}:${box.name}`,
			name: box.name,
			note: box.told ?? box.job ?? count(box.files, 'file', 'files'),
			key: `${key}-${i}`,
			swatch: colourOf(brief),
		}),
	)

// What plain code shows of a part ken's model has not explained: its arrows in words and what is inside it.
function fromGitHtml(brief, inner) {
	if (brief.explained || brief.kind !== 'part') return ''
	const { uses, usedBy } = brief.sideways
	const said = [
		...uses.map((to) => `${brief.name} ${to.verb} ${to.name}.`),
		...usedBy.map((by) => `${by.name} ${by.verb} ${brief.name}.`),
	]
	const arrows =
		said.length > 0
			? `<h3 class="k-eyebrow">How it connects</h3><ul class="k-said">${said.map((line) => `<li>${prose(line)}</li>`).join('')}</ul>`
			: ''
	const rows = brief.deeper && inner ? insideRows(brief, inner, 'brief-file') : []
	const files =
		rows.length > 0 ? `<h3 class="k-eyebrow">What is inside it</h3><ul class="k-rows">${rows.join('')}</ul>` : ''
	return `${arrows}${files}`
}

function sourceUsesHtml(page, brief) {
	const controls = (page.names ?? [])
		.filter((name) => name !== page.uses?.name)
		.map(
			(name) =>
				`<button class="k-link" data-act="brief-uses" data-name="${esc(name)}" data-key="uses-${esc(name)}">Find uses of ${esc(name)}</button>`,
		)
	const choose =
		controls.length > 1
			? `<details><summary>Find uses of an export</summary><ul>${controls.map((control) => `<li>${control}</li>`).join('')}</ul></details>`
			: controls.join('')
	const used = page.uses
	if (!used)
		return (
			choose || (page.where.uses?.startsWith('@') ? '<p>No named export was identified in the selected lines.</p>' : '')
		)
	const name = esc(used.name)
	const place = readPlace(globalThis.location?.hash ?? '')
	const rows = used.lines.map((hit) => {
		const source = { path: hit.path, commit: page.where.commit, line: hit.line }
		const address = writePlace({ ...place, brief, on: 'source', source })
		return `<li><a class="k-link" href="${esc(address)}">${esc(hit.path)}, line ${hit.line}</a> <small>${hit.kind === 'import' ? 'Import' : 'Name in source'}</small>${hit.text !== null ? `<code>${esc(hit.text.trim())}</code>` : ''}</li>`
	})
	const empty = used.limited
		? 'Git could not return all matching lines.'
		: 'No single-line relative import matched this name and file at this revision. Other import forms may still use it.'
	return `${choose}<section class="k-source-uses"><h3>Uses of ${name}</h3>${rows.length ? `<p>Each file has a single-line relative import for ${name}. Open a line to see the name in context.</p><ul>${rows.join('')}</ul>${used.limited ? '<p>Only some matching lines are shown.</p>' : ''}` : `<p>${empty}</p>`}</section>`
}

function sourceHtml(page, back, brief) {
	const heading = `${back}<h2 class="k-way-name" id="brief-name" tabindex="-1">${esc(page.where.path)}</h2>`
	if (page.kind === 'reading') return `${heading}<p role="status">Reading the source from git.</p>`
	if (page.kind === 'error') return `${heading}<p role="alert">${esc(page.message)}</p>`
	if (page.total === 0) return `${heading}<p>This file is empty.</p>`
	const button = (start, label) =>
		start
			? `<button class="k-link" data-act="brief-source" data-key="source-${start}" data-start="${start}">${label}</button>`
			: ''
	const range = lineSpan(page.start, page.start + page.lines.length - 1)
	return `${heading}${page.where.line > page.total ? `<p>This version ends before line ${page.where.line}. Showing the end of the file.</p>` : ''}<p class="q-source">${range} of ${page.total} at commit <code>${esc(page.where.commit.slice(0, 7))}</code></p>
		<button class="k-link" data-act="ask-open" data-key="ask-source">Ask about these lines</button>
		${sourceUsesHtml(page, brief)}
		${page.shortened ? '<p>Long lines end with an ellipsis here.</p>' : ''}
		<pre class="code"><code>${codeLines(
			page.lines,
			page.lines.map((_, i) => page.start + i),
		)}</code></pre>
		<nav aria-label="Source lines">${button(page.previous, 'Previous lines')} ${button(page.next, 'Next lines')}</nav>`
}

function deeperHtml(brief, inner) {
	const { deeper } = brief
	if (!deeper) {
		return `${backHtml}${icon('left')}The brief</button><h2 class="k-way-name" id="brief-name" tabindex="-1">Inside ${prose(brief.name)}</h2><p class="k-none">Nothing is inside it: it is one file, or one thing.</p>`
	}
	const rows = insideRows(brief, inner, 'brief-in')
	const size = `${deeper.parts ? `${count(deeper.parts, 'part', 'parts')}, ` : ''}${count(deeper.files, 'file', 'files')}`
	return `${backHtml}${icon('left')}The brief</button>
		<h2 class="k-way-name" id="brief-name" tabindex="-1">Inside ${prose(brief.name)}</h2>
		<p class="k-brief-line">${size}.</p>
		${brief.kind === 'part' ? `<button class="k-btn" data-act="brief-inside" data-key="brief-inside">${icon('inside')}Open it on the canvas</button>` : ''}
		${inner === null ? '<p class="k-none">Reading what is inside, from git.</p>' : `<ul class="k-rows">${rows.join('')}</ul>`}
		<p class="k-none">${icon('deeper')}Then its files, and then the lines.</p>`
}

// What ken thinks the reader knows of a concept, said as a sentence, by level.
const THINKS = {
	new: 'ken thinks this is new to you.',
	seen: 'ken thinks you have seen it.',
	read: 'ken thinks you have read about it.',
	code: 'ken thinks you have read its code.',
	said: 'You said you know it.',
}

function knowsHtml(brief, home, ui) {
	const { knows } = brief
	if (!knows) return ''
	if (ui.fixing) {
		const rungs = KNOWN.map(
			(level) =>
				`<button class="k-rung" data-act="brief-set" data-level="${level}" data-key="brief-set-${level}" aria-pressed="${level === knows.level}">${levelMark(level, 18)}<span>${esc(levelLabel(home, level))}</span>${level === knows.level ? '<em>ken thinks this</em>' : ''}</button>`,
		)
		return `<div class="k-ladder" role="group" aria-label="What do you know of ${esc(brief.name)}?"><p class="k-ladder-q">What do you know of ${prose(brief.name)}?</p>${rungs.join('')}<button class="k-link" data-act="brief-fix" data-key="brief-fix-cancel">Cancel</button></div>`
	}
	const since = knows.stale ? ` ${count(knows.since, 'commit', 'commits')} landed there since.` : ''
	const problem = ui.saveProblem ? `<p class="k-ask-problem" role="alert">${esc(ui.saveProblem)}</p>` : ''
	const said = ui.said ? `<p class="k-knows-said" role="status">ken wrote: ${esc(ui.said)}</p>` : ''
	return `${said}<div class="k-knows">${levelMark(knows.level, 16)}<p><b>${THINKS[knows.level]}</b> ${esc(knows.why ?? '')}${since} <button class="k-link" data-act="brief-fix" data-key="brief-fix">Not right?</button></p></div>${problem}`
}

function footHtml(brief, ui) {
	if (brief.local) return ''
	const counts = waysCount(brief)
	const ways = Object.entries(WAYS).map(([way, [name, note]]) =>
		way === 'deeper' && brief.source
			? `<button class="k-way" data-act="brief-way" data-way="source" data-key="brief-way-deeper" aria-pressed="${ui.on === 'source'}">${icon('code')}<span class="k-way-name-s">Read source</span><span class="k-way-note">Lines from git</span></button>`
			: `<button class="k-way" data-act="brief-way" data-way="${way}" data-key="brief-way-${way}" aria-pressed="${ui.on === way}">${icon({ sideways: 'sideways', questions: 'question', deeper: 'deeper' }[way])}<b class="k-num">${counts[way]}</b><span class="k-way-name-s">${name}</span><span class="k-way-note">${note}</span></button>`,
	)
	return `<div class="k-brief-foot"><div class="k-ways">${ways.join('')}</div></div>`
}

// ui is the drawer's state: { id, on, trail, fixing, openQuotes, problem }. found is what the page has of the
// brief: reading, ok or none. ctx holds the home's state, the setting for text, what the page is doing, the level
// the concept stands in when the page has it, and the level inside it for "Deeper".
export function briefHtml(ui, found, ctx) {
	const trail = ui.trail.map((step, i) => {
		const here = i === ui.trail.length - 1
		return here
			? `<span class="k-trail-here">${prose(step.name)}</span>`
			: `<button data-act="brief-trail" data-index="${i}" data-key="brief-trail-${i}">${prose(step.name)}</button>${icon('right', 'k-trail-sep')}`
	})
	const head = `<div class="k-brief-head"><nav class="k-trail" aria-label="The briefs you came through">${trail.join('')}</nav><button class="k-icon-btn" data-act="brief-close" data-key="brief-close" aria-label="Close the brief">${icon('close')}</button></div>`
	const back = `${backHtml}${icon('left')}The brief</button>`
	if (ui.on === 'source' && found.kind !== 'ok') {
		return `${head}<div class="k-brief-body" id="brief-scroll">${sourceHtml(ui.source, back, ui.id)}</div>`
	}
	if (found.kind === 'reading') {
		return `${head}<div class="k-brief-body" id="brief-scroll"><p class="k-none" role="status">Reading the brief.</p></div>`
	}
	if (found.kind === 'none') {
		return `${head}<div class="k-brief-body" id="brief-scroll"><h2 class="k-brief-name" id="brief-name" tabindex="-1">Not here</h2><p class="k-none" role="alert">${esc(found.message)}</p></div>`
	}
	const brief = withEnds(found.brief, ctx.views)
	const view = isViewKind(brief.kind)
	const body =
		ui.on === 'sideways'
			? view
				? viewSidewaysHtml(brief, back)
				: sidewaysHtml(brief)
			: ui.on === 'questions'
				? questionsHtml(brief, { ui, env: ctx.env })
				: ui.on === 'deeper'
					? view
						? viewDeeperHtml(brief, back)
						: deeperHtml(brief, ctx.inner)
					: ui.on === 'source'
						? sourceHtml(ui.source, back, ui.id)
						: mainHtml(brief, { ...ctx, ui })
	// A frame, a store, an outside thing or a crossing is no part, so it takes no part's colour.
	const colour = view ? '' : colourOf(brief)
	return `${head}<div class="k-brief-body text-${ctx.prefs.text} ${colour || 'is-plain'}${view ? ' is-view' : ''}" id="brief-scroll">${body}</div>${footHtml(brief, ui)}`
}
