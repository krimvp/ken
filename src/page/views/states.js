// The states of a question with no answer to show: the first visit, the agent at work, and each way a question can
// end without an answer. Also the list of steps, which the working state and "Show the steps" share.
import { count, duration, esc, prose } from './format.js'

const EXAMPLES = [
	'What did the last commit do?',
	'What did this branch do, and why?',
	'What changed this week, and who changed it?',
	'Why is the code laid out the way it is?',
]

export function emptyHtml(project) {
	return `<section class="welcome">
		<h1>Ask about this project.</h1>
		<p class="lead">ken reads the code and the git history of <code>${esc(project)}</code>. The agent answers in short statements, and each statement comes with the code it is about, quoted from git.</p>
	</section>`
}

export function emptyAfterHtml() {
	return `<section class="welcome-after">
		<h2>You could start with</h2>
		<ul class="starts">${EXAMPLES.map((q) => `<li><button data-act="example" data-key="ex-${esc(q)}">${esc(q)}</button></li>`).join('')}</ul>
		<div class="limit">
			<p>ken checks that every quoted line is in git, at the commit the answer names.</p>
			<p class="muted">It cannot check that a sentence about the code is true. The quote is there so you can judge.</p>
		</div>
	</section>`
}

export function stepsHtml(steps, live = false) {
	return `<ol class="steps">${steps
		.map((step, i) => {
			if (step.kind === 'tool') return `<li class="tool">${prose(step.text)}</li>`
			if (step.kind === 'rejected') {
				return `<li class="sent-back"><strong>The quote check sent answer ${step.attempt} back:</strong><ul>${step.problems.map((p) => `<li>${prose(firstSentence(p))}</li>`).join('')}</ul></li>`
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
	return `<p class="working-head" aria-live="polite"><span>The agent is reading the project</span><span class="small muted" id="working-clock">${duration(seconds)} so far, ${count(tools, 'step', 'steps')}</span></p>
		${earlier}
		${q.steps.length === 0 ? '<p class="small muted">Starting.</p>' : stepsHtml(q.steps.slice(hidden), true)}
		<p class="actions"><button class="quiet-button" data-act="stop" data-key="stop">Stop</button></p>`
}

export function workingPanelHtml() {
	return `<div class="panel-empty"><h2>Nothing to check yet</h2><p>When the agent sends its answer:</p>
		<ol>
			<li>ken looks in git for every line the answer quotes.</li>
			<li>If a quote is not there, ken sends the answer back. The agent gets three tries.</li>
			<li>The answer appears on the left. What ken checked appears here: the quotes, the changed code no quote covers, and the commits.</li>
		</ol></div>`
}

const ORDINAL = ['First', 'Second', 'Third']

// Each way a question ends with no answer to show, with what it means and what the reader can do next.
export function endedHtml(q) {
	const again = '<button class="primary" data-act="again" data-key="again">Ask again</button>'
	if (q.outcome === 'rejected') {
		const tries = q.steps.filter((step) => step.kind === 'rejected')
		return `<div class="notice" role="status">
			<h3>ken has no checked answer for this question</h3>
			<p>The agent sent an answer three times. Each time, ken's quote check found a quote that is not in its file at the commit it names, and sent the answer back. ken shows no answer it could not check.</p>
			<ol class="tries">${tries.map((step, i) => `<li><span class="try">${ORDINAL[i] ?? `Answer ${step.attempt}`} answer</span><ul>${step.problems.map((p) => `<li>${prose(firstSentence(p))}</li>`).join('')}</ul></li>`).join('')}</ol>
			<p class="muted">A smaller question often works. Name one commit or one file.</p>
			<p class="actions">${again}<button class="quiet-button" data-act="one-commit" data-key="one-commit">Ask about one commit</button></p>
		</div>`
	}
	if (q.outcome === 'error') {
		return `<div class="notice" role="alert">
			<h3>The model did not answer</h3>
			<p>ken asked the model, and the request failed with this message:</p>
			<pre>${esc(q.error)}</pre>
			<p class="muted">If the message names the key, the address or the model, fix that setting and start ken open again. If it says the model was busy, ask again.</p>
			<p class="actions">${again}</p>
		</div>`
	}
	const said = {
		stopped: ['You stopped this question', 'ken shows nothing for a question you stopped.'],
		'no-answer': [
			'The agent stopped without sending an answer',
			'It wrote text, but never sent an answer for ken to check.',
		],
		'out-of-turns': [
			'The agent ran out of turns',
			'It was still reading the project when it reached its limit of turns. A smaller question often works.',
		],
	}[q.outcome] ?? ['This question has no answer', '']
	return `<div class="notice" role="status">
		<h3>${said[0]}</h3>
		<p>${said[1]}</p>
		<p class="actions">${again}</p>
	</div>`
}

// ken's checks explain a problem to the model and then tell it how to fix it. The reader needs only the problem.
function firstSentence(problem) {
	return problem.split(/(?<=\.)\s+/)[0]
}

// No model is set, so nothing can be asked. Each setting comes with what it means, and an example to copy.
export function noModelHtml(model, hasHistory) {
	const settings =
		model.missing.length === 0
			? `<p>${esc(model.message)}</p>`
			: `<p>ken sends your project's code to the model you choose, so it has no default model. Set these before you start ken open:</p>
				<dl class="settings">${model.missing.map((s) => `<div><dt><code>${esc(s.name)}</code></dt><dd>${esc(s.means)}. Or give <code class="nowrap">${esc(s.flag)}</code>.</dd></div>`).join('')}</dl>
				<p>For example:</p>
				<pre>${esc(model.example)} npm run ken -- open</pre>`
	return `<div class="notice" role="alert" id="no-model">
		<h3>ken has no model to ask</h3>
		${settings}
		<p>Then stop ken open with Ctrl-C and start it again.${hasHistory ? ' Until then you can still read your earlier questions.' : ''}</p>
	</div>`
}
