---
name: ui-review
description: Check a screen the way its user meets it. Use after any change to ken's page (the chat and its cards) or the public site, before calling the change done.
---

# UI review

The person who built a screen cannot see it fresh. This review puts the screen in front of someone who can.

## Steps

1. **Run the real thing.** Start the server or open the built site. Use real content: an answer about a real repository, a long file path, a quote of thirty lines, a long answer still streaming. Reach each state the change touches: empty, loading, error, full.
2. **Take screenshots with Playwright** at 1440 by 900 and at 390 by 844, in the light and the dark theme if both exist. Save them outside the repository.
3. **Ask a fresh reviewer.** Spawn a subagent that did not write the code. Give it the screenshots and one sentence about who the user is. Do not give it the code or your intent. Ask:
   - What is this screen for? Answer from the screenshot alone.
   - What would you do first?
   - What is the most important thing here, and is it the most prominent?
   - What did you have to read twice?
   - What could be removed without loss?
4. **Check the list below yourself**, in the running page, with the keyboard as well as the mouse.
5. **Fix and repeat** from step 2 until the reviewer states the purpose correctly, finds the first action without help, and names nothing it had to read twice.

## The list

- **One purpose per view.** One primary action, visibly the primary one.
- **Room to read.** Group related things and separate the groups with space. If two things compete for attention, one of them is in the wrong place or should not be there.
- **Order follows the question.** The answer comes first, the evidence beside it, the detail behind a click.
- **Labels say what happens.** A button names its action. Text passes `plain-words`.
- **Every state is designed:** empty, loading, streaming, error, very long content.
- **Keyboard works.** Tab order follows the reading order, focus is visible, Enter sends, Escape closes.
- **Readable.** Body text contrast of at least 4.5 to 1, text of at least 14 pixels, lines of at most about 80 characters.
- **Narrow screen.** At 390 pixels wide nothing scrolls sideways and nothing overlaps.
- **Quoted code stays code.** Monospace, original indentation, file and lines shown, never wrapped in a way that changes its meaning.

## Report

Say which states you saw, at which sizes, what the reviewer answered, and what you changed. Attach the final screenshots.
