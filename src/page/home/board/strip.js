// The strip over the board: the one sentence on what the level is, and the three ways in as buttons that each lead
// with a real count. The Detail control is drawn here too, and stands over the column it decides. With "ken picks"
// each part opens at the detail the server says for this reader. A detail the reader picks stays for every part until
// they pick "ken picks" again. On a level of folders the control waits: there is nothing finer to show until the
// parts have names.
import { count, esc, prose } from '../../views/format.js'
import { changeName } from '../canvas/canvas.js'
import { shownDetail } from '../state/content.js'
import { DETAILS, WAYS } from '../state/home-state.js'
import { miniPictureHtml } from './mini-picture.js'

const reviewItem = (look) => look.next.items.find((item) => item.kind === 'review')

// How many of the level's boxes the reader has opened.
function learnFact(look) {
	const opened = look.boxes.filter((box) => box.knows.level !== 'new').length
	const noun = look.named ? ['part', 'parts'] : ['box', 'boxes']
	return `${opened} of ${count(look.boxes.length, ...noun)} opened`
}

// The span on screen while the reader catches up. Before that, the boxes that changed since they looked, or on a
// first visit the commits of the first span ken found some in.
function catchUpFact(home) {
	const { look, changes, suggestion } = home
	if (home.wayIn === 'catch-up' && look.change) {
		const commits = count(look.change.commits.length + look.change.moreCommits, 'commit', 'commits')
		const picked = changes.find((choice) => choice.kind === 'since' && choice.change === look.change.asked)
		if (!picked) return `${commits} laid over the picture`
		const span = picked.name.slice(0, picked.name.lastIndexOf(': '))
		return `${commits} ${span.replace(/^The last/, 'in the last').replace(/^./, (c) => c.toLowerCase())}`
	}
	if (look.boxes.every((box) => box.knows.level === 'new')) return suggestion?.facts['catch-up'] ?? null
	const stale = look.boxes.filter((box) => box.knows.stale).length
	return `${count(stale, look.named ? 'part' : 'box', look.named ? 'parts' : 'boxes')} changed since you looked`
}

// The change on screen while the reader reviews one, else the change ken would have them review, with its size.
function reviewFact(home) {
	const { look, changes, suggestion } = home
	if (home.wayIn === 'review' && look.change) {
		const name = changeName(look, changes).replace(/^./, (c) => c.toLowerCase())
		return `${count(look.change.files, 'file', 'files')}, ${name}`
	}
	const item = reviewItem(look)
	return item?.size
		? `${count(item.size.files, 'file', 'files')}, ${item.size.what}`
		: (suggestion?.facts.review ?? null)
}

// The boxes the change to review touched: those of the change on screen, else those of the change ken would show.
function reviewParts(home) {
	const { look } = home
	if (home.wayIn === 'review' && look.change) return look.boxes.filter((box) => box.touched).map((box) => box.name)
	return reviewItem(look)?.parts ?? []
}

// A fact leads with its number, set larger, so the strip reads as a row of counts.
function factHtml(fact) {
	const [, n, rest] = /^([\d,]+)( .*)$/.exec(fact) ?? [null, null, fact]
	return `<span class="seg-fact">${n ? `<strong class="seg-n">${n}</strong>` : ''}${esc(rest)}</span>`
}

export function stripHtml(home) {
	const { look } = home
	const facts = look
		? { learn: learnFact(look), 'catch-up': catchUpFact(home), review: reviewFact(home) }
		: (home.suggestion?.facts ?? {})
	const parts = look ? reviewParts(home) : []
	// Until the reader picks a way in themselves, the one in use is ken's suggestion, and it says why.
	const { suggestion } = home
	const suggested =
		!home.picked && suggestion?.suggested === home.wayIn ? `ken suggests this way in. ${suggestion.why}` : null
	const ways = Object.entries(WAYS).map(([way, text]) => {
		const mini = way === 'review' && parts.length > 0 ? miniPictureHtml(look, parts) : ''
		const tip = suggested && way === home.wayIn ? ` data-tip="${esc(suggested)}"` : ''
		return `<button class="seg seg-way" data-act="way-in" data-way="${way}" data-key="way-${way}" aria-pressed="${home.wayIn === way}"${tip}><span class="seg-words"><span class="seg-text">${text}</span>${facts[way] ? factHtml(facts[way]) : ''}</span>${mini}</button>`
	})
	const about = look?.named?.about ? `<p class="strip-about">${prose(look.named.about)}</p>` : ''
	return `${about}<div class="control" role="group" aria-label="Way in"><div class="segs">${ways.join('')}</div></div>`
}

// The Detail control, over the column it decides.
export function detailHtml(home) {
	const waits = Boolean(home.look) && !home.look.named
	const shown = shownDetail(home)
	const details = Object.entries({ ken: 'ken picks', ...DETAILS }).map(([detail, text]) => {
		const pressed = !waits && (home.pinned ?? 'ken') === detail
		// While ken picks, the detail it picked for what is open is marked, so the reader sees which one is in use.
		const used = !waits && home.pinned === null && Boolean(home.selected) && shown === detail
		return `<button class="seg${used ? ' is-used' : ''}" data-act="detail-pin" data-detail="${detail}" data-key="detail-${detail}" aria-pressed="${pressed}"${waits ? ' disabled' : ''}><span class="seg-text">${text}</span>${used ? '<span class="visually-hidden">, in use now</span>' : ''}</button>`
	})
	return `<div class="control${waits ? ' is-waiting' : ''}" role="group" aria-labelledby="detail-label"${waits ? ' aria-describedby="detail-waits"' : ''}><span class="control-label" id="detail-label">Detail</span><div class="segs">${details.join('')}</div>${waits ? `<span class="control-note small" id="detail-waits">Detail opens once ken's model has named the parts.</span>` : ''}</div>`
}
