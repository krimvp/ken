// The second step of a question about a change. In the first the model explored and wrote a free draft, as in a plain
// chat, with no answer form in mind: the checkpoint's judges found that a model which works inside the form from its
// first turn lists entries and misses the risks that come from use. This message asks the same session to turn that
// draft into the checked answer, and to name the points it found no line for, so the reader sees how many fell out.
import { MAX_STORY_CHARS, WEIGHT_RULE } from './answer-tool.ts'

export const FROM_DRAFT = [
	'Now turn your draft into the answer and send it with the answer tool. The rules for the answer in the system prompt apply, and these come first:',
	'- Carry over every decision and every risk of the draft, each as its own entry with the lines it rests on. Read again any lines you need to quote.',
	'- A point of the draft that no line you can quote supports stays out of the answer. Name each such point in left_out, in a few words. Send left_out as an empty list when every point has its lines.',
	`- The summary is the draft's story, for a tired owner, in three to five plain sentences of at most ${MAX_STORY_CHARS} characters in all: what was wrong or missing before, what the change does, and the one thing to watch.`,
	`- Give each risk its weight: ${WEIGHT_RULE}.`,
].join('\n')
