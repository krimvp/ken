// Why a quote failed, worded for whoever wrote it, so they can fix it. The answer tool and the project record both
// send these words back to the model.
import type { QuoteCheck } from './quote-check.ts'

export function explainQuote(check: Exclude<QuoteCheck, { kind: 'verified' }>, text: string): string {
	switch (check.kind) {
		case 'not-found': {
			const numbered = /^\s*[+-]?\s*\d+\t/m.test(text) ? ' Leave out the line numbers and the + or - signs.' : ''
			if (check.closest.length === 0) {
				return `these lines are not in the file at that commit, and no line holds the first quoted line. Read the file again and copy the lines.${numbered}`
			}
			// As JSON strings, so the model sees the exact spaces and tabs that start each line, which models often miscount.
			const closest = check.closest.map((line) => `line ${line.line}: ${JSON.stringify(line.text)}`).join('\n  ')
			return `these lines are not in the file at that commit. Lines that hold the first quoted line, as JSON strings:\n  ${closest}\nEach quoted line must match the file line exactly, with the same spaces or tabs at its start.${numbered}`
		}
		case 'empty':
			return 'the quote holds no code.'
		case 'refused':
			return `${check.reason}.`
		case 'no-commit':
			return `there is no commit "${check.ref}".`
		case 'no-file':
			return 'there is no such file at that commit.'
		case 'too-large':
			return 'the file is too large to check.'
		default:
			return check satisfies never
	}
}
