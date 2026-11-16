This is the second verdict of round 3 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on the same five pull requests, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit 1024923.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat, five pull requests, Claude Opus on both sides

## Result in short

- ken wins criterion B (trust from quotes) and criterion C (found again tomorrow) on all five.
- ken loses criterion A (finds the other side missed) on #104, and with it on the three tuned pull requests together and on all five together.
- On the two pull requests ken was not tuned on, A is a tie, so ken passes the plan's rule there.
- Plan's rule, "win at least one, lose none": **#104, #102, #106: no. #103, #100: yes. All five: no.**
- Each pull request was answered once per side. One missed risk decides the result. Treat it as one sample, not a rate.

## How I checked

For each pull request I read the source diff of the merge (`git diff M^1 M`), the test and doc hunks that a claim rested on, every commit message, and the code around the claims (callers, other users of changed values). I checked both answers against my own list and against the code. I read the ten answer files and no other file in the two answer folders. I read no skill or playbook file, as instructed.

Merges: #100 `3a04823`, #102 `03c113f`, #103 `eee753c`, #104 `3586115`, #106 `47eec4e`.

## Table

| PR | A: unique finds | B: trust without the diff | C: found tomorrow | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 | **plain**. It found that tool calls made by the code still use the old clock. ken's one unique find is minor. | **ken**. Every claim has a quote that fits. One "recorded" reason is weak. | **ken**. Stored record. | tie. No false claim on either side. | **plain**. ken says it did not read `sandboxTool`. | **plain**. 3.9 KB against 12.6 KB. | tie. ken 106 s. |
| #102 | tie. About three moderate finds each. | **ken**. Quotes fit. | **ken** | tie. One small slip each. | tie. Each missed risks the other had. | **plain**. It tells what changed in order. | tie. ken 177 s, one answer sent back. |
| #106 | tie. One moderate find each. ken also has one false risk. | **ken**, but one false risk sits under a real quote. | **ken** | **plain**. ken's risk 8 is false. | tie | **plain**, close. | tie. ken 97 s. |
| #103 | **plain**, narrow. More edge cases, and a sharper account of the main risk. | **ken**. Quotes fit. One "recorded" reason is weak. | **ken** | tie. No false claim found. | **plain**, narrow. | **plain** | **plain**. ken 204 s, over the plain range, one answer sent back. |
| #100 | tie. One moderate find each. | **ken**. Quotes fit. Two quotes are whole paragraphs. | **ken** | **ken**. Plain's risk 5 is false. | tie | **plain** | tie. ken 80 s. |

## Verdict against the plan's rule

**#104, #102, #106 (the three ken was tuned on, with a weaker model): no.**
ken wins B and C. ken loses A. Plain's find on #104 is the most serious unique find in the whole comparison, and on #102 and #106 the unique finds balance. Taken together plain wins A, so the rule fails.

**#103, #100 (not tuned on): yes.**
ken wins B and C. A is a tie: plain is a little ahead on #103, the two are level on #100, and plain's extra "find" on #100 is false. Neither side clearly outweighs the other.

**All five: no.**
ken wins B and C. ken loses A, because of #104 and because plain has somewhat more moderate unique finds overall (about seven against about four).

- Clearest win: **C**, by how ken is built. I did not test the store. **B** is the win the files themselves show.
- Closest to a loss: **A**. It is lost on the tuned three and on all five. On the other two it is a tie that leans to plain.
- The tuned three do worse than the untuned two. So there is no sign that the tuning overfitted. There is also no sign that it helped risk finding with this model.

## Per pull request

### #104: start runCode's deadline when the code starts

**My list.** The worker posts `started` before it runs the code. `runCode` holds a 10 s boot timer, then swaps it for the real deadline when `started` arrives. Boot past 10 s rejects. Abort still ends a booting run. `settle` now waits from the new deadline. Two tests retimed, one new test, docs updated.
Real risks: (1) `sandboxTool` in `src/core-tools.ts` line 105 still builds `AbortSignal.timeout(host.timeoutMs)` at the call and passes it to every tool call the code makes. So tool calls still lose the boot time. In the pull request's own example (200 ms deadline, 92 to 190 ms boot) a tool call gets about 10 ms. The doc now says the deadline counts "from when its code starts, its tool calls included", which is not true for the tool calls. This line is unchanged on main today. (2) The deadline starts when the host reads `started`, so a busy host gives the code extra time. (3) Worst case is now 10 s plus the deadline, and a boot failure rejects where it used to time out. (4) The new test depends on message order. (5) `runBash` still counts from the call.

**Plain.** Checked by hand: deadline moved (true); 10 s limit rejects with that message (true); `settle` uses the new deadline (true); abort listener set before `started` (true); `core-tools.ts:105` signal (true, real, still on main); a boot rejection "reaches the engine as a thrown tool error" (true, `engine.ts` catches it and returns `Tool … failed`); test-first commit `a09770e` (true); `runBash` unchanged (true). False claims: none found. Missed: that the retimed tests no longer guard boot time.

**ken.** Checked by hand: decisions 1 to 5 (true); risk 1 (true, but left as "check that sandboxTool turns this rejection into a tool error"); risk 2 (true); risk 3 (true); risk 4 (true, minor); risk 5 (true); statement 2 (true). False claims: none found. Missed: risk (1) above. Its closing note says "I also didn't read sandboxTool in src/core-tools.ts". Its risk 1 quotes line 92 of that file. The line that matters is 13 lines lower.

**A.** ken only: retimed tests no longer catch a boot slowdown (minor). Plain only: tool calls still on the old clock (serious); the boot rejection path confirmed (useful). Plain wins.

**B.** Plain names files, one line number, both commits, and quotes the signal expression. An owner could trust it, and I found nothing false. ken: five elements judged. Decision 1's quotes show the claim. Arrow 4's quote shows the worker posts `started`; the "timer replaces boot timer" half is shown under decision 1, not here. Decision 3 is labelled "recorded", but the message line says only that the abort still works, not why. Risk 1's second quote shows the call site, not the handling. Risk 5's quote (line 160) shows bash uses a deadline, not where it starts; decision 5 has the right line. No important claim sits only in the summary. The important admission (did not read `sandboxTool`) sits only in the unchecked closing note.

**Diagram.** Three arrows: run, started, returned or threw. It is true to the code. It shows the one new message, which is the change. It helps a little. It does not show the tool-call path, which is where the open risk is.

**Readability.** Plain is faster. ken's statement 3 quotes one doc line of about 2,000 characters. Statement 1 repeats decision 1's quote word for word.

### #102: bound state records, the record log, tool results, deny reasons and captured content

**My list.** Seven bounds: unchanged state writes nothing (`JSON.stringify` compare); a take keeps each plugin's last state record; the log drops taken records; `maxToolResultChars` default 50000 applied in `execute` after redaction; deny reasons cut at 1000; `session__inspect calls` shows 50 by default; captured history capped at 131072 characters and image data left out. The eval's `respects` check now also reads earlier steps.
Real risks: default caps change behaviour and there is no "unlimited" value; the transcript loses intermediate states; the `respects` change can let an earlier step's state stand in; key order defeats the dedupe; `slice` can split a surrogate pair or the redaction marker; the history cap is soft and the whole history is still serialized on each request; images are not capped; a denial joins every gate's reason with no total cap; the GC test may be fragile.

**Plain.** Checked: items 1 to 7 against the diff (all true); "no unlimited value" (true); `respects` loosening (true as a mechanism); key order (true); note placed after images (true); history still redacted and serialized in full (true); `decodedBytes` is an estimate (true). Slip: it says `checks.ts` changed again in "#105 to #107". It changed in #103 and #106. Missed: no total cap on a joined denial; images uncapped named as a risk; the GC test.

**ken.** Checked: decisions 1 to 9 (true); risk 1 (true); risk 2 (images uncapped is true, but "the docs say this option caps every tool result" overstates: the docs and the option comment say "the text of every tool result"); risk 3 (true); risk 4 (true); risk 5 (true); risk 6 (true); risk 9 (true, the test expects `[REDACT`); statement 3 (true). Missed as risks: the 50000 default as a behaviour change with no way to switch it off; the `respects` loosening (it is a statement, with no consequence drawn); the full-history serialization that remains.

**A.** ken only: joined denial has no total cap; images bypass the cap; GC test fragility; the cut can split the redaction marker. Plain only: default cap with no unlimited value; `respects` loosening may hide a miss; history still serialized in full each request; no full record log for future features; characters are not tokens. No serious item on either side. Tie.

**B.** Plain names the commit and the function for each of the seven items. No line numbers, no quoted code. ken: five elements judged. Decision 2's message lines give the reason. Decision 5's comment line shows images pass. Risk 1's line shows the join. Risk 3's two quotes show one take per turn and an old test that expected two records. Risk 4's old line shows `blob` with content; "break" is an inference. All eight "recorded" labels rest on message lines that give a reason. ken wins.

**Diagram.** None in this answer.

**Readability.** Plain lists what changed, then decisions, then risks. ken has no account of what changed beyond one sentence; the reader builds it from nine questions.

### #106: judged counts, hashed fixtures, sampling, leak nonce, vacuous scenarios

**My list.** `<kind>_judged` and per-step metrics; `respects` judged on prompts that ended `error` or `aborted`; suite version hashes plugin directories; grader version follows relative imports; `--temperature` and `--seed` recorded as `sampling` with `null` for unset; a 16-hex nonce in the leak mark, added after the scrub; authored scenarios that can only pass or skip are refused, recorded ones are not; a pin test and doc fixes.
Real risks: every suite and grader version moves once; `respects` rates shift; per-step metrics are declared from shipped scenarios only; the import scan misses packages and dynamic imports; a seed is recorded even where the server ignores it; scenarios outside the repo may now fail; old runs keep the forgeable mark; `respects` can now throw during grading of an errored prompt.

**Plain.** Checked: `_judged` meaning (true); `follow` at steps 3 and 4 of `core-long-session` (true); load-hook test (true); `sampling` only on `openai-compatible` because of pi 1.3.0 (true, the design doc says so); nonce added after scrub (true); format stays `aigent-run/1` (true); default endpoint is Ollama Cloud and the doc names only vLLM and llama.cpp for seeds (true); 36 scenarios (true). False claims: none found. Missed: grading can throw on an errored prompt.

**ken.** Checked: decisions 1, 4, 6, 8, 11 (true); risk 2 (the mechanism is true: the throw at `checks.ts` line 385 is now reachable for such prompts; whether it fires in practice is not shown); risk 3 (true); risk 4 (true); risk 8 (**false**: `TOOL` at `scenario.ts` line 236 requires `__`, so a name without it is already a recorded problem and the scenario is refused; nothing "stays silent"); risk 9 (true, trivial). Missed: a seed the server may ignore is still recorded; temperature has no upper bound; new metric names may break dashboards and `--fail-under` lists; the run format was not bumped.

**A.** ken only: grading can throw on an errored prompt (moderate, unconfirmed); any number accepted as a recorded seed (trivial). Plain only: seed recorded but maybe not honoured (moderate); new metric set (minor); format not bumped (minor decision). Tie. ken's false risk costs the owner time.

**B.** Plain names files per item and gives reasons from the docs. No line numbers. ken: five elements judged. Decision 1's message lines give the reason. Decision 6 has both a message line and a code comment, and is one of only two decisions in all five answers with a rejected alternative. Decision 11's line shows the declared metric list. Risk 2's quote shows the throw; that it is newly reachable is shown under decision 8. Risk 8's quote exists and the sentence is false. ken still wins B, but risk 8 shows the limit: a quote that exists does not make the sentence true.

**Diagram.** None.

**Readability.** Close. Both have about 24 items. Plain groups them as what, why, risks. ken's quotes cover 19 of 114 hunks, and it says so.

### #103: read old recorded runs, keep the evidence of a stopped attempt

**My list.** `parseRecordedScenario` keeps an unknown check as `Unjudgeable`, and `check` reports a skip. `aigent run` aborts on SIGTERM, takes `--timeout`, ignores EPIPE. The subject uses `spawn`, forwards three signals as SIGTERM, passes `timeout_s` less a margin, and deletes an old `aigent-run` first. Docs corrected.
Real risks: the retry's `rm` can delete a run nobody stored; the timeout fix needs `timeout_s` to reach the config; a typo in a recorded check is now a silent skip; a regrade drops `refuses` without a flag; a second signal kills the child unwritten; a human stop is graded as `timeout`; the subject waits forever on a hung child; the margin must cover writing and checking; no output cap after the move from `execFile`.

**Plain.** Checked: cause in `65a17d4` (true); two parse entry points (true); `BehaviorResult.check` widened (true); SIGTERM, `--timeout`, EPIPE (true); margin of a tenth, at most 30 s (true); `rm` before each attempt (true); exit `null` fails with no state (true); the old 64 MB `maxBuffer` is gone (true). False claims: none found. Missed: nothing of weight.

**ken.** Checked: decisions 1, 4, 5, 6, 8 (true); risk 1 (true: `process.once` in the CLI, every signal forwarded by the subject); risk 2 (true); risk 3 (true); risk 4 (true); risk 7 (true: `timeout_s: 2` gives a 0.2 s margin; `pgrep`). False claims: none found. Missed: a human stop graded as `timeout`; the subject hangs with a hung child; the margin must cover writing; no output cap.

**A.** ken only: `check` is now any string, so type checks are weaker (minor); process tests depend on timing and `pgrep` (minor). Plain only: the four items ken missed (minor to moderate), and a fuller account of the main risk: after a SIGKILL the subject printed nothing, so multeval holds only a bare timeout, and the retry then deletes the written run. ken states the same risk in one line. Plain is ahead, narrowly.

**B.** Plain names commits, files and functions. ken: five elements judged. Decision 1's quotes fit. Decision 2 is "recorded", but its message line says what, not why. Decision 5's message lines give the reason, and ken says nothing states why the margin is a tenth. Risk 1's two lines together show the gap. Statement 3's line shows `aborted` mapped to `timeout`. ken wins.

**Diagram.** None. This is the pull request where one would help most: multeval, subject, `aigent run`, and which signal reaches whom.

**Readability.** Plain splits the two problems and gives problem, fix, decisions for each. ken mixes them in one list of eight.

**Cost.** ken took 204 s and 325k tokens in, the most of the five, with one answer sent back by the quote check.

### #100: cap tool calls per code run, stop waiting past the deadline

**My list.** `maxCodeCalls` default 64, checked in one host-call wrapper for both modes; a refused call fails in the code; the result opens with a refusal count; at most 8 calls at once, the rest queue; `settle` waits 1000 ms past the deadline or abort, then returns and warns; a 10,000-call test pins an older fix.
Real risks: the default changes behaviour; queued calls can now hit the deadline; a call left running reports late and is not bounded across runs; a refused call leaves no record, span or event; helpers run in native mode, so the cap does not bound their own calls; tests depend on timing.

**Plain.** Checked: the 12,000-call measurement (true, from the design doc); cap in `sandboxTool` (true); refusal note (true); queue of 8 (true); `settle` and `GRACE_MS` (true); "refused calls leave no trace" (true: the refusal returns before `host.call`); "main still matches" (true). **False:** risk 5, "the warning can miss queued calls… they can still start after the run has returned". `settle` waits for every started call. It returns early only 1000 ms past the deadline or the abort, and by then the combined signal has fired and woken every queued call with `aborted`. No queued call can start after the run returns. Missed: the cap does not bound helpers.

**ken.** Checked: decisions 1 to 4 (true); risk 1 (true); risk 2 (true); risk 3 (true in substance; "its slot is freed" is loose, the point is that each run has its own map, so stuck calls add up across runs); risk 4 (true, the doc says helpers run in native mode); risk 5 (true); risk 6 (true, minor); statement 3 (true). False claims: none found. Missed: a refused call leaves no record or span.

**A.** ken only: the cap does not bound helper calls (moderate); the 10,000-call test skips the engine path (minor). Plain only: refused calls leave no trace (moderate); two clocks (harmless then, and the root of plain's #104 find). Tie.

**B.** ken: five elements judged. Decisions 1 and 3 fit. Decision 6's quote is a list of bad test values, and its reason is thin. Risk 2's lines fit. Risk 3 and risk 4 each quote a whole doc paragraph of about 2,000 characters to support one sentence. ken wins B, but the long quotes make checking slower, not faster.

**Diagram.** None.

**Readability.** Plain is faster.

## Criterion C

- **Plain** leaves a chat transcript. Nothing goes into the project. Finding it tomorrow means finding the chat. Another person, or another agent, cannot find it.
- **ken** says it stored each answer: one work entry and 5 to 11 decision entries per pull request, plus a topic and a note for #102, in a project record and a personal history, to be reopened without a model. I was told this and the files state it. I did not test it.
- ken wins C on all five.

## What ken's structure added, and what it cost

Same model on both sides, so the differences come from the tool, and from chance between two runs.

**Added.**
- A quote under every decision, risk and statement. I judged 25 elements, five per answer, and picked some because they looked doubtful. In 16 the quoted lines show what the sentence claims. In 8 the quote is real but shows only part of the sentence, or gives no reason. In 1 the sentence is false (#106 risk 8).
- A "recorded" or "inferred" label. 28 decisions are "recorded". 26 rest on a message line that gives a reason. Two rest on a line that says what, not why (#104 decision 3, #103 decision 2).
- Numbers on what the answer did not cover: hunks quoted (7 of 12, 17 of 56, 19 of 114, 15 of 86, 11 of 29) and commit messages cited.
- A closing note that says what was not read. It is honest. It is also unchecked and last on the page.
- A stored record.
- A "needs the owner's opinion" flag. It marks the right items (the 10 s boot limit, the 50000 default, the 64 and 8 limits, the SSH pins).

**Cost.**
- Risk finding did not improve. It was worse on #104 and no better on the other four.
- Length: 12.6 to 16.9 KB as text against 3.9 to 8.9 KB. Folding the quotes on the page removes part of this, not all.
- No account of what the pull request did. The summary is one or two sentences. The reader has to rebuild the change from the questions.
- Fixed fields that carry nothing: "Rejected: none shown by the code or history" on 37 of 39 decisions; "Undo: easy" on most.
- Time: 80 to 204 s. The plain chat took one to three minutes. About level, except #103. ken used 142k to 325k tokens in per answer; the plain chat's tokens are not stated, so tokens cannot be compared.
- A diagram in one answer of five.

## The three most important weaknesses of ken

1. **The structure checks what is said, not what is missing, and ken missed the most important risk in the set.** On #104 the pull request moved the run's deadline but left the tool calls' signal on the old clock (`src/core-tools.ts` line 105). The plain chat found it. ken quoted line 92 of the same file under risk 1, asked the owner to "check that sandboxTool turns this rejection into a tool error", and wrote in its closing note that it had not read `sandboxTool`. The answer passed every check.
2. **A real quote can sit under a false or stretched sentence, so the trust B gives is partly unearned.** #106 risk 8 says `pluginOf` "gives a wrong plugin name and stays silent" for a tool name with no `__`. The quoted line exists. The name rule in the same file (`TOOL`, line 236) makes the case impossible. #102 risk 2 says "the docs say this option caps every tool result"; they say "the text of". #104 decision 3 and #103 decision 2 are "recorded" on lines that give no reason.
3. **It is long and has no story, and the diagram is mostly absent.** #104's statement 3 and #100's risks 3 and 4 each quote a doc line of about 2,000 characters. "Rejected: none shown" appears 37 times. #104's statement 1 repeats decision 1's quote. Only #104 has a diagram. #103, a chain of three processes and signals, has none.

## Three things the plain chat did better

1. **It followed a changed value to its other users.** #104: "`sandboxTool` in `src/core-tools.ts:105` builds `AbortSignal.any([ctx.signal, AbortSignal.timeout(host.timeoutMs)])` when the tool is called… PR #104 didn't touch it." It had already named the "two clocks" in its #100 answer.
2. **It told what happened in order: problem, fix, decisions, risks.** #103 splits the two problems and gives "The problem" and "The fix" for each. #100 opens with the measurement that explains the change: a 12,000-call loop ran 12,000 tools and emitted 36,006 events; with the cap, 64 and 198.
3. **It closed its own questions and told the owner what to do.** #104: a boot failure "reaches the engine as a thrown tool error", where ken left a "check that". #103: "Copy it out first, or confirm multeval keeps it." #100: "The code on main still matches the PR." #106: the reason `sampling` exists only on one spec kind, taken from the design doc.

It also made one false risk (#100 risk 5) and one wrong reference (#102, "#105 to #107"). Nothing in the plain answer marks which claims were checked, so the owner cannot tell these from the true ones without opening the code.

## What I would change in ken first

Make the answer trace each changed value and each changed promise to its other users before it is accepted. For every function, constant, message or documented rule the diff changes, the model must name the callers and the other readers it opened, and add a risk when one still assumes the old behaviour. ken already computes hunk coverage from git. Add the same for this: list the changed symbols whose other uses were not quoted, and show that list beside the hunk count. Send back an answer whose closing note says it did not read a caller of a changed function, as #104's did.

After that, in this order: add a short "what it did and why" account ahead of the decisions; hide empty fields such as "Rejected: none shown"; cap the length of a quoted line; require a "recorded" reason to quote a line with a reason in it.
