// Switching drawing moves each part from where it stood to where it stands now, so the reader sees the same things
// rearranged. A part drawn twice glides into its first place, and its second place fades in. Nothing moves for a
// reader who asked for less motion.
const TIME = 420

const still = matchMedia('(prefers-reduced-motion: reduce)')

// Where each part stands on screen now, by its glide key.
export function gliders(root) {
	const at = new Map()
	for (const el of root.querySelectorAll('[data-glide]')) at.set(el.dataset.glide, el.getBoundingClientRect())
	return at
}

// before is what gliders said before the canvas was drawn again, and zoom the canvas's zoom now: a move of one
// pixel on screen is 1 / zoom in the canvas's own units.
export function glide(root, before, zoom) {
	if (still.matches || before.size === 0) return
	for (const el of root.querySelectorAll('[data-glide]')) {
		const was = before.get(el.dataset.glide)
		const now = el.getBoundingClientRect()
		if (!was || now.width === 0) {
			el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TIME, easing: 'ease-out' })
			continue
		}
		const dx = was.left - now.left
		const dy = was.top - now.top
		const sx = was.width / now.width
		const sy = was.height / now.height
		el.animate(
			[
				{ transformOrigin: '0 0', transform: `translate(${dx / zoom}px, ${dy / zoom}px) scale(${sx}, ${sy})` },
				{ transformOrigin: '0 0', transform: 'none' },
			],
			{ duration: TIME, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
		)
	}
}
