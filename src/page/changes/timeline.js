// The timeline on top of the Changes page: one bar a day for the commits that landed, the merges of the day marked
// over it, the reader's last visit marked as a line, and a frame round the span on show. The reader drags across the
// bars to pick where the span starts; it runs to today, as a span of time is asked of the server.
import { icon } from '../shell/icons.js'
import { esc } from '../views/format.js'

const DAY = 86_400_000
const [W, H, TOP, FOOT] = [1000, 160, 44, 22]
const MOST_DAYS = 90
const FEWEST_DAYS = 30

export const dayText = (day) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const dayOf = (time) => new Date(time).toISOString().slice(0, 10)

// The days the timeline shows, oldest first: from its first commit, or 30 days back, up to today.
export function daysShown(timeline, now = Date.now()) {
	const today = Date.parse(dayOf(now))
	const first = timeline.days[0] ? Date.parse(timeline.days[0].day) : today
	const from = Math.max(today - (MOST_DAYS - 1) * DAY, Math.min(first, today - (FEWEST_DAYS - 1) * DAY))
	const days = []
	for (let time = from; time <= today; time += DAY) days.push(dayOf(time))
	return days
}

// The day under a point of the chart, from 0 to 1 across it.
export function dayAt(days, across) {
	return days[Math.min(days.length - 1, Math.max(0, Math.floor(across * days.length)))]
}

// span is { from, to } as days, or null. picking says the reader is dragging.
export function timelineHtml(timeline, span, picking) {
	const days = daysShown(timeline)
	const step = W / days.length
	const byDay = new Map(timeline.days.map((each) => [each.day, each]))
	const most = Math.max(1, ...timeline.days.map((each) => each.commits))
	const tall = H - TOP - FOOT
	// A merge mark that would touch the one of the day before stands lower.
	let lastMark = -2
	let low = false
	const bars = days.flatMap((day, i) => {
		const landed = byDay.get(day)
		const x = i * step
		const inside = span && day >= span.from && day <= span.to
		const base = `<rect class="k-tl-slot" x="${x + step * 0.15}" y="${H - FOOT - 2}" width="${step * 0.7}" height="2"/>`
		if (!landed || landed.commits + landed.merges === 0) return [base]
		const height = Math.max(4, Math.sqrt(landed.commits / most) * (tall - 18))
		const top = H - FOOT - height
		low = landed.merges > 0 && lastMark === i - 1 && !low
		if (landed.merges > 0) lastMark = i
		const merges = landed.merges
			? `<g class="k-tl-merge" transform="translate(${x + step / 2 - 15} ${low ? 18 : 0})">${icon('merge').replace('<svg ', '<svg width="16" height="16" ')}<text x="18" y="13">${landed.merges}</text></g>`
			: ''
		return [
			base,
			`<rect class="k-tl-bar${inside ? ' is-in' : ''}" x="${x + step * 0.15}" y="${top}" width="${step * 0.7}" height="${height}" rx="3"/>`,
			landed.commits ? `<text class="k-tl-n" x="${x + step / 2}" y="${top - 5}">${landed.commits}</text>` : '',
			merges,
		]
	})
	const ticks = days.flatMap((day, i) =>
		i % 7 === 0 && i < days.length - 4
			? [`<text class="k-tl-day" x="${i * step + 2}" y="${H - 4}" text-anchor="start">${esc(dayText(day))}</text>`]
			: [],
	)
	ticks.push(`<text class="k-tl-day" x="${W - 2}" y="${H - 4}" text-anchor="end">today</text>`)
	const visit = timeline.lastVisit ? days.indexOf(timeline.lastVisit.slice(0, 10)) : -1
	const looked =
		visit >= 0
			? `<path class="k-tl-visit" d="M${(visit + 0.5) * step} ${TOP - 6}V${H - FOOT}"/><text class="k-tl-visit-t" x="${(visit + 0.5) * step - 4}" y="${TOP - 10}" text-anchor="end">you looked</text>`
			: ''
	const at = span ? days.indexOf(span.from) : -1
	const end = span ? days.indexOf(span.to) : -1
	const frame =
		at >= 0 && end >= at
			? `<rect class="k-tl-frame${picking ? ' is-picking' : ''}" x="${at * step + 1}" y="${TOP - 4}" width="${(end - at + 1) * step - 2}" height="${H - FOOT - TOP + 8}" rx="10"/>`
			: ''
	return `<svg class="k-tl" viewBox="0 0 ${W} ${H}" data-days="${days.length}" aria-hidden="true">${frame}${bars.join('')}${looked}${ticks.join('')}</svg>`
}
