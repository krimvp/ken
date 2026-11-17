// The rule that decides what the reader reads. A turn that called any tool other than show was working: its text,
// such as "Let me read the diff", is a step. A turn that only wrote, or wrote and called show, is the reply: its words,
// then the cards it showed. A card that passed is always part of the reply.
import type { TurnSnapshot } from 'aigent/plugin'
import type { ChatEvent } from '../chat-event.ts'
import type { Card } from './reply.ts'

export function fileTurn(turn: Pick<TurnSnapshot, 'text' | 'calls'>, cards: Card[]): ChatEvent[] {
	const working = turn.calls.some(({ call }) => call.tool !== 'show')
	const text = turn.text.trim()
	const said: ChatEvent[] =
		text === ''
			? []
			: working
				? [{ kind: 'step', step: { kind: 'text', text } }]
				: [{ kind: 'item', item: { kind: 'words', text } }]
	return [...said, ...cards.map((card): ChatEvent => ({ kind: 'item', item: { kind: 'card', card } }))]
}
