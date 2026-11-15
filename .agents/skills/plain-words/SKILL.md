---
name: plain-words
description: Plain language for every text a person reads. Use when writing or reviewing a reply, doc, commit message, comment, name, UI text, error message, or a prompt that shapes ken's answers.
---

# Plain words

Write so that a tired developer understands on the first read.

George Orwell gave six rules for this in "Politics and the English Language" (1946). ken follows them, restated here:

1. Use no figure of speech that you have seen in print. Say the literal thing.
2. Use the short word where it does the job of the long one.
3. If a word can go, cut it.
4. Use the active voice. Name who does what.
5. Use the everyday word in place of jargon, a foreign phrase, or a scientific term.
6. Break any of these rules before you write something ugly or unclear.

## What the rules mean in ken

- **Answer first.** Lead with the result or the decision. Reasons follow. Stop when the point is made.
- **One idea per sentence.** Split a sentence that the reader must read twice.
- **Whole sentences.** Keep the articles and the verbs. Spell out arrows and abbreviations. A short text is what remains after you cut the words that do no work. Shortness is never the goal, and a reader who must decode has been cheated.
- **Concrete over abstract.** Name the file, the command, the number. "An answer with a bad quote is rejected" beats "validation protects integrity".
- **One name per thing.** `docs/plan.md` names the things ken deals in: project record, understanding map, lens, piece of work, decision, topic, note, card, label. Use the same word in code, UI text, and docs. Pick one word and repeat it.
- **Names are prose too.** A function, file, or variable follows the same rules: `checkQuote`, `readFileAt`. Words such as `Manager`, `Handler`, `Helper`, `Util`, `Service`, and `Processor` say nothing about the job. Name the job.
- **No machine voice.** No praise, no "let me", no recap of what you just said, no closing offer. No emoji in docs, code, or UI text.
- **Start at the reader's level, then offer depth.** A few sentences from the top, detail on request. ken answers its own reader this way, so its prompts and UI text follow the same rule.

## Check your text

`npm run check:prose` fails on the em dash, curly quotes, and a list of words that mark machine-written text. The list is in `scripts/check/prose.ts`. When you catch a new offender, add it there with its plain replacement.

The check finds words. It cannot find a dense sentence or a figure of speech. For those, run the `unslop` skill over the text. It holds the full pattern list. For docs, READMEs, and commit messages, the `technical-writing` skill adds structure rules.

## Example

Before:

> This change introduces a robust validation layer that leverages git to seamlessly ensure quote integrity across the codebase.

After:

> The quote checker now reads each quoted line from git at the cited commit. It rejects an answer that quotes a line that is not there.
