// The one thing the model may keep about the reader: a plain sentence on how they want things shown, or on what they
// already know. It goes to the reader's own notes, never to the project record, and the reader sees it and can remove it.
import type { Tool } from 'aigent/plugin'
import type { ReaderNotes } from '../../map/index.ts'
import type { Round } from '../reply/show-tool.ts'
import { readArgs, refuse, reply } from './tool-edge.ts'

export function rememberTool(notes: ReaderNotes, round: () => Round): Tool {
	return {
		name: 'remember',
		description:
			'Keep a note about this reader for every later reply, when they tell you how they want things shown or what they already know.',
		parameters: {
			type: 'object',
			properties: {
				note: {
					type: 'string',
					description:
						'One plain sentence about how this reader wants things shown, or what they already know, when they tell you. ken shows it to the reader, who can remove it. Do not keep what the reader asked about, only how they want to be answered.',
				},
			},
			required: ['note'],
			additionalProperties: false,
		},
		async execute(args) {
			if (!round().typed) return refuse('ken keeps a note only when the reader asks in their own words.')
			const kept = await notes.add(readArgs(args, 'remember').text('note'), new Date())
			if (kept.kind === 'refused') return refuse(kept.problem)
			return reply(
				['ken now keeps these notes about the reader:', ...kept.notes.map(({ text }) => `- ${text}`)].join('\n'),
			)
		},
	}
}
