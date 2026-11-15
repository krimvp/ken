import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const ROOT = path.join(import.meta.dirname, '../..')

test("the page's design tokens are the public site's, so the two look the same", () => {
	const site = readFileSync(path.join(ROOT, 'site/style.css'), 'utf8')
	const page = readFileSync(path.join(ROOT, 'src/page/tokens.css'), 'utf8')
	const tokens = page.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim()

	assert.ok(tokens.includes('--color-text'), 'src/page/tokens.css holds the tokens')
	assert.ok(
		site.includes(tokens),
		'src/page/tokens.css differs from the tokens in site/style.css. Copy the :root block and the dark block from there.',
	)
})
