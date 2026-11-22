// "In its world" and "Where it runs" as the server sends them, for three projects: the six-part agent engine of the
// demo, the shop of the distributed example, and a made-up system of 30 things in 4 frames. Quotes are left out: the
// layout does not read them.

const frame = (id: string, kind: string, name: string, inFrame: string | null, copies: number | null = null) => ({
	id,
	kind,
	name,
	line: `Where ${name} runs.`,
	in: inFrame,
	copies: copies === null ? null : { count: copies, quote: { path: 'x', startLine: 1, endLine: 1, text: '' } },
	quotes: [],
})
const part = (id: string, name: string, inFrame: string | null) => ({
	id,
	kind: 'part',
	part: name,
	frame: inFrame,
	quotes: [],
})
const store = (id: string, kind: string, name: string, inFrame: string | null, topics: string[] = []) => ({
	id,
	kind: 'store',
	store: kind,
	name,
	line: `${name}.`,
	topics,
	frame: inFrame,
	quotes: [],
})
const outsideThing = (id: string, inFrame: string | null = null) => ({ id, kind: 'outside', frame: inFrame })
const call = (id: string, from: string, to: string, how: string, text = 'calls') => ({
	id,
	kind: 'call',
	how,
	from,
	to,
	text,
	quotes: { from: [], to: [] },
})
const event = (id: string, from: string, to: string, topic: string) => ({
	id,
	kind: 'event',
	topic,
	from,
	to,
	text: topic,
	quotes: { from: [], to: [] },
})
const outside = (id: string, kind: string, name: string) => ({ id, kind, name, line: `${name}.`, quotes: [] })
const across = (id: string, to: string, how: string, direction: string, text: string) => ({
	id,
	outside: to,
	text,
	how,
	direction,
	quotes: [],
})

export const DEMO_PARTS = [
	'Plugin engine',
	'Sandbox',
	'Host entry and pi adapter',
	'Eval runner and CLI',
	'multeval integration',
	'Repo tooling',
]

export const DEMO = {
	world: {
		project: { line: 'An agent engine with plugins and a sandbox.' },
		outside: [
			outside('host-app', 'system', 'A host application'),
			outside('model', 'system', 'The model'),
			outside('multeval', 'system', 'multeval'),
			outside('dev', 'person', 'A developer'),
		],
		crossings: [
			across('w1', 'host-app', 'library', 'in', 'prompts'),
			across('w2', 'model', 'https', 'out', 'prompts'),
			across('w3', 'multeval', 'process', 'in', 'scenarios'),
			across('w4', 'dev', 'other', 'in', 'commands, typed in a terminal'),
		],
	},
	runtime: {
		frames: [
			frame('host', 'process', "Host's Node process", null),
			frame('worker', 'thread', 'Worker thread', 'host'),
			frame('quickjs', 'vm', 'QuickJS virtual machine', 'worker'),
			frame('mprocs', 'process', "multeval's processes", null),
			frame('devbox', 'machine', "Developer's machine, CI", null),
		],
		things: [
			part('eval', 'Eval runner and CLI', 'host'),
			part('entry', 'Host entry and pi adapter', 'host'),
			part('engine', 'Plugin engine', 'host'),
			part('sandbox', 'Sandbox', 'host'),
			part('sandbox-worker', 'Sandbox', 'worker'),
			store('vmcode', 'other', 'Code the model wrote', 'quickjs'),
			part('mint', 'multeval integration', 'mprocs'),
			part('eval-checks', 'Eval runner and CLI', 'mprocs'),
			part('tooling', 'Repo tooling', 'devbox'),
			store('runs', 'files', 'Run folder', null),
			outsideThing('model'),
			outsideThing('multeval'),
		],
		crossings: [
			call('c0', 'multeval', 'mint', 'process', 'child processes'),
			call('c1', 'mint', 'eval', 'process', 'child process'),
			call('c2', 'eval', 'entry', 'library', 'opens sessions'),
			call('c3', 'entry', 'engine', 'library', 'loads plugins'),
			call('c4', 'engine', 'sandbox', 'library', 'runs code'),
			call('c5', 'sandbox', 'sandbox-worker', 'other', 'worker messages'),
			call('c6', 'sandbox-worker', 'vmcode', 'other', 'call, write'),
			call('c7', 'entry', 'model', 'https', 'prompts'),
			call('c8', 'eval', 'runs', 'file', 'writes runs'),
			call('c9', 'mint', 'runs', 'file', 'reads runs'),
		],
		gaps: [{ id: 'g1', on: 'devbox', text: 'where CI runs: not in the repository' }],
	},
}

export const SHOP_PARTS = ['web app', 'gateway', 'orders', 'payments', 'inventory', 'notifier', 'events package']

const TOPICS = [
	'order.placed',
	'payment.settled',
	'payment.failed',
	'stock.reserved',
	'stock.short',
	'payments.dead-letter',
]

export const SHOP = {
	world: {
		project: { line: 'The order system of an online shop.' },
		outside: [
			outside('shopper', 'person', 'Shopper'),
			outside('pay', 'system', 'Payment provider'),
			outside('mail', 'system', 'Mail provider'),
		],
		crossings: [
			across('w1', 'shopper', 'https', 'in', 'places orders'),
			across('w2', 'pay', 'https', 'out', 'charges cards'),
			across('w3', 'mail', 'https', 'out', 'sends emails'),
		],
	},
	runtime: {
		frames: [
			frame('browser', 'browser', 'Browser', null),
			frame('cluster', 'cluster', 'Cluster, namespace shop', null),
			frame('gw', 'container', 'gateway', 'cluster', 2),
			frame('ord', 'container', 'orders', 'cluster', 2),
			frame('pay-c', 'container', 'payments', 'cluster', 2),
			frame('inv', 'container', 'inventory', 'cluster', 1),
			frame('note', 'container', 'notifier', 'cluster', 1),
		],
		things: [
			part('web', 'web app', 'browser'),
			part('gateway', 'gateway', 'gw'),
			part('orders', 'orders', 'ord'),
			part('payments', 'payments', 'pay-c'),
			part('inventory', 'inventory', 'inv'),
			part('notifier', 'notifier', 'note'),
			store('cache', 'cache', 'cache', 'cluster'),
			store('bus', 'bus', 'Event bus', 'cluster', TOPICS),
			store('orders-db', 'database', 'orders db', null),
			store('inventory-db', 'database', 'inventory db', null),
			outsideThing('shopper'),
			outsideThing('pay'),
			outsideThing('mail'),
		],
		crossings: [
			call('c0', 'shopper', 'web', 'https', 'opens'),
			call('c1', 'web', 'gateway', 'https', 'requests'),
			call('c2', 'gateway', 'cache', 'other', 'Redis'),
			call('c3', 'gateway', 'orders', 'http', 'places orders'),
			call('c4', 'orders', 'orders-db', 'sql', 'writes'),
			call('c5', 'inventory', 'inventory-db', 'sql', 'reserves'),
			call('c6', 'payments', 'pay', 'https', 'charges'),
			call('c7', 'notifier', 'mail', 'https', 'sends'),
			event('e1', 'orders', 'payments', 'order.placed'),
			event('e2', 'payments', 'inventory', 'payment.settled'),
			event('e3', 'payments', 'orders', 'payment.settled'),
			event('e4', 'payments', 'notifier', 'payment.failed'),
			event('e5', 'inventory', 'notifier', 'stock.reserved'),
			event('e6', 'inventory', 'orders', 'stock.short'),
			event('e7', 'payments', 'bus', 'payments.dead-letter'),
		],
		gaps: [
			{ id: 'g1', on: 'orders-db', text: 'who runs it: not in the repository' },
			{ id: 'g2', on: 'inventory-db', text: 'who runs it: not in the repository' },
		],
	},
}

// 30 things in 4 frames: a cluster of 18 services (three each of six prefixes) with a cache, an edge of two
// gateways, two workers' machines, and outside systems.
export function bigSystem() {
	const groups = ['orders', 'billing', 'search', 'users', 'stock', 'mail']
	const things = []
	const crossings = []
	for (const [g, group] of groups.entries()) {
		for (const n of [1, 2, 3]) {
			things.push(part(`${group}-${n}`, `${group}-${['api', 'worker', 'cron'][n - 1]}`, 'cluster'))
			if (n > 1) crossings.push(call(`${group}-c${n}`, `${group}-1`, `${group}-${n}`, 'grpc'))
		}
		crossings.push(call(`edge-${group}`, `edge-${(g % 2) + 1}`, `${group}-1`, 'http'))
	}
	things.push(store('cache', 'cache', 'cache', 'cluster'))
	crossings.push(call('cache-c', 'users-1', 'cache', 'other', 'Redis'))
	things.push(part('edge-1', 'edge-public', 'edge'), part('edge-2', 'edge-admin', 'edge'))
	things.push(part('batch-1', 'batch-nightly', 'batch'), part('batch-2', 'batch-reports', 'batch'))
	crossings.push(call('batch-c', 'batch-1', 'orders-1', 'http'))
	things.push(store('db', 'database', 'main db', 'data'), store('files', 'files', 'exports', 'data'))
	crossings.push(call('db-c', 'orders-1', 'db', 'sql'), call('files-c', 'batch-2', 'files', 'file'))
	things.push(store('jobs', 'queue', 'jobs queue', 'cluster'), part('logs', 'logs-shipper', 'data'))
	crossings.push(call('jobs-c', 'stock-1', 'jobs', 'other', 'enqueues'), call('logs-c', 'logs', 'files', 'file'))
	things.push(outsideThing('bank'), outsideThing('crm'), outsideThing('ops'))
	crossings.push(call('bank-c', 'billing-1', 'bank', 'https'), call('crm-c', 'users-2', 'crm', 'https'))
	crossings.push(call('ops-c', 'ops', 'edge-2', 'https'))
	return {
		world: {
			project: { line: 'A big system.' },
			outside: [
				outside('bank', 'system', 'Bank'),
				outside('crm', 'system', 'CRM'),
				outside('ops', 'person', 'Operator'),
			],
			crossings: [],
		},
		runtime: {
			frames: [
				frame('cluster', 'cluster', 'Cluster', null),
				frame('edge', 'container', 'Edge', null, 2),
				frame('batch', 'machine', 'Batch machine', null),
				frame('data', 'machine', 'Data machine', null),
			],
			things,
			crossings,
			gaps: [{ id: 'g1', on: 'bank', text: 'which bank: not in the repository' }],
		},
	}
}
