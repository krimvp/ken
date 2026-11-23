// The rule that decides what the reader reads. A turn that called any tool other than show was working: its text,
// such as "Let me read the diff", is a step. A turn that only wrote, or wrote and called show, is the reply: its words,
// then the cards and walkthrough steps it showed. A card that passed is always part of the reply.
import type { TurnSnapshot } from 'aigent/plugin'
import type { ChatEvent } from '../chat-event.ts'
import type { Item } from './reply.ts'

// A model sometimes prints tool requests as its entire reply. Recognize their envelopes only; their arguments never run.
export function onlyToolRequests(question: string, text: string): boolean {
	if (text.length > 8192) return false
	const content = text.trim()
	const bodies =
		content.startsWith('{') && content.endsWith('}')
			? [content]
			: /^```(?:json)?[ \t]*\r?\n([\s\S]+)\r?\n```$/i.exec(content)?.[1]?.split(/\r?\n```\s*```(?:json)?[ \t]*\r?\n/i)
	if (!bodies) return false
	// A reader can explicitly request this exact representation as an example.
	const format =
		/\b(?:show|give|print|write|return|output|display|provide|generate)\s+(?:(?:me|the|a|an|examples?|samples?|of|raw|valid|exact|full)\s+)*(?:json\b|payload\b|tool (?:calls?|requests?|proposals?)\b|(?:ken|core)__)|\b(?:as|in) (?:a )?json\b|\b(?:tool (?:call|request)|payload) (?:look|looks) like\b/i
	if (format.test(question)) return false
	return bodies.every(toolEnvelope)
}

function toolEnvelope(body: string): boolean {
	try {
		const data = JSON.parse(body)
		return Boolean(
			data &&
				typeof data.name === 'string' &&
				/^(?:ken|core)__\w+$/.test(data.name) &&
				data.arguments &&
				typeof data.arguments === 'object' &&
				!Array.isArray(data.arguments) &&
				Object.keys(data).length === 2,
		)
	} catch {
		return false
	}
}

export function fileTurn(turn: Pick<TurnSnapshot, 'text' | 'calls'>, shown: Item[]): ChatEvent[] {
	const working = turn.calls.some(({ call }) => call.tool !== 'show')
	const text = turn.text.trim()
	const said: ChatEvent[] =
		text === ''
			? []
			: working
				? [{ kind: 'step', step: { kind: 'text', text } }]
				: [{ kind: 'item', item: { kind: 'words', text } }]
	return [...said, ...inReadingOrder(shown).map((item): ChatEvent => ({ kind: 'item', item }))]
}

// The show calls of one turn run at the same time, so the cards of two steps, or of two briefs, pass in any order. A
// reader reads a step and then its cards, and the steps by number. The items that carry a number are put in that
// order, in the places they took, and an item with no number stays where it was.
function inReadingOrder(shown: Item[]): Item[] {
	const numberOf = (item: Item) => (item.kind === 'step' ? item.number : item.kind === 'card' ? item.step : undefined)
	const numbered = shown
		.filter((item) => numberOf(item) !== undefined)
		.map((item, arrived) => ({ item, arrived }))
		.toSorted(
			(a, b) =>
				(numberOf(a.item) ?? 0) - (numberOf(b.item) ?? 0) ||
				Number(b.item.kind === 'step') - Number(a.item.kind === 'step') ||
				a.arrived - b.arrived,
		)
	let next = 0
	return shown.map((item) => (numberOf(item) === undefined ? item : (numbered[next++]?.item ?? item)))
}
