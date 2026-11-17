import assert from 'node:assert/strict'
import type { Card, ChatEvent, Reply } from '../../src/agent/index.ts'

// The reply a question ended with, as ken saves it.
export function replyIn(
	events: ChatEvent[],
): Reply & { recorded: Extract<ChatEvent, { kind: 'replied' }>['recorded'] } {
	const replied = events.find((event) => event.kind === 'replied')
	assert.ok(replied?.kind === 'replied', `the question has a reply: ${JSON.stringify(events.map((e) => e.kind))}`)
	return { ...replied.reply, recorded: replied.recorded }
}

export function cardsIn(events: ChatEvent[]): Card[] {
	return replyIn(events).items.flatMap((item) => (item.kind === 'card' ? [item.card] : []))
}

// What ken sent back, by the name it gave each card.
export function sentBackIn(events: ChatEvent[]): { what: string; problems: string[] }[] {
	return events.flatMap((event) => (event.kind === 'step' && event.step.kind === 'sent-back' ? [event.step] : []))
}
