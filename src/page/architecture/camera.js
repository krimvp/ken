// The camera of the canvas: where the reader looks and how close. The reader drags to pan, turns the wheel or
// presses the buttons to zoom, and "fit" shows the whole level. The small map marks what the camera shows and moves
// it on a press. When a brief opens beside the canvas, the camera fits the level into the room that is left. A block
// the keyboard moves to is brought into view. The camera is { x, y, z }: a point of the canvas's own units shows at
// x + z times it.
const ZOOM = { least: 0.25, most: 2.5, step: 1.25 }
// Room the camera leaves at the sides of a fitted level, and between it and what floats over the canvas.
const ROOM = { side: 28, narrowSide: 14, clear: 12 }
const NARROW = 700
// Under FAR a block has no room for the line of its job, and under TINY words on the canvas would be too small to
// read, so a block keeps its name and its mark.
const FAR = 0.78
const TINY = 0.5
// A press that moved less than this is a press, not a drag.
const DRAG = 5

const clamp = (z) => Math.min(ZOOM.most, Math.max(ZOOM.least, z))

// The camera that shows world, a box in the canvas's own units, whole: room is the canvas's size and clear the band
// { top, h } of it that nothing floats over. Never closer than the world's own size. A narrow room fits the world's
// width and starts at its top: its blocks stand in one column, which the reader pans down.
export function fitted(world, room, clear) {
	const column = room.w < NARROW
	const across = (room.w - 2 * (column ? ROOM.narrowSide : ROOM.side)) / world.w
	const z = clamp(Math.min(across, column ? 1 : clear.h / world.h, 1))
	const spare = column ? 0 : clear.h - world.h * z
	return { z, x: (room.w - world.w * z) / 2 - world.x * z, y: clear.top + spare / 2 - world.y * z }
}

// page is the element that holds the canvas, which is drawn again inside it. arch is the canvas's state: it keeps
// the camera as arch.cam. drawer gives the width a brief open beside the canvas takes from it. zoomed is told each
// zoom the reader makes.
export function canvasCamera(page, arch, drawer, zoomed = () => {}) {
	const canvas = () => page.querySelector('#arch-canvas')
	const worldBox = () => {
		const [x, y, w, h] = (canvas()?.dataset.world ?? '0 0 1 1').split(' ').map(Number)
		return { x, y, w, h }
	}
	const view = () => {
		const el = canvas()
		return { w: Math.max(el.clientWidth - drawer(), 200), h: el.clientHeight }
	}

	function apply() {
		const el = canvas()
		const world = el?.querySelector('#arch-world')
		if (!world) return
		const { x, y, z } = arch.cam
		world.style.transform = `translate(${x}px, ${y}px) scale(${z})`
		world.style.setProperty('--inv', String(1 / z))
		el.classList.toggle('is-far', z < FAR)
		el.classList.toggle('is-tiny', z < TINY)
		const label = el.querySelector('#arch-zoom')
		if (label) label.textContent = `${Math.round(z * 100)}%`
		const seen = el.querySelector('#arch-mm-view')
		const room = view()
		if (seen) {
			// What the camera shows, kept inside the small map's own frame.
			const [vx, vy, vw, vh] = seen.ownerSVGElement.getAttribute('viewBox').split(' ').map(Number)
			const left = Math.max(-x / z, vx)
			const top = Math.max(-y / z, vy)
			const right = Math.min((room.w - x) / z, vx + vw)
			const bottom = Math.min((room.h - y) / z, vy + vh)
			seen.setAttribute('x', String(left))
			seen.setAttribute('y', String(top))
			seen.setAttribute('width', String(Math.max(right - left, 0)))
			seen.setAttribute('height', String(Math.max(bottom - top, 0)))
		}
	}

	// The band of the canvas between what floats on its top and what floats on its foot.
	function band() {
		const el = canvas()
		const box = el.getBoundingClientRect()
		let [top, bottom] = [0, box.height]
		for (const float of el.querySelectorAll(':scope > .k-float, :scope > .k-under')) {
			const r = float.getBoundingClientRect()
			if (r.width === 0 || r.height === 0 || r.left - box.left >= view().w) continue
			if (r.top + r.height / 2 < box.top + box.height / 2) top = Math.max(top, r.bottom - box.top)
			else bottom = Math.min(bottom, r.top - box.top)
		}
		return { top: top + ROOM.clear, h: bottom - top - 2 * ROOM.clear }
	}

	function fit() {
		if (!canvas()) return
		arch.cam = fitted(worldBox(), view(), band())
		apply()
	}

	// Zooms about a point of the canvas's frame, so what is under the pointer stays under it.
	function zoomAt(factor, px, py) {
		const { x, y, z } = arch.cam
		const next = clamp(z * factor)
		arch.cam = { z: next, x: px - ((px - x) * next) / z, y: py - ((py - y) * next) / z }
		apply()
		zoomed(next)
	}

	function zoomBy(steps) {
		const room = view()
		zoomAt(ZOOM.step ** steps, room.w / 2, room.h / 2)
	}

	function panBy(dx, dy) {
		arch.cam = { ...arch.cam, x: arch.cam.x + dx, y: arch.cam.y + dy }
		apply()
	}

	// A block or a verb that got the keyboard is brought inside the room the canvas has.
	function reveal(el) {
		const frame = canvas()?.getBoundingClientRect()
		if (!frame) return
		const box = el.getBoundingClientRect()
		const room = view()
		const over = (lo, hi, least, most) => (lo < least ? least - lo : hi > most ? most - hi : 0)
		const dx = over(box.left - frame.left, box.right - frame.left, ROOM.side, room.w - ROOM.side)
		const clear = band()
		const dy = over(box.top - frame.top, box.bottom - frame.top, clear.top, clear.top + clear.h)
		if (dx !== 0 || dy !== 0) panBy(dx, dy)
	}

	let drag = null
	page.addEventListener('pointerdown', (event) => {
		const el = canvas()
		if (!el || event.button !== 0 || !event.target.closest('#arch-canvas')) return
		const map = event.target.closest('#arch-minimap')
		if (map) return toMap(map, event)
		if (event.target.closest('.k-float')) return
		drag = { x: event.clientX, y: event.clientY, cam: arch.cam, moved: false }
	})
	window.addEventListener('pointermove', (event) => {
		if (!drag) return
		const [dx, dy] = [event.clientX - drag.x, event.clientY - drag.y]
		if (!drag.moved && Math.hypot(dx, dy) < DRAG) return
		drag.moved = true
		canvas()?.classList.add('is-dragging')
		arch.cam = { ...drag.cam, x: drag.cam.x + dx, y: drag.cam.y + dy }
		apply()
	})
	// The press that ends a drag is no press on the block under it: the click that follows it is dropped.
	let dragged = false
	const drop = () => {
		canvas()?.classList.remove('is-dragging')
		dragged = drag?.moved ?? false
		drag = null
		if (dragged) setTimeout(() => (dragged = false), 0)
	}
	window.addEventListener('pointerup', drop)
	window.addEventListener('pointercancel', drop)
	page.addEventListener('click', (event) => dragged && event.stopPropagation(), true)
	page.addEventListener(
		'wheel',
		(event) => {
			const el = canvas()
			if (!el || !event.target.closest('#arch-canvas') || event.target.closest('.k-float')) return
			event.preventDefault()
			const frame = el.getBoundingClientRect()
			zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - frame.left, event.clientY - frame.top)
		},
		{ passive: false },
	)
	page.addEventListener('focusin', (event) => {
		const el = event.target.closest?.(
			'.k-blk, .k-verb, .k-rt-part, .k-rt-store, .k-rt-bus-head, .k-rt-out, .k-rt-person, .k-rt-fold, .k-rt-flabel, .k-rt-label, .k-rt-mark, .k-wd-tile',
		)
		if (el && !drag) reveal(el)
	})

	// A press on the small map puts that point of the level in the middle of the canvas.
	function toMap(map, event) {
		const [vx, vy, vw, vh] = map.getAttribute('viewBox').split(' ').map(Number)
		const box = map.getBoundingClientRect()
		const scale = Math.max(vw / box.width, vh / box.height)
		const px = vx + vw / 2 + (event.clientX - box.left - box.width / 2) * scale
		const py = vy + vh / 2 + (event.clientY - box.top - box.height / 2) * scale
		const room = view()
		arch.cam = { ...arch.cam, x: room.w / 2 - px * arch.cam.z, y: room.h / 2 - py * arch.cam.z }
		apply()
	}

	return { apply, fit, zoomBy, panBy }
}
