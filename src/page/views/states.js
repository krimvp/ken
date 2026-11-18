// The states of a question with no reply to show: the first visit, the model at work, and each way a question can end
// without a reply. Also the list of steps, which the working state and "Show the steps" share.
import { count, duration, esc, folderHtml, list, prose, withCost } from './format.js'

const EXAMPLES = [
	'What did the last commit do?',
	'What did this branch do, and why?',
	'What changed this week, and who changed it?',
	'Why is the code laid out the way it is?',
]

export function emptyHtml(project, canAsk) {
	return `<section class="welcome">
		<h1>${canAsk ? 'Ask about this project.' : 'ken has no model to ask.'}</h1>
		<p class="lead">ken reads the code and the git history of ${folderHtml(project)}. ken's model answers as a colleague would. When a claim needs proof, it shows a card with the code it rests on, quoted from git.</p>
	</section>`
}

export function emptyAfterHtml(lenses) {
	return `<section class="welcome-after">
		<div class="limit">
			<p>ken checks that every line a card quotes is in git, at the commit the card names.</p>
			<p class="muted">It cannot check that a sentence about the code is true. The quote is there so you can judge.</p>
		</div>
		<h2>You could start with</h2>
		<ul class="starts">${EXAMPLES.map((q) => `<li><button data-act="example" data-key="ex-${esc(q)}">${esc(q)}</button></li>`).join('')}</ul>
		<h2>Or let ken write the question</h2>
		${lenses}
	</section>`
}

// The project record is ken's own word, so the first step that names it says what it is.
const RECORD = 'the project record'
const RECORD_SAID = 'the project record, where ken keeps what earlier replies found'

export function stepsHtml(steps, live = false) {
	const first = steps.findIndex((step) => step.kind === 'tool' && step.text.includes(RECORD))
	return `<ol class="steps">${steps
		.map((step, i) => {
			if (step.kind === 'tool')
				return `<li class="tool">${prose(i === first ? step.text.replace(RECORD, RECORD_SAID) : step.text)}</li>`
			if (step.kind === 'sent-back') {
				return `<li class="sent-back"><strong>ken sent back ${esc(step.what.toLowerCase())}:</strong><ul>${step.problems.map((p) => `<li>${prose(readerProblem(p))}</li>`).join('')}</ul></li>`
			}
			const caret = live && i === steps.length - 1 ? '<span class="caret" aria-hidden="true"></span>' : ''
			return `<li class="said">${prose(step.text.trim())}${caret}</li>`
		})
		.join('')}</ol>`
}

const SHOWN_WHILE_WORKING = 8

// typing is what the model writes now, before ken knows whether it is working text or the reply.
export function workingHtml(q, t, open, seconds) {
	const tools = q.steps.filter((step) => step.kind === 'tool').length
	const hidden = open ? 0 : Math.max(0, q.steps.length - SHOWN_WHILE_WORKING)
	const earlier =
		hidden === 0
			? ''
			: `<p class="small"><button class="link" data-act="steps" data-turn="${t}" data-key="steps-${t}">Show ${count(hidden, 'earlier step', 'earlier steps')}</button></p>`
	const steps = [...q.steps.slice(hidden), ...(q.typing ? [{ kind: 'text', text: q.typing }] : [])]
	return `<div class="working"><p class="working-head" aria-live="polite"><span>ken's model is reading the project</span><span class="small muted" id="working-clock">${duration(seconds)} so far, ${count(tools, 'step', 'steps')}</span></p>
		${earlier}
		${steps.length === 0 ? '<p class="small muted">Starting.</p>' : stepsHtml(steps, Boolean(q.typing))}
		<p class="actions"><button class="quiet-button" data-act="stop" data-key="stop">Stop</button></p></div>`
}

// The panel when there are no quotes yet: working while the model still writes.
export function noChecksPanelHtml(working) {
	const said = working
		? "When ken's model shows a card, ken looks in git for each line it quotes and lists here what it found."
		: 'This reply has no cards, so there is no quote to check.'
	return `<div class="panel-empty"><h2>${working ? 'Nothing to check yet' : 'Nothing to check'}</h2><p>${said}</p></div>`
}

const STATUS = [
	[/^40[13]$/, 'The model service refused the API key'],
	[/^404$/, 'The model service has no such model, or ken has the wrong address for it'],
	[/^(408|429|5\d\d)$/, 'The model service was busy or failed. Asking again often works'],
]

// Asking again after a refused key or a wrong address fails the same way until the setting is fixed and ken open restarts.
function failsAgain(error) {
	const status = error.match(/^(\d{3})\b/)?.[1]
	return status !== undefined && /^(40[134])$/.test(status)
}

// A model error in words first. The service's own message follows it as it came.
function modelProblem(error) {
	const status = error.match(/^(\d{3})\b/)?.[1]
	const words = status && STATUS.find(([pattern]) => pattern.test(status))?.[1]
	return words ? `${words} (status ${status}).` : 'The request to the model failed.'
}

// Each way a question ends with no reply to show, with what it means and what the reader can do next.
export function endedHtml(q, t) {
	const again = `<button class="primary" data-act="again" data-turn="${t}" data-key="again-${t}">Ask again</button>`
	if (q.outcome === 'error') {
		return `<div class="notice" role="alert">
			<h3>ken's model did not reply</h3>
			<p>${modelProblem(q.error)}</p>
			<p class="muted">What came back:</p>
			<pre>${esc(q.error)}</pre>
			<p class="muted">If it names the key, the address or the model, fix that setting and restart <code>ken open</code>.</p>
			<p class="actions">${
				failsAgain(q.error)
					? withCost(
							`<button class="quiet-button" data-act="again" data-turn="${t}" data-key="again-${t}">Ask again</button>`,
							'It fails the same way until you fix the setting and restart <code>ken open</code>.',
						)
					: again
			}</p>
		</div>`
	}
	if (q.outcome === 'unasked') {
		return `<div class="notice" role="status"><h3>ken did not ask its model</h3><p>${esc(q.error)}</p></div>`
	}
	const said = {
		stopped: ['You stopped this question', ''],
		'no-answer': ["ken's model stopped without a reply", 'It read the project but wrote nothing back.'],
		'out-of-turns': [
			"ken's model ran out of turns",
			'It was still reading the project when it reached its limit of turns. A smaller question often works.',
		],
	}[q.outcome] ?? ['This question has no reply', '']
	return `<div class="notice" role="status">
		<h3>${said[0]}</h3>
		${said[1] === '' ? '' : `<p>${said[1]}</p>`}
		<p class="actions">${again}</p>
	</div>`
}

// ken's checks explain a problem to the model and then tell it how to fix it, with the near lines as JSON strings. The
// reader needs only the problem, the line numbers of the near lines, and short commit ids.
function readerProblem(problem) {
	const first = problem.split(/(?<=\.)\s+/)[0].replace(/\b[0-9a-f]{40}\b/g, (hash) => hash.slice(0, 7))
	const near = [...problem.matchAll(/^\s+line (\d+): /gm)].map((match) => match[1])
	if (near.length === 0) return first
	if (near.length === 1) return `${first} Line ${near[0]} is close, but does not match exactly.`
	return `${first} Lines ${list(near)} are close, but none matches exactly.`
}

// No model is set, so nothing can be asked. The steps come in the order the reader takes them, each setting with what it
// means, and an example to copy with one setting per line.
export function noModelHtml(model, hasHistory, heading) {
	const settings =
		model.missing.length === 0
			? `<li>${esc(model.message)}</li><li>Start <code>ken open</code> again.</li>`
			: `<li>Set these:
				<dl class="settings">${model.missing.map((s) => `<div><dt><code>${esc(s.name)}</code></dt><dd>${esc(s.means)}. Or give <code class="nowrap">${esc(s.flag)}</code>.</dd></div>`).join('')}</dl></li>
				<li>Start it again. For example:
				<pre class="command">${[...model.example.split(' ').map((part) => `${part} \\`), 'ken open'].map((line) => `<span>${esc(line)}</span>`).join('')}</pre></li>`
	return `<div class="notice" role="alert" id="no-model">
		${heading ? '<h3>ken has no model to ask</h3>' : ''}
		<p>ken sends your project's code to the model you choose, so it has no default model.</p>
		<ol class="setup">
			<li>Stop ken with Ctrl-C in the terminal where it runs.</li>
			${settings}
		</ol>
		${hasHistory ? '<p class="muted">Until then you can still read your earlier questions under Your questions.</p>' : ''}
	</div>`
}
