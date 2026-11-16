// Why a quote failed, worded for whoever wrote it, so they can fix it, and naming the file and commit it gave. The answer
// tool and the project record both send these words back to the model, and the page shows the first sentence.
import type { Quote, QuoteCheck } from './quote-check.ts'

export function explainQuote(check: Exclude<QuoteCheck, { kind: 'verified' }>, quote: Quote | undefined): string {
	const message = quote?.path === null
	const at = message ? `the message of commit ${quote?.commit}` : `${quote?.path} at ${quote?.commit}`
	switch (check.kind) {
		case 'not-found': {
			const numbered = /^\s*[+-]?\s*\d+\t/m.test(quote?.text ?? '')
				? ' Leave out the line numbers and the + or - signs.'
				: ''
			if (check.closest.length === 0 && message) {
				return `The quoted lines are not in ${at}, and no line of the message matches the first of them. Copy whole lines of the message as log shows them. To quote a file, give its path.${numbered}`
			}
			if (check.closest.length === 0) {
				return `The quoted lines are not in ${at}, and nothing in the file matches the first of them. Read the file again and copy the lines.${numbered}`
			}
			// As JSON strings, so the model sees the exact spaces and tabs that start each line, which models often miscount.
			const closest = check.closest.map((line) => `line ${line.line}: ${JSON.stringify(line.text)}`).join('\n  ')
			const what = message ? 'line of the message' : 'file line'
			return `The quoted lines are not in ${at}. Lines that hold the first quoted line, as JSON strings:\n  ${closest}\nEach quoted line must match the ${what} exactly and whole, with the same spaces or tabs at its start.${numbered}`
		}
		case 'empty':
			return 'The quote holds no code.'
		case 'refused':
			return `${check.reason}.`
		case 'no-commit':
			return `There is no commit "${check.ref}".`
		case 'no-file':
			return `There is no file ${at}.`
		case 'too-large':
			return `${message ? at : quote?.path} is too large to check.`
		default:
			return check satisfies never
	}
}
