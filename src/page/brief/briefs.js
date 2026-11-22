// The briefs the page has read from GET /api/brief, by the id of their concept. A brief is read once and kept until
// ken's model has run or ken wrote a line about the reader: then a brief is read again when it is next shown, and the
// one the page has stays on screen until the new one is here.

// A brief the page makes itself, with what it has and nothing for the rest. trust says where its words come from.
export const pageBrief = (id, kind, name, line, trust) => ({
	id,
	kind,
	name,
	line,
	local: true,
	minutes: Math.max(1, Math.round(line.split(/\s+/).length / 120)),
	explained: true,
	explain: null,
	points: [],
	terms: [],
	questions: [],
	decisions: [],
	sideways: { uses: [], usedBy: [], processes: [] },
	deeper: null,
	steps: null,
	knows: null,
	trust,
})

// app gives read, which asks the server and answers { ok, body, status } whatever it says.
export function briefStore(app) {
	// By id: { kind: 'reading' }, { kind: 'ok', brief }, or { kind: 'none', message } for a concept ken has nothing on.
	// old marks one to read again.
	const kept = new Map()
	// The newest read asked for each id: an older read that answers late is dropped.
	const newest = new Map()
	let listed = null

	const ask = (url) => app.read(url).catch((error) => ({ ok: false, status: 0, body: { message: error.message } }))

	async function read(id) {
		const answer = await ask(`/api/brief?concept=${encodeURIComponent(id)}`)
		if (answer.ok) return { kind: 'ok', brief: answer.body }
		if (answer.status === 404) {
			return { kind: 'none', message: 'ken has nothing on this yet. It may have been renamed or removed since.' }
		}
		return { kind: 'none', message: answer.body.message ?? 'ken did not answer.' }
	}

	// The brief as far as the page has it. A brief not read yet is asked for, and then is called once it is here.
	function get(id, then) {
		const have = kept.get(id)
		if (!have || have.old) {
			kept.set(id, have ? { ...have, old: false } : { kind: 'reading' })
			const reading = read(id)
			newest.set(id, reading)
			void reading.then((found) => {
				if (newest.get(id) !== reading) return
				kept.set(id, found)
				then()
			})
		}
		return kept.get(id)
	}

	// Everything search can find: [{ id, kind, name, line, level }], or null when ken could not say. A failed read is
	// not kept, so the next asks again.
	function concepts() {
		listed ??= ask('/api/concepts').then((answer) => {
			if (answer.ok) return answer.body
			listed = null
			return null
		})
		return listed
	}

	// The level inside a part, for Deeper, or null when ken cannot read it.
	async function lookAt(within) {
		const answer = await ask(`/api/layout?${new URLSearchParams(within.map((path) => ['within', path]))}`)
		return answer.ok ? answer.body.look : null
	}

	// A brief the page made itself, such as a step of a change with its diff. The server has none to read again.
	function put(id, brief) {
		kept.set(id, { kind: 'ok', brief })
	}

	// A read in flight is marked too, since it may have left before the change it must show.
	function forget() {
		for (const [id, have] of kept) kept.set(id, { ...have, old: !have.brief?.local })
		listed = null
	}

	return { get, put, concepts, forget, lookAt }
}
