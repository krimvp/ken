import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFirstLook, sizeOf } from '../../src/first-look/index.ts'
import { type CommitHash, gitRepository } from '../../src/repo/index.ts'
import { buildRepository } from '../fixtures/build-repository.ts'

const NOW = new Date('2026-01-03T00:00:00Z')

async function firstLookOf(files: Record<string, string>) {
	const { root, hashes } = buildRepository([{ message: 'feat: start', files }])
	return await readFirstLook(gitRepository(root), (hashes[0] ?? '') as CommitHash, NOW)
}

const README = [
	'# shop',
	'',
	'[![build](https://example.com/badge.svg)](https://example.com)',
	'<img src="logo.png" alt="The logo">',
	'',
	'The order system of a small online shop.',
	'A shopper places an order in the web app.',
	'',
	'## Run it',
	'',
	'Run `docker compose up`.',
	'',
].join('\n')

test('what plain code reads first: the README paragraph past its heading and badges, the manifests, the languages and the deploy files', async () => {
	const { look, sizes } = await firstLookOf({
		'README.md': README,
		'package.json': JSON.stringify({
			name: 'shop',
			description: 'Orders, payments and stock',
			bin: { shop: 'bin/shop.js' },
			scripts: { test: 'node --test' },
		}),
		'pyproject.toml': '[project]\nname = "shop-tools"\n\n[project.scripts]\nrestock = "tools.restock:main"\n',
		'compose.yml': 'services:\n  web:\n    image: web\n  orders:\n    image: orders\n',
		'src/orders/place.ts': 'export function place() {\n\treturn 1\n}\n',
		'src/orders/pay.ts': 'export function pay() {}\n',
		'tools/restock.py': 'def main():\n    pass\n',
	})
	assert.deepEqual(look.about && { path: look.about.path, start: look.about.startLine, end: look.about.endLine }, {
		path: 'README.md',
		start: 6,
		end: 7,
	})
	assert.equal(look.about?.text, 'The order system of a small online shop.\nA shopper places an order in the web app.')
	assert.deepEqual(look.name, { text: 'shop', file: 'package.json' })
	assert.deepEqual(look.description, { text: 'Orders, payments and stock', file: 'package.json' })
	assert.deepEqual(
		look.entries.map((each) => [each.kind, each.name, each.runs]),
		[
			['bin', 'shop', 'bin/shop.js'],
			['script', 'test', 'node --test'],
			['bin', 'restock', 'tools.restock:main'],
		],
	)
	assert.deepEqual(
		look.languages.map((each) => [each.name, each.files, each.lines]),
		[
			['Markdown', 1, 11],
			['TypeScript', 2, 4],
			['Python', 1, 2],
		],
	)
	assert.deepEqual(look.deploy, [{ file: 'compose.yml', holds: '2 services: web, orders' }])
	assert.deepEqual(sizeOf(sizes, ['src']), { lines: 4, commits: 1 })
})

test('a project with no README and no manifest gets no quote and no name, and still its languages', async () => {
	const { look } = await firstLookOf({ 'main.go': 'package main\n\nfunc main() {\n}\n' })
	assert.equal(look.about, null)
	assert.equal(look.name, null)
	assert.deepEqual(look.entries, [])
	assert.deepEqual(look.languages, [{ name: 'Go', files: 1, lines: 4 }])
})
