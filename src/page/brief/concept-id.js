// A concept's id, as the page and the server agree on it: "kind:rest". A part is named inside its level, and a
// level is the paths that hold it, joined by commas: none for the top. One function writes each id and one reads
// them, so nothing else knows the form.

export const partId = (within, name) => `part:${within.join(',')}:${name}`
export const processId = (id) => `process:${id}`
export const stepId = (process, n) => `step:${process}:${n}`
export const arrowId = (within, n) => `arrow:${within.join(',')}:${n}`

// What the drawings of where a project runs and what it talks to name, each by the id ken's model gave it.
const VIEW_KINDS = ['frame', 'store', 'outside', 'crossing']

const paths = (joined) => (joined === '' ? [] : joined.split(','))

// What an id names, or null for text that is no id: { kind, name } for a part, a term, a question and a decision,
// and what places the others.
export function readConcept(id) {
	const colon = id.indexOf(':')
	if (colon < 0) return null
	const [kind, rest] = [id.slice(0, colon), id.slice(colon + 1)]
	const cut = rest.indexOf(':')
	if (kind === 'part' && cut >= 0) return { kind, within: paths(rest.slice(0, cut)), name: rest.slice(cut + 1) }
	if (kind === 'arrow' && cut >= 0) return { kind, within: paths(rest.slice(0, cut)), n: Number(rest.slice(cut + 1)) }
	// A process's id may hold a colon of its own, so a step's number is what follows the last one.
	const last = rest.lastIndexOf(':')
	if (kind === 'step' && last >= 0) return { kind, process: rest.slice(0, last), n: Number(rest.slice(last + 1)) }
	if (['term', 'process', 'question', 'decision', 'project', ...VIEW_KINDS].includes(kind) && rest !== '')
		return { kind, name: rest }
	return null
}
