// The terminal's and the lens lists' one way to write a moment, in the reader's own time zone, so they agree with the
// page. The twins are when and at in src/page/views/format.js and onDay in src/page/views/map.js: the page runs in the
// browser and cannot import this. ken runs on the reader's machine, so this clock is the reader's.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

function dayOf(at: Date, now: Date): string {
	const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`
	return `${at.getDate()} ${MONTHS[at.getMonth()]}${year}`
}

// "06:36" today, "16 Nov 06:36" on another day, "16 Nov 2025 06:36" in another year.
export function when(iso: string, now = new Date()): string {
	const at = new Date(iso)
	const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
	return at.toDateString() === now.toDateString() ? time : `${dayOf(at, now)} ${time}`
}

// The same moment in a sentence: "at 06:36", "on 16 Nov 06:36".
export function at(iso: string, now = new Date()): string {
	const said = when(iso, now)
	return said.includes(' ') ? `on ${said}` : `at ${said}`
}

// A day with no time, such as a map line's 2026-11-16, in a sentence: "earlier today", "on 16 Nov", "on 16 Nov 2025".
export function onDay(date: string, now = new Date()): string {
	const day = new Date(`${date}T00:00`)
	return day.toDateString() === now.toDateString() ? 'earlier today' : `on ${dayOf(day, now)}`
}
