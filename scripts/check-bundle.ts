// Runs before "npm pack". npm puts aigent inside ken's package from node_modules, and with no aigent there it packs a
// ken that installs without complaint and cannot start.
import { createRequire } from 'node:module'

try {
	createRequire(import.meta.url).resolve('aigent')
} catch {
	process.stderr.write('aigent is not in node_modules, so the package would leave it out. Run npm ci first.\n')
	process.exit(1)
}
