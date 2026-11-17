import { styleText } from 'node:util'
import type { ModelFlags } from '../agent/index.ts'
import { at } from '../follow-up/index.ts'
import type { About, NowBlock } from '../live/index.ts'
import { openProject, type QuestionView } from '../server/index.ts'
import { formatReply, type Paint } from './reply/print-reply.ts'

// "ken live": live mode in a terminal pane beside the coding agent. It prints the Now block once, then each note as
// ken writes it, until Ctrl-C. It is the page's Live view without the page, and spends the same.
export async function watchLive(options: { directory: string; flags: ModelFlags }): Promise<number> {
	const opened = await openProject({ directory: options.directory, flags: options.flags, env: process.env })
	if (opened.kind !== 'ok') {
		process.stderr.write(`${opened.message}\n`)
		return 2
	}
	const { project } = opened
	if (project.model.kind !== 'ok' || !project.live) {
		process.stderr.write(
			`Live mode writes notes with a model, and none is set.\n${project.model.kind === 'ok' ? '' : project.model.message}\n`,
		)
		await project.close()
		return 2
	}
	const out = process.stdout
	const paint: Paint = (format, text) => styleText(format, text, { stream: out })
	const { live } = project
	live.subscribe((event) => {
		if (event.kind === 'writing') out.write(`${paint('dim', `Writing a note about ${aboutText(event.about)}.`)}\n`)
		else out.write(`\n${formatNote(event.view, paint)}\n`)
	})
	await live.start()
	const view = await live.view()
	const { pace } = view
	out.write(
		`ken watches ${project.root} and writes notes with ${project.model.name}. Every note is a model run: one after ${pace.quietMs / 1000} s without edits, at most one a minute and ${pace.perHour} an hour, and one for each commit. Press Ctrl-C to stop.\n\n${formatNow(view.now, paint)}\n`,
	)
	await new Promise<void>((resolve) => {
		process.once('SIGINT', resolve)
		process.once('SIGTERM', resolve)
	})
	await live.off()
	const { spent } = await live.view()
	await project.close()
	out.write(`\nken stopped. This run wrote ${spent.notes} notes for ${tokens(spent)} tokens.\n`)
	return 0
}

function formatNow(now: NowBlock, paint: Paint): string {
	const lines = [paint('bold', 'Now, from git and the saved session:')]
	lines.push(`  ${now.branch ? `On branch ${now.branch}.` : 'HEAD is not on a branch.'}`)
	const total = now.files.length + now.moreFiles
	lines.push(
		total === 0
			? '  No uncommitted changes.'
			: `  ${total} ${total === 1 ? 'file' : 'files'} with uncommitted changes:`,
	)
	for (const file of now.files) {
		const counted =
			file.change === 'deleted'
				? 'deleted'
				: file.added === null
					? 'binary or large'
					: file.change === 'new'
						? `new, ${file.added} lines`
						: `+${file.added} -${file.removed}`
		lines.push(`    ${file.path}  ${counted}`)
	}
	if (now.moreFiles > 0) lines.push(`    and ${now.moreFiles} more`)
	if (now.commits.length > 0) lines.push('  Last commits:')
	for (const commit of now.commits) lines.push(`    ${commit.hash.slice(0, 7)} ${commit.subject}`)
	if (now.ask.kind === 'asked') {
		lines.push(`  You last asked your coding agent ${at(now.ask.at)} (from the session):`)
		lines.push(...now.ask.text.split('\n').map((line) => `    ${line}`))
	} else {
		lines.push(
			now.ask.kind === 'off'
				? '  ken reads no saved sessions (KEN_SESSIONS is off).'
				: '  ken finds no saved session of your coding agent for this folder.',
		)
	}
	return lines.join('\n')
}

function formatNote({ entry, noNote }: QuestionView, paint: Paint): string {
	const about = entry.about ? aboutText(entry.about) : 'a change'
	const sent = entry.steps.filter((step) => step.kind === 'sent-back').length
	const cost = entry.usage ? `${entry.usage.seconds} s, ${tokens(entry.usage)} tokens` : 'no cost counted'
	const head = paint('bold', `Note ${at(entry.askedAt)} on ${about}`)
	const checked = sent === 0 ? 'every card passed first time' : `ken sent ${sent} cards back`
	if (entry.outcome !== 'answered') return `${head}\n${paint('dim', noNote ?? '')}`
	// ken's copy of uncommitted work is no commit the reader can look up, so its commits are not listed.
	const reply = entry.about?.kind === 'uncommitted' ? { ...entry.reply, change: null } : entry.reply
	return `${head}\n${paint('dim', `${cost}; ${checked}.`)}\n${formatReply(reply, paint)}`
}

function aboutText(about: About): string {
	return about.kind === 'commits'
		? `the commits ${about.base.slice(0, 7)}..${about.head.slice(0, 7)}`
		: `uncommitted work as it stood ${at(about.at)} (a draft, kept on this machine)`
}

function tokens(usage: { inputTokens: number; outputTokens: number }): string {
	return (usage.inputTokens + usage.outputTokens).toLocaleString('en-US')
}
