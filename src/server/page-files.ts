import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type PageFile = { type: string; body: Buffer }

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
}

// The page's files by URL path, read once at start, and each of extra under its path. A request path is only looked up
// here, so it never reaches the file system.
export async function readPageFiles(folder: string, extra: Record<string, string>): Promise<Map<string, PageFile>> {
	const files = new Map<string, PageFile>()
	for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
		const type = TYPES[path.extname(entry.name)]
		if (!entry.isFile() || type === undefined) continue
		const file = path.join(entry.parentPath, entry.name)
		files.set(`/${path.relative(folder, file).split(path.sep).join('/')}`, { type, body: await readFile(file) })
	}
	for (const [where, file] of Object.entries(extra)) {
		const type = TYPES[path.extname(file)]
		if (type === undefined) throw new Error(`ken cannot serve ${file}: it has no known type`)
		files.set(where, { type, body: await readFile(file) })
	}
	const index = files.get('/index.html')
	if (!index) throw new Error(`${folder} has no index.html, so ken has no page to serve`)
	files.set('/', index)
	return files
}
