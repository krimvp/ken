// What a plain program reads from a repository's deploy files, so ken can hold the model's frames to it: the services
// of a compose file with deploy.replicas, the Deployments, StatefulSets and DaemonSets of Kubernetes manifests with
// spec.replicas, and where the Dockerfiles are. It reads only those keys, by indentation, with no YAML library. A
// template (Helm's {{ }}), a Helm chart and Terraform are listed as unread, and the model's quotes stand for them.
import { type CommitHash, parsePath, type Repository } from '../../repo/index.ts'

// lines is the first and last line of the service or the manifest. copies is 1 when the file sets no replicas, as
// compose and Kubernetes then run one, and null for a DaemonSet (one on each machine) or a number ken cannot read, such
// as ${REPLICAS}. said is the line that sets replicas, or null.
export type Workload = {
	file: string
	name: string
	kind: 'service' | 'Deployment' | 'StatefulSet' | 'DaemonSet'
	copies: number | null
	said: number | null
	lines: { first: number; last: number }
}

export type DeployFacts = { workloads: Workload[]; dockerfiles: string[]; unread: string[] }

const COMPOSE = new Set(['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'])
const KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'] as const
const WORKLOAD = /^kind:\s*(Deployment|StatefulSet|DaemonSet)\s*(#.*)?$/m
const MOST_FILES = 200

export function isComposeFile(file: string): boolean {
	return COMPOSE.has(baseName(file))
}

// The workloads of one file, or null when ken cannot read the file this way: not YAML, a template, or neither a
// compose file nor a manifest of a workload.
export function readWorkloads(file: string, text: string): Workload[] | null {
	if (!/\.ya?ml$/.test(file) || text.includes('{{')) return null
	if (isComposeFile(file)) return composeServices(file, text)
	return WORKLOAD.test(text) ? manifests(file, text) : null
}

export async function deployFacts(repo: Repository, commit: CommitHash, signal?: AbortSignal): Promise<DeployFacts> {
	const listed = await repo.listFiles(commit, signal)
	const files = listed.kind === 'ok' ? listed.paths : []
	const charts = files.filter((file) => baseName(file) === 'Chart.yaml').map((file) => folderOf(file))
	const inChart = (file: string) => charts.some((chart) => chart === '' || file.startsWith(`${chart}/`))
	const workloads: Workload[] = []
	const unread = [...charts.map((chart) => `${chart || '.'} (a Helm chart)`)]
	for (const file of files.filter((each) => /\.ya?ml$/.test(each) && !inChart(each)).slice(0, MOST_FILES)) {
		const path = parsePath(file)
		const read = path.kind === 'ok' ? await repo.readFile(commit, path.path, signal) : null
		if (read?.kind !== 'ok') continue
		const found = readWorkloads(file, read.text)
		if (found) workloads.push(...found)
		else if (read.text.includes('{{') && (isComposeFile(file) || WORKLOAD.test(read.text))) {
			unread.push(`${file} (a template)`)
		}
	}
	const terraform = [...new Set(files.filter((file) => file.endsWith('.tf')).map(folderOf))]
	unread.push(...terraform.map((folder) => `${folder || '.'} (Terraform)`))
	const dockerfiles = files.filter((file) => /^(Dockerfile(\..+)?|.+\.Dockerfile)$/.test(baseName(file)))
	return { workloads, dockerfiles, unread }
}

type Line = { at: number; indent: number; text: string }

function composeServices(file: string, text: string): Workload[] {
	const lines = meaningful(text)
	const top = lines.findIndex((line) => line.indent === 0 && /^services:\s*$/.test(line.text))
	if (top === -1) return []
	const end = blockEnd(lines, top)
	const indent = lines[top + 1]?.indent ?? 0
	const keys = lines.flatMap((line, index) =>
		index > top && index < end && line.indent === indent && /^[\w.-]+:\s*$/.test(line.text) ? [index] : [],
	)
	return keys.map((key) => {
		const last = blockEnd(lines, key)
		const deploy = child(lines, key, last, 'deploy')
		const replicas = deploy === null ? null : child(lines, deploy, blockEnd(lines, deploy), 'replicas')
		return {
			file,
			name: (lines[key]?.text ?? '').replace(/:\s*$/, ''),
			kind: 'service' as const,
			...copiesOf(lines, replicas, true),
			lines: { first: lines[key]?.at ?? 0, last: lines[last - 1]?.at ?? 0 },
		}
	})
}

function manifests(file: string, text: string): Workload[] {
	const documents: Line[][] = [[]]
	for (const line of meaningful(text)) {
		if (line.indent === 0 && /^---/.test(line.text)) documents.push([])
		else documents.at(-1)?.push(line)
	}
	return documents.flatMap((lines) => {
		const top = (key: string) => lines.findIndex((line) => line.indent === 0 && line.text.startsWith(`${key}:`))
		const metadata = top('metadata')
		const spec = top('spec')
		const named = metadata === -1 ? null : child(lines, metadata, blockEnd(lines, metadata), 'name')
		const found = lines.find((line) => line.indent === 0 && WORKLOAD.test(line.text))?.text.match(WORKLOAD)?.[1]
		const workload = KINDS.find((kind) => kind === found)
		if (!workload || named === null) return []
		const replicas = spec === -1 ? null : child(lines, spec, blockEnd(lines, spec), 'replicas')
		return [
			{
				file,
				name: yamlValue(lines[named]?.text ?? ''),
				kind: workload,
				...copiesOf(lines, replicas, workload !== 'DaemonSet'),
				lines: { first: lines[0]?.at ?? 0, last: lines.at(-1)?.at ?? 0 },
			},
		]
	})
}

// Lines that hold a key or a value, with their numbers from 1. Blank lines and whole-line comments say nothing here.
function meaningful(text: string): Line[] {
	return text.split('\n').flatMap((raw, index) => {
		const trimmed = raw.trim()
		if (trimmed === '' || trimmed.startsWith('#')) return []
		return [{ at: index + 1, indent: raw.length - raw.trimStart().length, text: trimmed }]
	})
}

// The index after the last line of the block a key starts: every line after it that is indented further.
function blockEnd(lines: Line[], key: number): number {
	const indent = lines[key]?.indent ?? 0
	let end = key + 1
	while (end < lines.length && (lines[end]?.indent ?? 0) > indent) end += 1
	return end
}

// The index of a direct child key of the block from key to end, or null.
function child(lines: Line[], key: number, end: number, name: string): number | null {
	const indent = lines[key + 1]?.indent
	for (let at = key + 1; at < end; at++) {
		const line = lines[at]
		if (line && line.indent === indent && line.text.startsWith(`${name}:`)) return at
	}
	return null
}

function yamlValue(text: string): string {
	return text
		.slice(text.indexOf(':') + 1)
		.replace(/\s+#.*$/, '')
		.trim()
		.replace(/^["']|["']$/g, '')
}

function copiesOf(lines: Line[], replicas: number | null, counted: boolean) {
	const line = replicas === null ? undefined : lines[replicas]
	if (!line) return { copies: counted ? 1 : null, said: null }
	return { copies: count(line.text), said: line.at }
}

// A literal whole number, or null for anything else, such as ${REPLICAS}.
function count(text: string): number | null {
	const value = yamlValue(text)
	return /^\d+$/.test(value) ? Number(value) : null
}

function baseName(file: string): string {
	return file.split('/').at(-1) ?? file
}

function folderOf(file: string): string {
	return file.split('/').slice(0, -1).join('/')
}
