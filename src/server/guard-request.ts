import type { IncomingMessage } from 'node:http'

// ken reads a project that may be private and spends its owner's money on model calls, and any page open in the
// browser can send requests to 127.0.0.1. So a request must name this server in its Host header, which stops a site
// whose DNS name was pointed at 127.0.0.1, and a request that changes something must come from this server's own page.
export function refusal(request: IncomingMessage, port: number): string | null {
	const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
	if (!hosts.includes(request.headers.host ?? '')) return 'ken answers only requests sent to its own address.'
	if (request.method === 'GET' || request.method === 'HEAD') return null
	const origin = request.headers.origin ?? ''
	if (!hosts.some((host) => origin === `http://${host}`)) return "Only ken's own page can send this request."
	return null
}
