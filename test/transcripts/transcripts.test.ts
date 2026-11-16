import assert from 'node:assert/strict'
import { utimesSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { claudeCodeTranscripts, readSession, searchSessions } from '../../src/transcripts/index.ts'
import { answered, asked, call, claudeProjects, result, writeSession } from '../fixtures/claude-sessions.ts'

const ROOT = '/home/dev/shop'
// Claude Code gives both folders the same slug, so their sessions share a folder.
const LOOKALIKE = '/home/dev-shop'

test('the sessions of this project are listed newest first, and those of another project are not, even in the same folder', async () => {
	const projects = claudeProjects()
	const older = writeSession(projects, ROOT, 'older', [
		{ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-03-01T09:59:00.000Z' },
		asked(ROOT, '2026-03-01T10:00:00.000Z', 'Why does the cart round down?'),
		answered(ROOT, '2026-03-01T10:05:00.000Z', [{ type: 'text', text: 'It uses floor.' }]),
	])
	const newer = writeSession(projects, ROOT, 'newer', [
		asked(path.join(ROOT, 'src'), '2026-03-02T08:00:00.000Z', 'Add a test for the cart.'),
	])
	writeSession(projects, ROOT, 'lookalike', [asked(LOOKALIKE, '2026-03-03T08:00:00.000Z', 'Another project.')])
	writeSession(projects, ROOT, 'no-folder', [{ type: 'summary', summary: 'A session with no working directory' }])
	writeSession(projects, '/home/dev/other', 'other', [asked('/home/dev/other', '2026-03-04T08:00:00.000Z', 'Hi')])
	// The session that started first was written to last, so newest first has to mean by start.
	utimesSync(newer, new Date('2026-03-02T09:00:00.000Z'), new Date('2026-03-02T09:00:00.000Z'))
	utimesSync(older, new Date('2026-03-05T00:00:00.000Z'), new Date('2026-03-05T00:00:00.000Z'))
	const transcripts = claudeCodeTranscripts(ROOT, { KEN_CLAUDE_PROJECTS: projects })

	assert.deepEqual(await transcripts.sessions(), {
		sessions: [
			{
				id: 'newer',
				started: '2026-03-02T08:00:00.000Z',
				ended: '2026-03-02T08:00:00.000Z',
				messages: 1,
				skipped: 0,
				partial: false,
			},
			{
				id: 'older',
				started: '2026-03-01T10:00:00.000Z',
				ended: '2026-03-01T10:05:00.000Z',
				messages: 2,
				skipped: 0,
				partial: false,
			},
		],
		older: 0,
	})
	assert.equal(await transcripts.session('lookalike'), null, "another project's session cannot be read by its id")
	assert.equal(await transcripts.session('../other'), null, 'an id cannot name a path')
})

test('a session reads in order: what the user asked, what the agent said, and each tool it called on which file or with which command, with its output cut', async () => {
	const projects = claudeProjects()
	const output = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')
	writeSession(projects, ROOT, 'one', [
		asked(ROOT, '2026-03-01T10:00:00.000Z', 'How long does a retry wait?'),
		answered(ROOT, '2026-03-01T10:00:05.000Z', [
			{ type: 'thinking', thinking: 'Look at retry.ts first.', signature: 'x' },
			{ type: 'text', text: 'I will read the retry code.' },
		]),
		answered(ROOT, '2026-03-01T10:00:06.000Z', [call('t1', 'Read', { file_path: `${ROOT}/src/retry.ts` })]),
		result(ROOT, '2026-03-01T10:00:07.000Z', 't1', output),
		answered(ROOT, '2026-03-01T10:00:08.000Z', [
			call('t2', 'Bash', { command: 'npm test -- retry\nnpm run lint', description: 'Run the tests' }),
			call('t3', 'Read', { file_path: '/home/dev/elsewhere/.env' }),
		]),
		result(ROOT, '2026-03-01T10:00:09.000Z', 't2', [{ type: 'text', text: 'ok 3 tests' }]),
		asked(ROOT, '2026-03-01T10:00:10.000Z', 'A note from another session', { isMeta: true }),
		asked(ROOT, '2026-03-01T10:00:11.000Z', '<task-notification>done</task-notification>', {
			origin: { kind: 'task-notification' },
		}),
		asked(ROOT, '2026-03-01T10:01:00.000Z', [
			{ type: 'text', text: 'Make it 200 ms.\n<system-reminder>Be brief.</system-reminder>' },
		]),
		answered(ROOT, '2026-03-01T10:01:30.000Z', [{ type: 'text', text: 'It now waits 200 ms.\nThe test passes.' }]),
	])
	const transcripts = claudeCodeTranscripts(ROOT, { KEN_CLAUDE_PROJECTS: projects })
	const read = await readSession(transcripts, 'one')

	assert.deepEqual(read?.entries, [
		{ kind: 'user', message: 1, at: '2026-03-01T10:00:00.000Z', text: 'How long does a retry wait?', cut: 0 },
		{ kind: 'agent', message: 2, at: '2026-03-01T10:00:05.000Z', text: 'I will read the retry code.', cut: 0 },
		{
			kind: 'tool',
			at: '2026-03-01T10:00:06.000Z',
			name: 'Read',
			target: 'src/retry.ts',
			output: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
			more: 7,
		},
		{
			kind: 'tool',
			at: '2026-03-01T10:00:08.000Z',
			name: 'Bash',
			target: 'npm test -- retry',
			output: ['ok 3 tests'],
			more: 0,
		},
		{
			kind: 'tool',
			at: '2026-03-01T10:00:08.000Z',
			name: 'Read',
			target: 'a file outside the project',
			output: [],
			more: 0,
		},
		{ kind: 'user', message: 3, at: '2026-03-01T10:01:00.000Z', text: 'Make it 200 ms.', cut: 0 },
		{
			kind: 'agent',
			message: 4,
			at: '2026-03-01T10:01:30.000Z',
			text: 'It now waits 200 ms.\nThe test passes.',
			cut: 0,
		},
	])
	assert.deepEqual([read?.session.messages, read?.more], [4, 0])
})

test('a line that is not a JSON object, or a message with no content, is skipped and counted, and the lines around it still read', async () => {
	const projects = claudeProjects()
	writeSession(projects, ROOT, 'torn', [
		asked(ROOT, '2026-03-01T10:00:00.000Z', 'First question'),
		'{"type":"assistant","cwd":"/home/dev/shop","timestamp":"2026-03-01T10:00:01.000Z","message":{"content":[{"ty',
		'[1, 2, 3]',
		{ type: 'assistant', cwd: ROOT, timestamp: '2026-03-01T10:00:02.000Z', message: {} },
		answered(ROOT, '2026-03-01T10:00:03.000Z', [{ type: 'text', text: 'The answer' }]),
	])
	const transcripts = claudeCodeTranscripts(ROOT, { KEN_CLAUDE_PROJECTS: projects })
	const read = await readSession(transcripts, 'torn')

	assert.deepEqual(
		read?.entries.map((entry) => entry.kind !== 'tool' && entry.text),
		['First question', 'The answer'],
	)
	assert.deepEqual([read?.session.skipped, read?.session.messages], [3, 2])
})

test('the bounds hold on a large session: entries, message length, tool output, search hits and the bytes read', async () => {
	const projects = claudeProjects()
	const long = 'word '.repeat(4000)
	const lines = [
		asked(ROOT, '2026-03-01T10:00:00.000Z', long),
		answered(ROOT, '2026-03-01T10:00:01.000Z', [call('big', 'Bash', { command: 'seq 10000' })]),
		result(ROOT, '2026-03-01T10:00:02.000Z', 'big', Array.from({ length: 10000 }, (_, i) => `${i}`).join('\n')),
		...Array.from({ length: 1000 }, (_, i) =>
			answered(ROOT, '2026-03-01T11:00:00.000Z', [{ type: 'text', text: `Step ${i} of the plan` }]),
		),
	]
	writeSession(projects, ROOT, 'large', lines)
	// One line of 33 MB passes the most ken reads of a file. The message after it is never read.
	writeSession(projects, ROOT, 'huge', [
		asked(ROOT, '2026-03-01T10:00:00.000Z', 'Before the padding'),
		result(ROOT, '2026-03-01T10:00:01.000Z', 'none', 'x'.repeat(33 * 1024 * 1024)),
		answered(ROOT, '2026-03-01T10:00:02.000Z', [{ type: 'text', text: 'After the padding' }]),
	])
	const transcripts = claudeCodeTranscripts(ROOT, { KEN_CLAUDE_PROJECTS: projects })

	const read = await readSession(transcripts, 'large')
	assert.equal(read?.entries.length, 300)
	assert.equal(read?.more, 1002 - 300)
	const [question, tool] = read?.entries ?? []
	assert.deepEqual(question?.kind === 'user' && [question.text.length, question.cut], [2000, long.trim().length - 2000])
	assert.deepEqual(tool?.kind === 'tool' && [tool.output.length, tool.more], [5, 9995])

	const found = await searchSessions(transcripts, 'OF THE PLAN')
	assert.deepEqual([found.hits.length, found.more], [50, 950])
	assert.deepEqual(found.hits[0], {
		session: 'large',
		message: 2,
		kind: 'agent',
		at: '2026-03-01T11:00:00.000Z',
		line: 'Step 0 of the plan',
	})

	const huge = await transcripts.session('huge')
	assert.deepEqual(
		[huge?.session.partial, huge?.session.messages, huge?.session.skipped],
		[true, 1, 1],
		'ken stops at 32 MB: it reads the first message, counts the cut line, and never reaches the last',
	)
})
