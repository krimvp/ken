import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { checkStructure } from '../../scripts/check/structure.ts'

const modules = {
	git: { job: 'Reads history from git.', imports: [], packages: ['simple-git'] },
	answer: { job: 'Writes the answer.', imports: ['git'], packages: ['@scope/pkg'] },
}

// With src/git/index.ts, this puts the folder at the limit of eight files.
const sevenFiles = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`src/git/file-${i}.ts`, '']))

const cases: { name: string; files: Record<string, string>; expected: string[] }[] = [
	{
		name: 'a tree that follows every rule passes',
		files: {
			...sevenFiles,
			'src/git/index.ts': "import { readFile } from 'node:fs'\nimport git from 'simple-git'\nimport './file-0.ts'",
			'src/answer/index.ts': "import { log } from '../git/index.ts'\nexport * from './inner/write.ts'",
			'src/answer/inner/write.ts':
				"import type { X } from '@scope/pkg/types'\nconst m = await import('../index.ts')\nconst ends = ['from', 'to']",
		},
		expected: [],
	},
	{
		name: 'a file directly in src/ fails',
		files: { 'src/main.ts': '' },
		expected: ['src/main.ts: src/ holds only module folders. Move this file into the module it belongs to.'],
	},
	{
		name: 'a module missing from the table fails',
		files: { 'src/billing/index.ts': '' },
		expected: [
			'src/billing: module "billing" is not in MODULES. Add it to the table in scripts/check/structure.ts with its job, imports and packages.',
		],
	},
	{
		name: 'an import, re-export or dynamic import of an inner file of another module fails',
		files: {
			'src/answer/index.ts':
				"import { log } from '../git/log.ts'\nexport { log } from '../git/log.ts'\nawait import('../git/log.ts')",
		},
		expected: [1, 2, 3].map(
			(line) =>
				`src/answer/index.ts:${line}: "../git/log.ts" reaches inside module "git". Import "../git/index.ts" instead and export what you need from there.`,
		),
	},
	{
		name: 'an import the table does not allow fails',
		files: { 'src/git/index.ts': "import { write } from '../answer/index.ts'" },
		expected: [
			'src/git/index.ts:1: module "git" may not import module "answer". If it should, add "answer" to its imports in MODULES (scripts/check/structure.ts). If not, the code belongs in another module.',
		],
	},
	{
		name: 'a package the table does not list fails',
		files: { 'src/answer/index.ts': "import { z } from 'zod/v4'\nimport { other } from '@scope/other'" },
		expected: [
			'src/answer/index.ts:1: module "answer" may not use package "zod". If it should, add "zod" to its packages in MODULES (scripts/check/structure.ts).',
			'src/answer/index.ts:2: module "answer" may not use package "@scope/other". If it should, add "@scope/other" to its packages in MODULES (scripts/check/structure.ts).',
		],
	},
	{
		name: 'a folder with more than eight files fails, at any depth',
		files: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`src/answer/deep/file-${i}.ts`, ''])),
		expected: ['src/answer/deep: holds 9 files, more than 8. Split the folder by concept.'],
	},
]

const scratch = mkdtempSync(path.join(tmpdir(), 'ken-structure-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

for (const [index, { name, files, expected }] of cases.entries()) {
	test(name, () => {
		const root = path.join(scratch, String(index))
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
			writeFileSync(path.join(root, file), text)
		}
		assert.deepEqual(checkStructure(root, modules), expected)
	})
}
