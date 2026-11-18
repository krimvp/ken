// npm installs ken under node_modules, and Node will not strip the types of a .ts file there. So ken strips its own
// .ts files here, the same way Node does elsewhere, and leaves every package it depends on to Node.
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const ken = new URL('../', import.meta.url).href

registerHooks({
	load(url, context, nextLoad) {
		const own = url.startsWith(ken) && !url.includes('/node_modules/', ken.length)
		if (!own || !url.endsWith('.ts')) return nextLoad(url, context)
		const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'))
		return { format: 'module', source, shortCircuit: true }
	},
})
