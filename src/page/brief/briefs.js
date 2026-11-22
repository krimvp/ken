// The briefs the page has read, by the id of their concept. A brief comes from GET /api/brief. While the server has
// no such address, the page builds the same shape from what the server sends today (from-today.js). A brief is read
// once and kept until ken's model has run or ken wrote a line about the reader: then a brief is read again when it
// is next shown, and the one the page has stays on screen until the new one is here.
import { fromToday } from './from-today.js'

// app gives read, which asks the server and answers { ok, body, status } whatever it says, the reader's saved
// questions, and the name of a level by its paths.
export function briefStore(app) {
	const today = fromToday(app)
	// By id: { kind: 'reading' }, { kind: 'ok', brief }, or { kind: 'none', message } for a concept ken has nothing on.
	// old marks one to read again.
	const kept = new Map()
	let listed = null

	const ask = (url) => app.read(url).catch((error) => ({ ok: false, status: 0, body: { message: error.message } }))

	async function read(id) {
		const answer = await ask(`/api/brief?concept=${encodeURIComponent(id)}`)
		if (answer.ok) return { kind: 'ok', brief: answer.body }
		if (answer.status !== 404) return { kind: 'none', message: answer.body.message ?? 'ken did not answer.' }
		const built = await today.briefOf(id).catch(() => null)
		return built
			? { kind: 'ok', brief: built }
			: { kind: 'none', message: 'ken has nothing on this yet. It may have been renamed or removed since.' }
	}

	// The brief as far as the page has it. A brief not read yet is asked for, and then is called once it is here.
	function get(id, then) {
		const have = kept.get(id)
		if (!have || have.old) {
			kept.set(id, have ? { ...have, old: false } : { kind: 'reading' })
			void read(id).then((found) => {
				kept.set(id, found)
				then()
			})
		}
		return kept.get(id)
	}

	// Everything search can find: [{ id, kind, name, line, level }].
	function concepts() {
		listed ??= ask('/api/concepts').then(async (answer) => {
			if (answer.ok) return answer.body
			return answer.status === 404 ? today.concepts().catch(() => []) : []
		})
		return listed
	}

	function forget() {
		for (const [id, have] of kept) kept.set(id, { ...have, old: have.kind !== 'reading' })
		listed = null
		today.forget()
	}

	return { get, concepts, forget, lookAt: today.lookAt }
}
