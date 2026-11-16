// The states of a question with no answer to show: the first visit, the agent at work, and each way a question can
// end without an answer. Also the list of steps, which the working state and "Show the steps" share.
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
		<p class="lead">ken reads the code and the git history of ${folderHtml(project)}. ken's model answers in short statements, and each statement comes with the code it is about, quoted from git.</p>
	</section>`
}

export function emptyAfterHtml(lenses) {
	return `<section class="welcome-after">
		<h2>You could start with</h2>
		<ul class="starts">${EXAMPLES.map((q) => `<li><button data-act="example" data-key="ex-${esc(q)}">${esc(q)}</button></li>`).join('')}</ul>
		<h2>Or let ken write the question</h2>
		${lenses}
		<div class="limit">
			<p>ken checks that every quoted line is in git, at the commit the answer names.</p>
			<p class="muted">It cannot check that a sentence about the code is true. The quote is there so you can judge.</p>
		</div>
	</section>`
}

// The project record is ken's own word, so the first step that names it says what it is.
const RECORD = 'the project record'
const RECORD_SAID = 'the project record, where ken keeps what earlier answers found'

export function stepsHtml(steps, live = false) {
	const first = steps.findIndex((step) => step.kind === 'tool' && step.text.includes(RECORD))
	return `<ol class="steps">${steps
		.map((step, i) => {
			if (step.kind === 'tool')
				return `<li class="tool">${prose(i === first ? step.text.replace(RECORD, RECORD_SAID) : step.text)}</li>`
			if (step.kind === 'rejected') {
				return `<li class="sent-back"><strong>ken rejected draft ${step.attempt}:</strong><ul>${step.problems.map((p) => `<li>${prose(readerProblem(p))}</li>`).join('')}</ul></li>`
			}
			const caret = live && i === steps.length - 1 ? '<span class="caret" aria-hidden="true"></span>' : ''
			return `<li class="said">${prose(step.text.trim())}${caret}</li>`
		})
		.join('')}</ol>`
}

const SHOWN_WHILE_WORKING = 8

export function workingHtml(q, ui, seconds) {
	const tools = q.steps.filter((step) => step.kind === 'tool').length
	const hidden = ui.stepsOpen ? 0 : Math.max(0, q.steps.length - SHOWN_WHILE_WORKING)
	const earlier =
		hidden === 0
			? ''
			: `<p class="small"><button class="link" data-act="steps" data-key="steps">Show ${count(hidden, 'earlier step', 'earlier steps')}</button></p>`
	return `<p class="working-head" aria-live="polite"><span>ken's model is reading the project</span><span class="small muted" id="working-clock">${duration(seconds)} so far, ${count(tools, 'step', 'steps')}</span></p>
		${earlier}
		${q.steps.length === 0 ? '<p class="small muted">Starting.</p>' : stepsHtml(q.steps.slice(hidden), true)}
		<p class="actions"><button class="quiet-button" data-act="stop" data-key="stop">Stop</button></p>`
}

const HOW_KEN_CHECKS = `<ol>
		<li>ken looks in git for every line the answer quotes.</li>
		<li>If a quote is not there, ken rejects the draft. ken's model gets three drafts.</li>
		<li>The answer appears on the left. What ken checked appears here: the quotes, the changed code no quote covers, and the commits.</li>
	</ol>`

export function workingPanelHtml() {
	return `<div class="panel-empty"><h2>Nothing to check yet</h2><p>When ken's model sends its answer:</p>${HOW_KEN_CHECKS}</div>`
}

export function endedPanelHtml() {
	return `<div class="panel-empty"><h2>Nothing to check</h2><p>This question has no answer, so there are no quotes to show. When a question gets an answer:</p>${HOW_KEN_CHECKS}</div>`
}

const ORDINAL = ['first', 'second', 'third']

// Drafts rejected for the same reasons fold into one item: "Second and third drafts".
function triesHtml(tries) {
	const groups = []
	for (const [i, step] of tries.entries()) {
		const said = step.problems.map(readerProblem)
		const last = groups.at(-1)
		if (last && last.said.join('\n') === said.join('\n')) last.tries.push(i)
		else groups.push({ tries: [i], said })
	}
	return groups
		.map(({ tries: which, said }) => {
			const names = list(which.map((i) => ORDINAL[i] ?? `number ${i + 1}`))
			const name = which.length === 3 ? 'all three drafts' : `${names} ${which.length === 1 ? 'draft' : 'drafts'}`
			return `<li><span class="try">${name[0].toUpperCase()}${name.slice(1)}</span><ul>${said.map((p) => `<li>${prose(p)}</li>`).join('')}</ul></li>`
		})
		.join('')
}

const STATUS = [
	[/^40[13]$/, 'The model service refused the API key'],
	[/^404$/, 'The model service has no such model, or ken has the wrong address for it'],
	[/^(408|429|5\d\d)$/, 'The model service was busy or failed. Asking again often works'],
]

// Asking again after a refused key or a wrong address fails the same way until the setting is fixed and ken open restarts.
function retryCost(error) {
	const status = error.match(/^(\d{3})\b/)?.[1]
	return status && /^(40[134])$/.test(status)
		? 'One model run. It fails the same way until you fix the setting and restart ken open.'
		: 'One model run.'
}

// A model error in words first. The service's own message follows it as it came.
function modelProblem(error) {
	const status = error.match(/^(\d{3})\b/)?.[1]
	const words = status && STATUS.find(([pattern]) => pattern.test(status))?.[1]
	return words ? `${words} (status ${status}).` : 'The request to the model failed.'
}

// Each way a question ends with no answer to show, with what it means and what the reader can do next.
export function endedHtml(q) {
	const button = '<button class="primary" data-act="again" data-key="again">Ask again</button>'
	const again = withCost(button)
	if (q.outcome === 'rejected') {
		const tries = q.steps.filter((step) => step.kind === 'rejected')
		return `<div class="notice" role="status">
			<h3>No answer. ken rejected every draft.</h3>
			<p>ken's model sent three drafts. In each, a quote was not in its file at the commit it names, so ken rejected it. ken shows an answer only when it finds every quote.</p>
			<ol class="tries">${triesHtml(tries)}</ol>
			<p class="muted">A smaller question often works. Name one commit or one file.</p>
			<p class="actions">${again}<button class="quiet-button" data-act="one-commit" data-key="one-commit">Ask what the last commit did</button></p>
		</div>`
	}
	if (q.outcome === 'error') {
		return `<div class="notice" role="alert">
			<h3>The model did not answer</h3>
			<p>${modelProblem(q.error)}</p>
			<p class="muted">What came back:</p>
			<pre>${esc(q.error)}</pre>
			<p class="muted">If it names the key, the address or the model, fix that setting and restart <code>ken open</code>.</p>
			<p class="actions">${withCost(button, retryCost(q.error))}</p>
		</div>`
	}
	if (q.outcome === 'unasked') {
		return `<div class="notice" role="status"><h3>ken did not ask its model</h3><p>${esc(q.error)}</p></div>`
	}
	const said = {
		stopped: ['You stopped this question', 'ken shows nothing for a question you stopped.'],
		'no-answer': [
			"ken's model stopped without sending an answer",
			'It wrote text, but never sent an answer for ken to check.',
		],
		'out-of-turns': [
			"ken's model ran out of turns",
			'It was still reading the project when it reached its limit of turns. A smaller question often works.',
		],
	}[q.outcome] ?? ['This question has no answer', '']
	return `<div class="notice" role="status">
		<h3>${said[0]}</h3>
		<p>${said[1]}</p>
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
				<pre class="command">${[...model.example.split(' ').map((part) => `${part} \\`), 'npm run ken -- open'].map((line) => `<span>${esc(line).replace('=', '=<wbr>')}</span>`).join('')}</pre></li>`
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
