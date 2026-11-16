import { spawn } from 'node:child_process'
import type { ModelFlags } from '../agent/index.ts'
import { openServer } from '../server/index.ts'

// "ken open": starts the page's server on 127.0.0.1 and keeps it running until Ctrl-C. live turns live mode on with it.
export async function openPage(options: {
	directory: string
	port: string | undefined
	flags: ModelFlags
	live: boolean
}) {
	const port = Number(options.port ?? '0')
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		process.stderr.write('--port takes a whole number from 0 to 65535. 0, the default, picks a free port.\n')
		return 2
	}
	const opened = await openServer({
		directory: options.directory,
		flags: options.flags,
		env: process.env,
		port,
		live: options.live,
	})
	if (opened.kind !== 'ok') {
		process.stderr.write(`${opened.message}\n`)
		return 2
	}
	const { server } = opened
	const asks = server.model
		? `It asks ${server.model}.`
		: 'No model is set, so the page shows earlier answers and says what to set before you can ask.'
	const live = server.live
		? ' Live mode is on: ken writes a note as the work changes, and each note is a model call.'
		: ''
	process.stdout.write(
		`ken reads ${server.root}. ${asks}${live}\nOpen ${server.url} in your browser. Press Ctrl-C to stop.\n`,
	)
	openBrowser(server.url)
	await new Promise<void>((resolve) => {
		process.once('SIGINT', resolve)
		process.once('SIGTERM', resolve)
	})
	await server.close()
	return 0
}

// Best effort: with no browser or no opener, the address printed above is enough.
function openBrowser(url: string) {
	const [command, args] =
		process.platform === 'darwin'
			? ['open', [url]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '""', url]]
				: ['xdg-open', [url]]
	const opener = spawn(command, args, { stdio: 'ignore', detached: true })
	opener.on('error', () => {})
	opener.unref()
}
