import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import type { LayoutSources } from '../../src/layout/index.ts'
import { openSnapshots } from '../../src/live/index.ts'
import { openMap, openSeen } from '../../src/map/index.ts'
import { fileRecordStore } from '../../src/record/index.ts'
import { gitRepository } from '../../src/repo/index.ts'

// What the layout reads for one project, with a new reader's home that is removed when the test file ends.
export async function sourcesFor(root: string): Promise<LayoutSources> {
	const home = mkdtempSync(path.join(tmpdir(), 'ken-home-'))
	after(() => rmSync(home, { recursive: true, force: true }))
	const store = await openSnapshots(home, gitRepository(root), root)
	const repo = gitRepository(root, { alternate: store.objects })
	const record = fileRecordStore(root, repo)
	const [opened, looked] = await Promise.all([openMap(home, repo, record), openSeen(home, repo)])
	if (opened.kind !== 'ok' || looked.kind !== 'ok') assert.fail('the fixture has commits')
	return { root, repo, snapshots: store, record, map: opened.map, seen: looked.seen }
}
