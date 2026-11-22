// The Changes page: what landed, and one change to review. On top, a timeline of commits by day that the reader
// drags across to pick a span. Under it, the parts of the project with what the span or the change touched lit and
// counted, and beside them the change itself: its commits, its story and its steps, each step a brief with its diff.
// Two tabs hold what waits on the reader with the decisions of the record, and live mode.
import { partId } from '../brief/concept-id.js'
import { stepFiles } from '../level/content.js'
import { partClass } from '../project/part-colours.js'
import { placeParts } from '../project/parts-picture.js'
import { stepDiffHtml, stepParts, stepWords, walkOf } from '../project/walk.js'
import { icon, partIcon } from '../shell/icons.js'
import { count, esc, prose, RUN_COST, short } from '../views/format.js'
import { dayText, timelineHtml } from './timeline.js'

const SHOWN_COMMITS = 40
const SHOWN_OFFERS = 4
const SHOWN_OUTSIDE_FILES = 20

const today = () => new Date().toISOString().slice(0, 10)
const pullOf = (name) => name.match(/Merge pull request #(\d+)/)?.[1] ?? null

const DAY = 86_400_000
const dayOf = (time) => new Date(time).toISOString().slice(0, 10)

// The span the change on show covers on the timeline, { from, to } as days. A span of time runs from the day it
// begins to today; any other change from its oldest commit to its newest.
export function spanOf(home) {
	const change = home.look?.change
	if (!change) return null
	const choice = home.changes.find((each) => each.kind === 'since' && each.change === home.change)
	const asked = home.change.match(/^since:(?:(\d{4}-\d{2}-\d{2})|(\d+)d?)$/)
	const start = choice?.start ?? asked?.[1] ?? (asked?.[2] ? dayOf(Date.now() - Number(asked[2]) * DAY) : null)
	if (start) return { from: start, to: today() }
	const days = [...change.commits.map((commit) => commit.date), change.oldest ?? []]
		.flat()
		.map((date) => date.slice(0, 10))
		.sort()
	return days.length === 0 ? null : { from: days[0], to: days.at(-1) }
}

// Whether the change on show is a span of time, which runs to today.
export const isSpan = (home) =>
	home.change.startsWith('since:') ||
	home.changes.some((choice) => choice.kind === 'since' && choice.change === home.change)

// The spans the page offers over the timeline: the spans of time the server offers but the 90 days the whole
// timeline shows, named by their days or by the moment they start, and the newest merge.
export function spanChoices(changes) {
	const since = changes
		.filter((choice) => choice.kind === 'since' && choice.days !== 90)
		.map((choice) => ({
			change: choice.change,
			name: choice.days === null ? choice.name.slice(0, choice.name.lastIndexOf(': ')) : `${choice.days} days`,
		}))
	const merge = changes.find((choice) => choice.kind === 'merge')
	return [
		...since,
		...(merge
			? [
					{
						change: merge.change,
						name: pullOf(merge.name) ? `Pull request #${pullOf(merge.name)}` : 'The newest merge',
						merge: true,
					},
				]
			: []),
	]
}

function reviewChoices(changes) {
	return changes
		.filter((choice) => choice.kind !== 'since')
		.slice(0, SHOWN_OFFERS)
		.map((choice) => ({
			change: choice.change,
			kind: choice.kind,
			name: pullOf(choice.name) ? `Pull request #${pullOf(choice.name)}` : choice.name.replace(/^[0-9a-f]{7} /, ''),
		}))
}

function numbersHtml(look, span, toToday) {
	const { change } = look
	const parts = look.boxes.filter((box) => box.touched).length
	const when = !span
		? ''
		: toToday
			? `${dayText(span.from)} to today`
			: span.from === span.to
				? dayText(span.from)
				: `${dayText(span.from)} to ${dayText(span.to)}`
	const big = (n, one, many) => `<p class="k-big"><b class="k-num">${n}</b> ${n === 1 ? one : many}</p>`
	const commits = change.commits.length + change.moreCommits
	return `<div class="k-chg-numbers">${big(commits, 'commit', 'commits')}${big(parts, 'part', 'parts')}${big(change.files, 'file', 'files')}<span class="k-chg-when">${esc(when)}</span></div>`
}

function blocksHtml(look) {
	const at = (name) => look.boxes.findIndex((box) => box.name === name)
	const links = look.arrows.map((arrow) => [at(arrow.from), at(arrow.to)]).filter(([a, b]) => a >= 0 && b >= 0)
	const placed = placeParts(look.boxes.length, links)
	const mid = (i) => `${placed.cells[i].col * 100 + 50} ${placed.cells[i].row * 100 + 50}`
	const lines = links.map(([a, b]) => `<path d="M${mid(a)}L${mid(b)}"/>`)
	const blocks = look.boxes.map((box, i) => {
		const cell = placed.cells[i]
		const { touched } = box
		const said = touched
			? `<span class="k-chg-count">${icon('changed')}<b class="k-num">${touched.files}</b> ${touched.files === 1 ? 'file' : 'files'}<span class="k-chg-lines k-num">+${touched.added} &minus;${touched.removed}</span></span>`
			: '<span class="k-chg-count is-none">No change</span>'
		return `<button class="k-chg-blk ${partClass(box.name)}${touched ? ' is-touched' : ''}" style="--r:${cell.row + 1};--c:${cell.col + 1}" ${touched ? `data-act="chg-part" data-name="${esc(box.name)}"` : `data-act="brief-open" data-concept="${esc(partId(look.within, box.name))}"`} data-key="chg-blk-${i}"><span class="k-chg-name"><span class="k-chg-ic">${icon(partIcon(box.name))}</span><b>${esc(box.name)}</b></span>${said}</button>`
	})
	const outside = look.change.outside ?? []
	const names = outside.slice(0, SHOWN_OUTSIDE_FILES).map((path) => `<li><code>${esc(path)}</code></li>`)
	const rest = outside.length - names.length
	const loose = names.length
		? `<details class="k-chg-outside"${outside.length === 1 ? ' open' : ''}>
		<summary>${count(outside.length, 'changed file is', 'changed files are')} in no part</summary><ul>${names.join('')}</ul>
		${rest ? `<p>and ${count(rest, 'more file', 'more files')}</p>` : ''}</details>`
		: ''
	return `<div class="k-chg-map" style="--cols:${placed.cols};--rows:${placed.rows}"><svg viewBox="0 0 ${placed.cols * 100} ${placed.rows * 100}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${blocks.join('')}</div>${loose}`
}

// The files a step shows only part of: their lines in the step beside all the change did to them. files are the
// step's own counts.
export function shownInPart(look, files) {
	const all = look.boxes.flatMap((box) => box.touched?.paths ?? [])
	return files.flatMap((file) => {
		const whole = all.find((each) => each.path === file.path)
		return whole && (whole.added > file.added || whole.removed > file.removed) ? [{ ...file, whole }] : []
	})
}

// The story and the steps of the change on show, from what ken's model said of it before, or the offers to ask.
function storyHtml(home, env) {
	const { content, look } = home
	const run = env.running?.onHome
	const working =
		run && (run.kind === 'story' || run.kind === 'walk')
			? `<p class="k-chg-run" role="status"><span class="k-spin" aria-hidden="true"></span> ${run.kind === 'walk' ? "ken's model is ordering the change into steps" : "ken's model is reading the change"}. <span class="k-num k-clock">${Math.round(env.seconds)} s so far</span> <button class="k-link" data-act="stop" data-key="chg-stop">Stop</button></p>`
			: ''
	// A saved story opens as it is, once its reply is read. Telling it again is a run of its own.
	const story = content.story
		? `<button class="k-chg-story" data-act="chg-story" data-key="chg-story"${content.story.q ? '' : ' disabled'}>${icon('words')}<span><b>Its story</b><span>${content.story.q ? 'What it did, and why' : 'Reading the story ken saved'}</span></span>${icon('right')}</button>`
		: ''
	const steps = content.walk?.q ? walkOf(content.walk.q.reply) : []
	const rows = steps.map((step) => {
		const parts = [...stepParts(step, look.boxes)].map((i) => look.boxes[i].name)
		const files = stepFiles(step)
		const added = files.reduce((sum, file) => sum + file.added, 0)
		const removed = files.reduce((sum, file) => sum + file.removed, 0)
		const where =
			parts.length > 0 ? `<span class="k-sw ${partClass(parts[0])}"></span>${esc(parts.join(', '))}` : 'In no part'
		const part = shownInPart(look, files).map((file) => file.path.split('/').at(-1))
		const some = part.length > 0 ? `, part of ${esc(part.join(', '))}` : ''
		return `<li><button class="k-chg-step" data-act="chg-step" data-n="${step.number}" data-key="chg-step-${step.number}"><span class="k-chg-n k-num ${parts[0] ? partClass(parts[0]) : ''}">${step.number}</span><span class="k-chg-step-words"><b>${prose(stepWords(step).title)}</b><span>${where} &middot; ${count(files.length, 'file', 'files')}${some} <span class="k-num">+${added} &minus;${removed}</span></span></span></button></li>`
	})
	const offers = [
		...(content.walk ? [] : [['run-walk', 'Walk me through it', 'chg-run-walk']]),
		content.story ? ['run-story', 'Tell it again', 'chg-run-story'] : ['run-story', 'Tell its story', 'chg-run-story'],
	].map(
		([act, text, key]) =>
			`<button class="k-btn${act === 'run-walk' ? '' : ' is-quiet'} k-run-btn" data-act="${act}" data-key="${key}"${env.off ? ' disabled' : ''}><span>${text}</span><small>${RUN_COST}</small></button>`,
	)
	return `${working}${story}
		${rows.length > 0 ? `<h3 class="k-eyebrow">The change, in ${count(rows.length, 'step', 'steps')}</h3><ol class="k-chg-steps">${rows.join('')}</ol>` : ''}
		${offers.length > 0 && !working ? `<div class="k-chg-offers">${offers.join('')}</div>${env.off ? `<p class="k-muted">${esc(env.off)}</p>` : ''}` : ''}`
}

function commitsHtml(change, open) {
	const commits = change.commits ?? []
	if (commits.length === 0) return ''
	const total = commits.length + change.moreCommits
	const rows = commits
		.slice(0, SHOWN_COMMITS)
		.map(
			(commit) =>
				`<li><span class="k-chg-day">${esc(dayText(commit.date.slice(0, 10)))}</span><span class="k-chg-subject">${prose(commit.subject)}</span><code class="k-chg-hash">${esc(short(commit.hash))}</code></li>`,
		)
	const shown = Math.min(commits.length, SHOWN_COMMITS)
	const more = total > shown ? `<li class="k-muted">and ${total - shown} more</li>` : ''
	return `<details class="k-chg-commits" data-key="chg-commits"${open ? ' open' : ''}><summary><span class="k-eyebrow">${count(total, 'commit', 'commits')}</span></summary><ul>${rows.join('')}${more}</ul></details>`
}

// The change on show as the reader would call it: "Pull request #107", a span of time, or what the server named it.
export function changeName(home) {
	const chosen = home.changes.find((choice) => choice.change === home.change)
	const said = chosen?.name ?? home.look?.change?.name ?? ''
	return pullOf(said) ? `Pull request #${pullOf(said)}` : chosen?.kind === 'since' ? said.replace(/:.*$/, '') : said
}

function sideHtml(home, chg, env) {
	const choices = reviewChoices(home.changes).map(
		(choice, i) =>
			`<button class="k-chip" data-act="chg-pick" data-change="${esc(choice.change)}" data-key="chg-offer-${i}" aria-pressed="${home.change === choice.change}">${icon(choice.kind === 'uncommitted' ? 'pencil' : 'merge')}<span>${esc(choice.name)}</span></button>`,
	)
	const { look } = home
	const name = changeName(home)
	return `<aside class="k-tile k-chg-side" aria-labelledby="chg-name">
		<h2 class="k-eyebrow">Review a change</h2>
		<div class="k-chg-choices">${choices.join('')}</div>
		<form class="k-chg-another" id="chg-another" autocomplete="off">
			<label class="visually-hidden" for="chg-another-text">Another change: a branch, a range or a commit</label>
			<input id="chg-another-text" name="text" data-key="chg-another-text" value="${esc(chg.typed)}" placeholder="A branch, a range or a commit" />
			<button class="k-btn is-quiet" type="submit" data-key="chg-another-send">Show it</button>
		</form>
		${home.problem?.field === 'change' || home.problem?.keeps ? `<p class="k-ask-problem" role="alert">${esc(home.problem.message)}</p>` : ''}
		${look?.change ? `<h2 class="k-chg-title" id="chg-name" tabindex="-1">${esc(name)}</h2>${storyHtml(home, env)}${commitsHtml(look.change, isSpan(home))}` : ''}
	</aside>`
}

function tabsHtml(chg, waiting, live) {
	const tabs = [
		['changes', 'Changes', ''],
		['decisions', 'Decisions', waiting > 0 ? ` <span class="k-badge is-quiet k-num">${waiting}</span>` : ''],
		['live', 'Live', live === 'off' ? '' : ` <span class="live-mark is-${live}" aria-hidden="true"></span>`],
	]
	return `<div class="k-seg k-chg-tabs" role="tablist" aria-label="What this page shows">${tabs
		.map(
			([tab, name, mark]) =>
				`<button role="tab" data-act="chg-tab" data-tab="${tab}" data-key="chg-tab-${tab}" aria-selected="${chg.tab === tab}">${name}${mark}</button>`,
		)
		.join('')}</div>`
}

function partChangeHtml({ part, partDiff }) {
	const heading = `<button class="k-link" data-act="chg-part" data-key="chg-all">All changes in this range</button><h2 id="chg-name" tabindex="-1">Changes in ${esc(part)}</h2>`
	if (!partDiff || partDiff.message || partDiff.tooLarge) {
		const why =
			partDiff?.message ??
			(partDiff?.tooLarge ? 'This diff is too large to show.' : 'Reading the changed lines from git.')
		return `${heading}<p role="status">${esc(why)}</p>`
	}
	const { files, hunks, binary, range } = partDiff
	const shownPaths = new Set(hunks.map((hunk) => hunk.path))
	const other = files.filter((file) => !shownPaths.has(file.path))
	const paths = other.map(({ path, oldPath }) => {
		const name = path === oldPath ? esc(path) : `${esc(oldPath)} to ${esc(path)}`
		return `<li><code>${name}</code>${binary.includes(path) || binary.includes(oldPath) ? ' (binary file)' : ''}</li>`
	})
	return `${heading}<p>${count(files.length, 'changed file', 'changed files')} · <code>${esc(short(range.base))}..${esc(short(range.head))}</code></p>
		${partDiff.historyTooLarge ? '<p>Too many commits to list.</p>' : commitsHtml(partDiff, true)}
		${hunks.length ? stepDiffHtml(partDiff, range) : ''}
		${partDiff.cut ? '<p>Only the first 400 changed lines are shown.</p>' : ''}
		${paths.length ? `<ul>${paths.join('')}</ul>` : ''}
		${files.length ? '' : '<p>The files in this part are the same at both ends of the range.</p>'}`
}

// view is { home, chg, env, timeline, waiting, live, older }: the level with the change laid over it, the page's own
// state, what the page is doing, the commits by day, how many things wait on the reader, the state of live mode, and
// the views of the two other tabs, drawn by the page.
export function changesPageHtml({ home, chg, env, timeline, waiting, live, older }) {
	const tabs = tabsHtml(chg, waiting, live)
	if (chg.tab !== 'changes')
		return `<div class="k-chg-page">${tabs}<section class="k-tile k-chg-older">${older}</section></div>`
	if (chg.part)
		return `<div class="k-chg-page">${tabs}<section class="k-tile k-chg-older">${partChangeHtml(chg)}</section></div>`
	const { look } = home
	if (!look) {
		const said = home.problem ? esc(home.problem.message) : 'Reading what landed, from git.'
		return `<div class="k-chg-page">${tabs}<p class="k-home-line" role="status">${said}</p></div>`
	}
	const span = chg.drag ?? spanOf(home)
	const presets = spanChoices(home.changes).map(
		(choice, i) =>
			`<button data-act="chg-pick" data-change="${esc(choice.change)}" data-key="chg-span-${i}" aria-pressed="${home.change === choice.change}">${choice.merge ? icon('merge') : ''}${esc(choice.name)}</button>`,
	)
	const chart = timeline
		? `<div class="k-tl-wrap" id="chg-timeline">${timelineHtml(timeline, span, chg.drag !== null)}</div>
			<p class="k-tl-key"><span>${icon('merge')} pull requests merged that day</span><span><span class="k-tl-key-frame"></span>the span on show: drag across the bars to change where it starts</span></p>
			<div class="k-tl-keys"><button class="k-btn is-quiet" data-act="chg-shift" data-by="-1" data-key="chg-earlier">${icon('left')}A day earlier</button><button class="k-btn is-quiet" data-act="chg-shift" data-by="1" data-key="chg-later">A day later${icon('right')}</button></div>`
		: ''
	const reading = home.reading ? ' is-reading' : ''
	return `<div class="k-chg-page">
		${tabs}
		<section class="k-tile k-chg-top" aria-label="What landed">
			<div class="k-chg-head">${look.change ? numbersHtml(look, span, chg.drag !== null || isSpan(home)) : '<p class="k-big"><b class="k-num">0</b> commits</p>'}<span class="k-seg k-chg-spans" role="group" aria-label="Spans">${presets.join('')}</span></div>
			${chart}
		</section>
		<section class="k-tile k-chg-parts${reading}" aria-label="What it touched">${look.change ? blocksHtml(look) : `<p class="k-muted">${home.problem ? esc(home.problem.message) : 'Pick a span or a change.'}</p>`}</section>
		${sideHtml(home, chg, env)}
	</div>`
}
