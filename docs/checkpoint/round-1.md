This is the verdict of round 1 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests.
It was run on 15 November 2026, with ken at commit 379abfe and the glm-5.3 model; the plain chat ran on Claude Opus.
The text below is the judge's, unchanged. The prose check asked for no edits.

# Verdict: ken against a plain chat, on pull requests #104, #102 and #106

## Short answer

No. ken does not meet its plan's rule.

- ken wins criterion B (trust from quotes) on all three pull requests.
- ken wins criterion C (find it tomorrow) on all three.
- ken loses criterion A (finds a decision or risk the other did not) on all three. The plain chat surfaced 4, 6 and 5 true risks or decisions that ken did not. ken surfaced 0, 2 and 0 that the plain chat did not.

The rule says "lose on none". ken loses one.

## What I did

- Read all six answer files in full.
- Read each merge's diff (`git diff M^1 M`) and every commit message in its range. Merges: #104 = 3586115, #102 = 03c113f, #106 = 47eec4e.
- Wrote my own list for each pull request before scoring.
- Checked at least nine claims per answer by hand, including every stated reason and every stated risk.
- Compared 12 of ken's quotes with the file at the named commit. All 12 match.
- Read code outside the diff where an answer made a claim about it (for example `src/core-tools.ts` at 3586115).

What I did not do: I did not open ken's stored record or its web page. Criterion C rests on what I was told and on the counts each ken file prints.

---

## Pull request #104 (deadline starts when the code starts)

### My yardstick

What it did:
- `runCode` no longer sets its deadline at the call. The worker posts `{ kind: 'started' }` right before it runs the code. The host then clears a boot timer, resets `deadline`, and arms the code's timeout.
- Boot has its own limit, `BOOT_LIMIT_MS = 10_000`. Past it, `runCode` rejects with an error.
- `settle` gets the reset deadline, so the 1 s grace also counts from the new start.
- Two commits: a failing test first (a09770e, 12 lines, test only), then the fix (782aa2d). Two older tests now time from the code's first tool call.

Decisions:
1. The worker reports the start. The clock runs from when the host handles that message.
2. Boot gets a separate, fixed 10 s limit. Passing it is an error, not a "timed out" outcome.
3. Abort still ends a run during boot.
4. Test first.

Risks:
1. Tool calls made by the code still use the old clock. `src/core-tools.ts:105` builds `AbortSignal.timeout(host.timeoutMs)` at the call. The diff did not touch it. Tool calls can be aborted before the run's own deadline.
2. The host arms the timer when it handles `started`. A busy host gives the code extra time. The new test depends on this.
3. A run can now last boot time plus `codeTimeoutMs`, with boot up to 10 s.
4. A new failure path: boot past 10 s rejects, and the engine turns that into a `Tool ... failed` error result.
5. The new test depends on timing.
6. The first run's WASM compile is now outside both timers. Before, the deadline was set before `await compiled`. Small.

### Accuracy

Plain. Checked 11 claims: the cause, the 92 to 190 ms figure, the `started` message, the timer swap, the `settle` change, the 10 s reject and its text, abort during boot, test-first, and all five risks.
- False: none.
- Loose: "The abort listener is set up before the worker starts." The run message is posted one line before the listener is added, in the same tick. The behavior it describes is right.
- The claim about `src/core-tools.ts:105` is true. The line is exactly as quoted.

ken. Checked 10 claims: the diagram order, the summary's reason, all four decisions, all three statements, and the git facts.
- False: none.
- Not shown by its quote: diagram step 10 says "redacted and capped". The quoted line shows `host.redact` only.
- Decision 2 says the engine records the rejection as an error result. True. The quote shows the engine's `catch`, not the path from `runCode` to it.
- "Change facts from git" dates the merge 2026-11-09. `git log` shows 2026-11-10 00:28 +0100. Probably UTC. It will confuse a reader who checks.
- Statement 3 ends "the run's wall time reaches boot plus timeoutMs only when the host is free". I had to read it three times.

### Completeness

- Plain missed: yardstick risk 6 only.
- ken missed: risk 1 (tool-call clock), risk 3 (total duration), risk 5 (test timing). It noted that `runBash` still counts from the call, but only in the unchecked closing note.

### Criterion A

- ken surfaced, plain did not: nothing.
- Plain surfaced, ken did not: the tool-call clock mismatch; the longer worst-case run; the timing-dependent test; the two code tools now measuring time differently.
- Result: plain.

### Criterion B

- Plain cites the merge, one commit hash, four files, one file and line, and one exact code expression. That is good for a chat answer. The other claims have no anchor. The owner must open the code to confirm them.
- ken: every diagram step, decision and statement has file, commit, line and code. Of seven elements I judged, four are shown by their quotes (steps 6 and 8, decision 3, statement 1). Three are partly shown (step 10, decision 2, statement 3).
- Statement 1 quotes one 2,000-character line of the design doc. The sentence that matters is inside it. The reader has to hunt.
- Result: ken, by a small margin. The plain answer's main risk is the one claim it anchored to a line.

### Diagram

A sequence diagram with seven messages. It is true to the code and in the right order: post `run`, arm the boot limit, `started`, reset and arm, result, resolve. It shows the whole change in one picture. It leaves out the abort and timeout branches. It helps.

### Readability and cost

- Plain: 3.9 KB. Sections for the fix, how it works, decisions, risks. Faster to read.
- ken: 15 KB as text. The risks sit in three statements at the end.
- Time: plain about 60 s. ken 167 s, 398,190 tokens in, 36,793 out, one answer sent back by the quote check.

---

## Pull request #102 (bounds on state, records, results, reasons, capture)

### My yardstick

What it did, one commit each:
1. `state.update` writes nothing when the new value serializes the same (3e93e00). The eval's `respects` check now also reads state from before the step.
2. `take()` hands on only each plugin's last state record (6967197).
3. The record log keeps only untaken records (db71be1).
4. New option `maxToolResultChars`, default 50000, applied in `execute` after redaction, across text blocks, with a truncation note. Thrown errors too. Helpers inherit it (49df57b).
5. Gate denial reasons cut at 1000 characters after redaction (391e7bc).
6. `session__inspect calls` shows the newest 50 by default (96625cd).
7. Captured history kept to the newest messages within 131072 characters, with an omitted count. Image data replaced by type and size (42d79fa).

Decisions: cut after redaction; caps on by default; always say what was cut; compare state by `JSON.stringify`; collapse state per take, not per call; the transcript is the only full copy; keep the newest history and valid JSON; numbers come from measurements.

Risks:
1. Default behavior change. Results over 50000 characters are cut. There is no "unlimited" value.
2. The transcript no longer holds every state change.
3. The `respects` check is looser. An earlier step's state can now satisfy it.
4. `JSON.stringify` equality depends on key order.
5. `slice` counts UTF-16 units. The note lands after any images.
6. The history cap is soft: the newest message is always kept. The code still redacts and serializes the whole history on each request.
7. The by-kind indexes (`calls`, `denials`, `usage`) still grow for the session's life.
8. Images are not capped at all.
9. Commit 6967197 weakened an existing assertion from `[1, 2]` to "the last value is 2". A new test forces GC and checks `WeakRef`s, which can be flaky.

### Accuracy

Plain. Checked 17 claims: all seven commit mappings, each "why", and all seven risks.
- Wrong: risk 3 says `checks.ts` "was changed again in later PRs (#105–#107)". It was changed in #103 and #106. #105 and #107 did not touch it.
- Loose: "In their test, heap growth went from 9.2 MB to 2.2 MB." The figures are from the commit message. The test in the repo checks that records are collected, not heap size.
- Unsupported: "not by deep comparison or by asking plugins to behave". Neither alternative appears in the diff or the history.
- Opinion: "Overall it's a careful change."
- True and checked outside the diff: the 16 KiB state cap (`STATE_CAP = 16 * 1024`), and "the only reader is `takeRecords()` in `src/pi.ts`".

ken. Checked 13 claims: the summary, all seven decisions, all three statements, diagram steps 7 and 11.
- Reworded reason: decision 5 says the default limit exists because "an unbounded list could blow past the result cap". The commit says the answer "grew with the session". The cap explains the number 50, not the limit.
- Decision 1 lists "cut the result's text before redacting it" as rejected. The history does not show it was considered. The design doc does give the reason for the order.
- Diagram step 11, "is a catalog plugin, so its output is capped like any result", is a deduction. The quotes show the plugin is in the catalog. They do not show the cap path.
- The diagram puts "Record log" outside the "engine" box. The engine owns it.
- False: none found.

### Completeness

- Plain missed: risks 7, 8 (it states images pass through, but not as a risk) and 9.
- ken missed: risks 1 (present only in the unchecked summary), 2, 3 (it states the fact, not the risk), 4, 5, 6 and 9. It also does not say that thrown errors are capped or that there is no unlimited value.

### Criterion A

- ken surfaced, plain did not: the by-kind indexes still grow, so memory is not fully bounded; images pass the cap, named as a risk. Both true. The first matters for a pull request whose title says "bound".
- Plain surfaced, ken did not: the default cut with no way to turn it off; state history gone from the transcript; the looser `respects` check that "could hide a real miss"; key-order sensitivity; UTF-16 cuts and the token estimate; the soft telemetry cap and its remaining per-request cost.
- Result: plain, 6 to 2.

### Criterion B

- Plain cites all seven commit hashes, the file and function for each, and the constants. No lines, no quoted code beyond short fragments. Its risks rest on reasoning the owner cannot check in place.
- ken: of seven elements I judged, four are shown by their quotes (decisions 1 and 3, statements 2 and 3). Three are partly shown (decision 5's reason, steps 7 and 11).
- Two quotes are single 2,000 to 3,000-character doc lines.
- Coverage: quotes touch 11 of 56 changed hunks. ken says so. That is honest. It also means the owner has seen a fifth of the change.
- The most important risk for a host (results over 50000 characters now arrive cut) is only in the summary, which nothing checked.
- Result: ken.

### Diagram

A component diagram of six places that got a bound. The nodes are right. The edges mix data flow with prose ("is a catalog plugin, so its output is capped like any result"). It gives a map of where the bounds are. It does not show the state changes, which are three of the seven commits. Half useful, half decoration.

### Readability and cost

- Plain: 8.9 KB. Seven numbered changes, each with commit, file and reason. Then decisions. Then risks. Faster to read.
- ken: 27 KB as text. Seven decisions in question form are clear. Four of the seven say "Rejected: none shown by the code or history".
- Time: plain about 60 s. ken 300 s, 1,567,568 tokens in, 68,058 out, one answer sent back.

---

## Pull request #106 (eval scores you can trust)

### My yardstick

What it did:
1. Grader: a `<kind>_judged` bool per check kind, and a score per step for a kind asked at several steps. Per-step names are declared from the shipped scenarios. `respects` is now judged on prompts that ended `error` or `aborted` (159ea1b).
2. Suite version hashes every file in the plugin directories a scenario names. Grader version follows the grader's relative runtime imports by regex. A load-hook test checks the list (5c659ad).
3. `--temperature` and `--seed`, a `sampling` field on the openai-compatible model spec, and `sampling` in `run.json` with `null` for unset (024b9ff).
4. Leak mark carries a per-run 16-hex nonce, stored as `leakNonce` (3d7007e).
5. Authored scenarios that can only pass or skip are refused. Recorded ones still read (39fb898).
6. A test that the multeval pin and its lock name the same commit. A README note on `git+ssh://` (0b26023).
7. Doc sample key fixed (2e95efd).

Decisions: keep "a skip is not a failure" and add a judged metric beside it; declare per-step names from shipped scenarios; only `respects` runs on errored prompts; follow imports, keep no list; refuse vacuous scenarios only when authored; old runs stay readable and the format is not bumped; nonce added after the scrub; sampling only on openai-compatible specs; leave the SSH pins to the owner.

Risks:
1. Suite and grader versions all moved on merge. Old and new results do not compare.
2. Regrading an old run can turn `respects` from skip to fail.
3. The metric set changed. Dashboards and `--fail-under` rules may need a look.
4. A run whose scenario is not shipped can emit a `follow@N` that `grader.describe` never declared.
5. The import scan is a regex. Dynamic or non-relative imports are not hashed.
6. A seed is recorded even when the server ignores it. The default endpoint is Ollama Cloud.
7. Stricter parsing can reject scenarios kept outside the repo.
8. Old runs keep the forgeable mark.
9. Installing multeval needs an SSH key.
10. `run.json` gains two fields but stays `aigent-run/1`. The pre-#106 reader rejects unknown fields, so an older checkout cannot read a new run.

### Accuracy

Plain. Checked 27 claims: all seven items, all nine decisions, all eight risks, and the counts (seven commits, about 500 lines, 36 scenarios).
- False: none found.
- Each inferred risk holds against the code. Example: risk 4 above follows from `scoresOf` reading the run's own behaviors while `describe` reads `test/scenarios`.

ken. Checked 12 claims: the summary, decisions 1, 3, 4, 7, 8 and 9, all three statements, diagram steps 13 and 16.
- Wrong target: diagram step 16 says the grader "reads a recorded run with readRun" and points at the node "runScenario". `readRun` is another function in the same file. The quote is an import line.
- Decision 7's reason cites the design doc ("a faux reply of `[LEAKED:WEATHER_API_KEY]`..."). True. No quote backs it.
- False: none found.

### Completeness

- Plain missed: risk 10 only.
- ken missed: risks 1, 3, 4, 7 and 10. It missed three decisions: sampling only on openai-compatible specs, the format not bumped, and the SSH pins left alone on purpose. It quotes the README line about SSH but does not name it as a risk.

### Criterion A

- ken surfaced, plain did not: nothing that matters. (Small details only: the lock test also compares package names; the hash includes each file's path.)
- Plain surfaced, ken did not: versions moved so old and new results do not mix; the metric set changed; an undeclared per-step metric is possible; outside scenarios may now fail to parse; three decisions about what was left alone.
- Result: plain.

### Criterion B

- Plain names files and functions for each item. It cites no commit hash per item and no lines. Its eight risks are reasoning with no anchor.
- ken: of six elements I judged, five are shown by their quotes (decisions 3, 7 and 8, statements 2 and 3). One is not (step 16).
- Coverage: 15 of 114 changed hunks. 13 percent. ken prints this.
- The sentence about the last commit (the doc sample key) is only in the unchecked summary.
- Result: ken, with the coverage caveat.

### Diagram

A component diagram of eight parts and their calls. It is accurate except step 16. It tells a reader who does not know the eval harness how the CLI, runner, checks and the four multeval programs connect. It does not show what the pull request changed: only two edge labels mention a change. Useful as a map. Not an explanation of the change.

### Readability and cost

- Plain: 6.9 KB. What it did, why, risks. Faster to read.
- ken: 29 KB as text. Seven of nine decisions say "Rejected: none shown by the code or history".
- Time: plain about 60 s. ken 241 s, 1,836,188 tokens in, 53,461 out, one answer sent back.

---

## Criterion C: what each side leaves for tomorrow

Plain chat: one chat message. Nothing in the repository. Nothing tied to the merge commit. To find it the owner scrolls chat history. Asking again costs another minute and can give a different answer.

ken: each file ends with what it stored in the project record.
- #104: 1 work, 4 decisions, 1 topic, 1 note.
- #102: 1 work, 7 decisions, 3 topics, 3 notes.
- #106: 1 work, 9 decisions, 4 topics, 4 notes.

I was told the answer also goes to a personal history and reopens without a model. Every quote is pinned to a file and a commit, so it stays true to that commit.

ken wins C on all three. Two cautions:
- The files show counts, not the stored text. I could not see what a "note" holds. #104 has three statements and one note.
- Every stored decision is labelled "inferred". That includes "Rejected" alternatives the history does not show and "Undo: easy" ratings with no evidence. An unchecked guess in a durable record is worse than one in a chat.

---

## Table

| Pull request | A: finds what the other missed | B: trust from quotes | C: find it tomorrow | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 | plain. 4 unique risks to 0. | ken, narrow. Plain anchored its main risk to a line. | ken. Stored record. | tie. No false claim in either. | plain. ken missed the tool-call clock. | plain. A quarter the length. ken's diagram is good. | plain. 60 s to 167 s. |
| #102 | plain. 6 unique to 2. | ken. Quotes under each decision; 11 of 56 hunks. | ken. Stored record. | tie. One small slip each. | plain. ken missed 6 risks. | plain. Risks in one list. | plain. 60 s to 300 s, 1.6 M tokens. |
| #106 | plain. 5 unique to 0. | ken, with caveat. 15 of 114 hunks. | ken. Stored record. | tie. plain none found; ken one mislabelled edge. | plain. ken missed 5 risks and 3 decisions. | plain. | plain. 60 s to 241 s, 1.8 M tokens. |

Token counts for the plain chat were not given, so tokens are not compared. Time is.

## Verdict against the plan's rule

Does ken win on at least one criterion and lose on none? **No.**

- Wins: B and C, on all three pull requests.
- Loses: A, on all three.
- Clearest win: C. It is structural. The plain chat leaves nothing behind.
- Closest to a loss: A is not close. It is a loss. Of the two wins, B is the weaker. On #106 the quotes cover 13 percent of the hunks, and the risks the owner most needs are the ones ken did not state.

One thing in ken's favor that the rule does not count: on a weaker model it made no false claim that I could find in 35 checked claims. One thing against it that the rule does not count: it took 3 to 5 times as long.

## The model confound (my inference, not a finding)

ken ran on glm-5.3. The plain chat ran on Claude Opus.

Differences I believe come from the tool's structure:
- Quotes with file, commit and line under each claim. The plain chat would not do this on any model unless asked.
- The stored record and the coverage count.
- The "Rejected: none shown by the code or history" lines. The plain chat invented alternatives once (#102, "not by deep comparison"). ken's form stopped that 14 times out of 20 decisions.
- Exactly three statements in all three answers, for a 40-line change and a 500-line change alike. That looks like a limit or a strong nudge in the tool, not a model trait. The risks live in those statements, so the form caps the risks.
- The longer run time. Each answer was sent back once by the quote check.
- A pull toward claims that a line can prove. A risk such as "old and new results do not mix" has no single line to quote. The form makes such risks harder to state.

Differences I believe come from the model:
- How far the answer reasons past the diff. The plain chat's best finds needed that: the unchanged line in `core-tools.ts`, the undeclared `follow@N` metric, the key-order case.
- Phrasing. ken's statement 3 on #104 is hard to read.

What I would expect with both on the same strong model: the gap on A shrinks, and may close on small changes. It does not flip unless the three-statement shape goes, because the plain chat listed 5 to 8 risks per answer. B and C stay with ken. ken stays slower. With both on glm-5.3, I would expect the plain chat to make more unsupported claims and ken's quote check to earn more of its keep. This comparison cannot show either.

## The three most important weaknesses of ken, in order

1. **It finds fewer risks, and none outside what it quoted.** On #104 it missed that tool calls still use the old clock (`src/core-tools.ts:105`), which the plain chat called "the mismatch I'd fix next". On #106 it missed that every suite and grader version moved on merge. All three answers have exactly three statements.

2. **A quote that exists is not a quote that proves, and key content sits where nothing is checked.** #106 step 16 points at "runScenario" and quotes an import of `readRun`. #102 decision 5 gives a reason the commit does not give. #102's main risk for a host, "text past a cap reaches the model only in part", is only in the unchecked summary. #104's note on `runBash` is only in the unchecked closing note. Two answers quote single doc lines of 2,000 characters or more as evidence.

3. **It costs 3 to 5 times the time and reads at 3 to 4 times the length, for less content.** #102: 300 s and 27 KB against 60 s and 9 KB. 14 of 20 decisions carry a "Rejected: none shown" line. "Undo" and "Needs the owner's opinion" are stated with no reason.

## The three things the plain chat did better

1. **It reasoned across code the diff did not touch.** #104: it found `AbortSignal.timeout(host.timeoutMs)` at `src/core-tools.ts:105` and explained that tool calls can abort before the run's own deadline. I checked the line. It is exact.

2. **It gave risks their own list, each with a consequence and often an action.** #106: "Every grader and suite version changed on merge... don't mix them in one report." #102: "There is no 'unlimited' value: it must be a positive integer, so use a very large one."

3. **It tied the change to its commits and named what was left alone, in one short pass.** #102 lists all seven commits with hash, file, function and reason. #106 names three choices not to act: the SSH pins "left alone", the format "isn't bumped", `sampling` only on openai-compatible specs. ken named none of the three.

## What I would change in ken first

Make risk a required, separate section with no fixed count, and make the tool look past the diff to find them.

- For each changed function, constant or option, read its callers and any other code that uses the same value. The #104 miss was one unchanged line that used the same `timeoutMs`.
- Ask three questions for every pull request and require a statement or an explicit "none found" for each: what changes for existing users or stored data; what still grows, drifts or disagrees after the change; what old thing now behaves differently.
- Allow a risk with no single proving line, labelled as reasoning, with the quotes it starts from.

Then, second: check the summary against the statements, and reject a summary sentence that no statement backs. Third: limit a quote to the lines that carry the claim.
