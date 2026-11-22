// The languages a project is written in, by the lines of each, from the files' extensions. Data files such as JSON
// and YAML, and code a project keeps from others, are left out, so the list says what its own code is written in.

export type Language = { name: string; files: number; lines: number }

const BY_EXTENSION: Record<string, string> = {
	ts: 'TypeScript',
	tsx: 'TypeScript',
	mts: 'TypeScript',
	cts: 'TypeScript',
	js: 'JavaScript',
	jsx: 'JavaScript',
	mjs: 'JavaScript',
	cjs: 'JavaScript',
	py: 'Python',
	go: 'Go',
	rs: 'Rust',
	java: 'Java',
	kt: 'Kotlin',
	swift: 'Swift',
	c: 'C',
	h: 'C',
	cc: 'C++',
	cpp: 'C++',
	hpp: 'C++',
	cs: 'C#',
	rb: 'Ruby',
	php: 'PHP',
	scala: 'Scala',
	ex: 'Elixir',
	exs: 'Elixir',
	sh: 'Shell',
	bash: 'Shell',
	sql: 'SQL',
	html: 'HTML',
	css: 'CSS',
	scss: 'CSS',
	vue: 'Vue',
	svelte: 'Svelte',
	md: 'Markdown',
	mdx: 'Markdown',
}

const KEPT_FROM_OTHERS = /(^|\/)(node_modules|vendor|third_party|dist|build)\/|\.min\.(js|css)$/

// lines holds the line count of each text file. The answer is ordered by lines, most first.
export function languagesOf(lines: Map<string, number>): Language[] {
	const found = new Map<string, Language>()
	for (const [path, count] of lines) {
		if (KEPT_FROM_OTHERS.test(path)) continue
		const dot = path.lastIndexOf('.')
		const name = dot > path.lastIndexOf('/') ? BY_EXTENSION[path.slice(dot + 1).toLowerCase()] : undefined
		if (name === undefined) continue
		const language = found.get(name) ?? { name, files: 0, lines: 0 }
		found.set(name, { name, files: language.files + 1, lines: language.lines + count })
	}
	return [...found.values()].sort((a, b) => b.lines - a.lines)
}
