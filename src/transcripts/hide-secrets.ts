// The one scrubbing step for session text. A saved session can hold keys and tokens that were pasted or printed, and
// what ken reads of a session can reach the model, the page, the reader's history and the shared project record. So
// every text the reader returns passes through here first, and each value that looks like a credential becomes HIDDEN.
// It is best effort: it finds known key formats, bearer tokens, random-looking values given to a name such as KEY,
// TOKEN, SECRET or PASSWORD, and the values of such variables in ken's own environment. A secret in plain prose, or a
// short one, gets through.

export const HIDDEN = '[hidden by ken]'

// Key formats that announce themselves by their start.
const KNOWN_KEYS = [
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bglpat-[A-Za-z0-9_-]{20,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	/\bAIza[0-9A-Za-z_-]{35}/g,
	/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
	/\bnpm_[A-Za-z0-9]{36}/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]
// A token has a digit somewhere, which keeps "Bearer authentication" in prose.
const BEARER = /\b(Bearer\s+)(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{8,}=*/gi
const SECRET_NAME = /key|token|secret|passw(?:or)?d|pwd|credential/i
// A name, then = or :, maybe inside quotes as in JSON, then the value up to a space, quote or separator. The value
// leaves out the full stop or bracket that may end its sentence.
const ASSIGNMENT =
	/\b([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)([^\s"'`,;]*[^\s"'`,;.!?:)\]}])/gi
// Long, with a digit and a letter, and none of the dots and brackets of code such as process.env.API_KEY.
const RANDOM_LOOKING = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9+/=_~-]{12,}$/
// Shorter values in the environment, such as "off" or "1", are settings, not secrets.
const MIN_ENV_SECRET = 8

export function secretHider(env: Record<string, string | undefined>): (text: string) => string {
	const named = (name: string) => SECRET_NAME.test(name) || name === env.KEN_API_KEY_ENV
	const values = Object.entries(env)
		.flatMap(([name, value]) => (named(name) && value && value.trim().length >= MIN_ENV_SECRET ? [value.trim()] : []))
		.sort((a, b) => b.length - a.length)
	return (text) => {
		let hidden = text
		for (const value of values) hidden = hidden.split(value).join(HIDDEN)
		for (const pattern of KNOWN_KEYS) hidden = hidden.replace(pattern, HIDDEN)
		hidden = hidden.replace(BEARER, `$1${HIDDEN}`)
		return hidden.replace(ASSIGNMENT, (whole, name: string, between: string, value: string) =>
			RANDOM_LOOKING.test(value) ? `${name}${between}${HIDDEN}` : whole,
		)
	}
}
