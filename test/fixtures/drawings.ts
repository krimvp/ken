// "In its world" and "Where it runs" as the server sends them, for five projects: the six-part agent engine of the
// demo, the shop of the distributed example, a made-up system of 30 things in 4 frames, and the drawings ken's model
// named for two real repositories. Quotes are left out: the layout does not read them.

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

// The drawings ken's model named for the aigent repository, as the server sent them: three frames hold nothing,
// and multeval integration stands in no frame.
export const AIGENT = {
	world: {
		project: {
			line: 'aigent is a small agent engine for Node, for hosts that embed an agent, plus scenarios and graders that measure models in it. Its one idea: the plugin is the only extension point.',
		},
		outside: [
			outside('host-app', 'system', 'Host app'),
			outside('developer', 'person', 'Developer at the CLI'),
			outside('model-api', 'system', 'OpenAI-compatible model API'),
			outside('plugins', 'system', 'Plugins'),
			outside('multeval', 'system', 'multeval'),
			outside('env', 'system', 'Process environment'),
			outside('otel', 'system', "Host's OpenTelemetry SDK"),
		],
		crossings: [
			across('x-host', 'host-app', 'library', 'in', 'session calls'),
			across('x-argv', 'developer', 'process', 'in', 'argv'),
			across('x-report', 'developer', 'process', 'out', 'JSON report on stdout'),
			across('x-model', 'model-api', 'https', 'out', 'chat completions'),
			across('x-plugins', 'plugins', 'library', 'in', 'plugin modules'),
			across('x-multeval', 'multeval', 'process', 'in', 'runs the CLI per attempt'),
			across('x-env', 'env', 'other', 'in', 'API key'),
			across('x-otel', 'otel', 'library', 'out', 'spans'),
		],
	},
	runtime: {
		frames: [
			frame('node-process', 'process', 'Node process', null),
			frame('multeval-run', 'process', 'multeval run (Python)', null),
			frame('sandbox-worker', 'thread', 'Sandbox worker thread', 'node-process'),
			frame('just-bash', 'sandbox', 'just-bash shell', 'node-process'),
			frame('quickjs-vm', 'sandbox', 'QuickJS VM', 'sandbox-worker'),
		],
		things: [
			part('t-host', 'Host entry and pi adapter', 'node-process'),
			part('t-engine', 'Plugin engine', 'node-process'),
			part('t-eval', 'Eval runner and CLI', 'node-process'),
			part('t-sandbox-main', 'Sandbox', 'node-process'),
			part('t-sandbox-worker', 'Sandbox', 'sandbox-worker'),
			part('t-multeval', 'multeval integration', null),
			outsideThing('model-api'),
			outsideThing('plugins', 'node-process'),
			store('s-scenarios', 'files', 'Scenario files', null),
			store('s-results', 'files', 'Result directory', null),
		],
		crossings: [
			call('c-open', 't-eval', 't-host', 'library', 'opens sessions'),
			call('c-engine', 't-host', 't-engine', 'library', 'creates the engine'),
			call('c-model', 't-host', 'model-api', 'https', 'model requests'),
			call('c-plugins', 't-engine', 'plugins', 'library', 'imports plugin modules'),
			event('c-run', 't-sandbox-main', 't-sandbox-worker', 'ToWorker'),
			event('c-call', 't-sandbox-worker', 't-sandbox-main', 'FromWorker'),
			call('c-spawn', 't-multeval', 't-eval', 'process', 'spawns the CLI'),
			call('c-read-scenario', 't-eval', 's-scenarios', 'file', 'reads a scenario'),
			call('c-write-results', 't-eval', 's-results', 'file', 'writes and rereads the run'),
		],
		gaps: [
			{ id: 'g-host', on: 'node-process', text: 'which host app runs it in production: not in the repository' },
			{ id: 'g-multeval', on: 't-multeval', text: 'how multeval starts subject.ts: not read here' },
			{
				id: 'g-sandbox-caller',
				on: 't-sandbox-main',
				text: 'which engine code calls runCode and runBash: not read here',
			},
			{
				id: 'g-otel',
				on: 'node-process',
				text: "where spans are exported: up to the host's SDK, not in the repository",
			},
			{ id: 'g-bash', on: 'just-bash', text: 'optional peer dependency; absent, the bash tool mode fails' },
		],
	},
}

// The drawings ken's model named for the shop example, as the server sent them: the bus, the stores and the outside
// systems stand in no frame, and one part runs in three containers.
export const SHOP_NAMED = {
	world: {
		project: {
			line: 'The order system of a small online shop. Shoppers order in a web app; orders stores the order and answers at once, and payments, inventory and notifier do the rest through events on a bus.',
		},
		outside: [
			outside('shopper', 'person', 'Shopper'),
			outside('payment-provider', 'system', 'Payment provider'),
			outside('mail-provider', 'system', 'Mail provider'),
			outside('accounts', 'system', 'Accounts (sign-in)'),
		],
		crossings: [
			across('shopper-orders', 'shopper', 'https', 'in', 'orders and status checks'),
			across('charges', 'payment-provider', 'https', 'out', 'card charges'),
			across('emails', 'mail-provider', 'https', 'out', 'order emails'),
			across('sessions', 'accounts', 'other', 'in', 'sign-in sessions in Redis'),
		],
	},
	runtime: {
		frames: [
			frame('browser', 'browser', "Shopper's browser", null),
			frame('cluster', 'cluster', 'Kubernetes, namespace shop', null),
			frame('gateway-c', 'container', 'gateway', 'cluster', 2),
			frame('orders-c', 'container', 'orders', 'cluster'),
			frame('payments-c', 'container', 'payments', 'cluster'),
			frame('inventory-c', 'container', 'inventory', 'cluster'),
			frame('notifier-c', 'container', 'notifier', 'cluster'),
		],
		things: [
			part('web-part', 'Web app', 'browser'),
			part('gateway-part', 'Gateway', 'gateway-c'),
			part('orders-part', 'Orders service', 'orders-c'),
			part('payments-part', 'Event workers', 'payments-c'),
			part('inventory-part', 'Event workers', 'inventory-c'),
			part('notifier-part', 'Event workers', 'notifier-c'),
			store('orders-db', 'database', 'Orders database', null),
			store('inventory-db', 'database', 'Inventory database', null),
			store('cache', 'cache', 'Redis cache', null),
			store('bus', 'bus', 'Event bus (Kafka API)', null, [
				'order.placed',
				'payment.settled',
				'payment.failed',
				'stock.reserved',
				'stock.short',
				'payments.dead-letter',
			]),
			outsideThing('payment-provider'),
			outsideThing('mail-provider'),
		],
		crossings: [
			call('web-to-gateway', 'web-part', 'gateway-part', 'https', 'place order, get status'),
			call('gateway-to-orders', 'gateway-part', 'orders-part', 'http', 'forwarded order requests'),
			call('gateway-to-cache', 'gateway-part', 'cache', 'other', 'session and rate count'),
			call('orders-to-db', 'orders-part', 'orders-db', 'sql', 'order and outbox rows'),
			event('order-placed', 'orders-part', 'payments-part', 'order.placed'),
			call('payments-to-provider', 'payments-part', 'payment-provider', 'https', 'charge the card'),
			event('settled-to-inventory', 'payments-part', 'inventory-part', 'payment.settled'),
			event('settled-to-orders', 'payments-part', 'orders-part', 'payment.settled'),
			event('failed-to-notifier', 'payments-part', 'notifier-part', 'payment.failed'),
			call('inventory-to-db', 'inventory-part', 'inventory-db', 'sql', 'reserve stock'),
			event('reserved-to-notifier', 'inventory-part', 'notifier-part', 'stock.reserved'),
			event('reserved-to-orders', 'inventory-part', 'orders-part', 'stock.reserved'),
			call('notifier-to-mail', 'notifier-part', 'mail-provider', 'https', 'send email'),
		],
		gaps: [
			{ id: 'dead-letter-reader', on: 'bus', text: 'no reader of payments.dead-letter in the repository' },
			{ id: 'db-address', on: 'orders-db', text: 'production address: kept in a secret, not in the repository' },
			{ id: 'accounts-how', on: 'cache', text: 'how accounts writes sessions: not in the repository' },
		],
	},
}
