This is one of the four verdicts of round 5 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on the same three unseen pull requests, ken on the glm-5.3 model and the plain chat on Claude Opus.
It was run on 16 November 2026, with ken at commit bd2d2d1.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken on glm-5.3 against a plain chat on Claude Opus, pull requests #105, #95, #94

## Result in short

- The plan's rule: ken wins at least one of A, B, C and loses none. Answer: **yes**. ken wins B and C on all three pull requests. A is a tie over the three.
- Clearest win: **B**. Every decision, risk and arrow carries quoted lines, and the quotes I sampled support their sentences in all but three cases.
- Closest to a loss: **A**. On #105 the plain chat found more and ken found nothing the plain chat lacked. ken's edge on #95 is narrow. #94 is a tie.
- Accuracy: I found no false claim on either side. Each side has small overstatements. ken's biggest one is the reach of its top risk on #95.
- Readability and time: the plain chat wins on all three. ken took 4.3 to 7.6 minutes per answer against 1 to 3.
- The second pass cost 22% of ken's time and 49% of its input tokens. It added two risks. One mattered (#94). It did not clearly earn its cost.
- The risk labels are right as a mechanical fact for 10 of 12 "Checked in the code" labels. They say nothing about how far a risk reaches, and that is where ken went wrong.
- The two sides ran on different models. ken's result here is the tool and glm-5.3 together. The plain chat's result is Opus with no tool. I excuse neither.

## How I checked

For each pull request I read `git diff M^1 M` and the commit messages, then the code around the change at the merge commit: the callers, the other users of changed values, and later commits where an answer pointed at one. I wrote my own list of what the change did, its decisions and its risks before I opened either answer. Then I checked at least six claims per answer by hand against the code, including stated reasons and every stated risk. For ken I also judged at least five quoted elements per answer: does the quoted line show what the sentence says. I read only the six answer files and the brief. I changed nothing in the repository. Merges: #105 is `5a85b5a`, #95 is `e9cb11c`, #94 is `1cbc6ac`.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #105 | plain: three finds ken lacks, ken has none of its own | ken: quotes support the sentences | ken: stored record | tie: no false claim on either side | plain: both check sites, tests, resume, public export | plain: 39 lines, bug stated first | plain: 1-3 min against 257 s and 1.15M tokens in |
| #95 | ken, narrowly: the regrade break and the cap fallback hole | ken: old and new code quoted side by side | ken: stored record | plain, slightly: ken overstates the reach of its top risk | tie: each side misses two real items | plain: 40 lines against 288 | plain: 1-3 min against 458 s and 1.31M tokens in |
| #94 | tie: each side has one moderate find of its own | ken: quotes support the sentences | ken: stored record | tie | tie | plain: problem, fix, decisions, risks | plain: 1-3 min against 413 s and 1.75M tokens in |
| Together | tie | ken | ken | tie | tie, plain ahead on #105 | plain | plain on time; money cannot be compared from the files |

## Pull request #105

### My yardstick

What it did:
- `onSessionEnd` now reports `byKind.usage.length` as `turns`. The in-memory `totalTurns` counter is gone. `maxTurns` still reads `run.turns`.
- Session open refuses a non-empty host secret or model key under 8 characters. The error names the secret and not the value. The check runs twice in `src/pi.ts`: in `parseLimits` for host secrets, and in `startSession` for the merged set after the model key resolves.
- `MIN_SECRET_LENGTH` moved from `src/eval/run.ts` to `src/session.ts` and is exported from `src/index.ts`.
- `redactEvent` keeps an event's `type` and a record's `kind` whole.

Real decisions: count from usage records and persist nothing new; a turn is one model request; refuse short secrets and allow empty ones; one floor shared with the eval runner; exempt only the two discriminants, not plugin names, tool names or enum values.

Real risks:
1. A host with a short secret or a short model key (a dummy key for a local server) can no longer open or resume a session.
2. The count rests on "one usage record per turn". The adapter holds that, the engine does not enforce it, and the new test covers two of the eight ways a run ends.
3. Old transcripts undercount.
4. A legal-length secret equal to a plugin name, tool name or enum value still rewrites it.
5. `turns` now means the whole life of the session, which a plugin may not expect.
6. A new public export.

### The plain chat

Claims checked: two commits, 8 files, 85 lines (true); the check runs in `parseLimits` and `startSession` (true, lines 272 and 100); helpers get the tree's secrets (true); the constant moved and is exported (true); `type` and `kind` are kept (true); `byKind.usage.length` and `run.turns` (true); a resume fails too (true, `parseLimits` runs before the transcript is read); the test expects `[2, 3]` (true).

Misleading: "you get every problem in one message". That holds for host secrets. A short model key is thrown later, alone. The next bullet in the same answer says the check runs in two places, so the reader can recover it.

Missed: nothing from my list.

### ken

Claims checked: decision 1 including "helper key" (true, the tree's secrets hold every profile's key); decision 2 (true); decision 3 and both rejected options (true, they come from the design doc); decision 4 (true); decision 5 (true, lines 624 and 697); risk 1 (true, lines 418 and 424 show the model key enters the secrets); risk 2 (true); risk 3 (true); risk 4 (true); statement 3 (true, line 251).

False or misleading: none.

Missed: the meaning change of `turns` for a plugin; the new public export; that a resume fails as well as a fresh open ("stored setup" hints at it); that the check runs in two places; the tests.

### Criterion A

- ken only: nothing.
- plain only: `turns` changed meaning (minor to moderate); a saved session with a short secret cannot be reopened (moderate detail of a shared risk); the public export (minor).
- Shared: the breaking refusal, the invariant, old transcripts, the residual case.
- Result: plain. The margin is modest. None of the three is serious.

### Criterion B

- plain: names both commits by hash, the files and the functions. It quotes no line. The owner must take it on trust or open the diff.
- ken, five elements: decision 1 (quotes show the filter and the throw: supports); decision 3 (lines 638 and 640 show the two kept fields: supports); risk 1 (supports); arrow 7 (the restore loop: supports); risk 3 (weak: the line outside the change is the usage record parser, which does not show that old transcripts lack usage records; the real support is the commit message and a changed comment).
- "Recorded" labels: all four rest on message lines that give the reason. Decision 5 is marked inferred although the commit message states it. That errs on the safe side.
- Nothing important sits only in the unchecked summary.
- Result: ken.

### Second pass, labels, diagram

- Second pass: rewrote three risks, added none. 53.6 s and 529k tokens in. I cannot see the text before the rewrite. The rewritten risks carry lines outside the change, so the pass is what earned them their label. It found nothing new. Not worth its cost here.
- Labels: four of four say "Checked in the code". Three hold. Risk 3 claims more than its quote shows. The heaviest risk is first.
- Diagram: true to the code. It shows only the turn count. The secret refusal, which is the larger half of the change and the source of the top risk, is absent. Half useful.

## Pull request #95

### My yardstick

What it did:
- Shell fixture: write operands are normalized first; an operand under `/proc` or `/dev` counts as every host file; `sort` is a read only with allowlisted options; `> /dev/nullx` is no longer stripped as `/dev/null`.
- Files fixture: a relative path or one under `/proc` or `/dev` counts as every host file; it has its own copy of the host list; `read_file`, and `delete_file` and `move_file` on a missing file, now write state.
- Both: over the 16 KiB cap the record keeps only host paths and counts them all; state is written on every call.
- `check`: `respects` throws when a state effect names a plugin whose tool ran and that kept no `changed` state. A state effect may name a plugin only a helper profile loads.

Real risks:
1. The new throw also hits old runs. Before this change the fixtures wrote state only on a change. A recorded `/2` run whose step only read now throws on regrade. In practice the window is small: state effects landed in `e1d0a1d` at 22:22 UTC and #95 merged at 22:53 UTC the same day. The stored October results are `/1` and are safe.
2. The throw depends on the engine writing a record on every update. `3e93e00`, the same day, stopped that and patched the check to read earlier steps.
3. More false failures.
4. The bare `catch {}` treats any error as the cap.
5. The host list now exists twice.
6. The cap fallback drops non-host paths, so an effect that matches only a non-host path would pass.

### The plain chat

Claims checked: `/proc` and `/dev` (true); normalization before the test (true); the sort allowlist (true); the `/dev/null` boundary (true); `STATE_CAP` in `src/records.ts` (true, line 206); `update` always appended at the merge (true, `src/engine.ts` line 375); `3e93e00` came later and patched `unrecordedStates` to read `step.before` (true, I read the current function); the bare catch (true); the second host list (true); nine cases failed on main (true, per the commit message).

False or misleading: none.

Missed: risk 1 (old runs on regrade) and risk 6 (the cap fallback).

### ken

Claims checked: decisions 1 to 7 (true); risk 1 (true in mechanism: I confirmed the old `if (changed.length > 0)`, the regrade sentence in the design doc and exit code 4); risk 2 (true, `--parallel=2` is not on the list); risk 3 (true, I traced the fallback: it keeps and counts only `HOST` paths); risk 4 (true, per the message of `3e93e00`).

Misleading:
- Risk 1 and the summary ("Watch regrades of pre-#95 runs") give no bound. Only `/2` runs recorded in a window of about 30 minutes qualify. The design doc says that runs from before the format bump are judged by their call effects. ken ranked this risk first.
- Decision 2 says "the record and with it the run would be lost". Only the record is lost. The tool call fails and the run goes on.
- Risk 4 names `3e93e00` and frames the risk as "extra records" in runs from the gap. The real point, which the plain chat made, is that the check depends on how the engine writes state records.

Missed: the bare catch; the duplicated host list; the changes to `delete_file` and `move_file`.

### Criterion A

- ken only: old `/2` runs throw on regrade (real, narrow); the cap fallback can pass an effect on a non-host path (real, subtle, no scenario hit today, and ken says so).
- plain only: the bare catch (minor); the duplicated host list (minor); the coupling to the engine's record writing, framed as the risk (moderate, fixed on main, and ken has the same commit under a weaker framing).
- Result: ken, narrowly. Two real finds with code behind them against two minor ones. Neither find is serious once its reach is known.

### Criterion B

- plain: names commits, files and functions, and the later commit by hash. No quoted line.
- ken, five elements: risk 1 (strong: the old fixture line at the parent commit, the new throw, the doc line on regrade and the exit code: supports); risk 3 (the fallback line and the comparison in `changesOf`: supports); decision 4 (the regex line supports the choice, but the "recorded" label is generous: the message says what changed, the why is the model's); decision 6 (its reason quote is a test title: weak); arrow 9 (supports).
- Decision 5 is rightly "recorded": the message says "since the effect could never fail".
- The closing note says 8 of 16 later commits were not read. That gap sits only in the unchecked note.
- Result: ken.

### Second pass, labels, diagram

- Second pass: added risk 4. It is true and of low weight. It did not bound risk 1, although it read the commit that would have shown how short the window was. 108.5 s and 588k tokens in. Marginal.
- Labels: three "Checked in the code", one "Not checked outside the change". Risks 1 and 3 hold. Risk 2 rests on a design-doc paragraph and a changed line, not on code outside the change, so its label claims more than its quote shows. The "Not checked" label on risk 4 is honest. Risk 1 is first; by real reach, risk 2 (false failures on every run) weighs more.
- Diagram: true to the code. It shows who writes state and who reads it. It leaves out the throw, which is the new behaviour. Some help.

## Pull request #94

### My yardstick

What it did:
- `parsePlugin` returns a frozen copy: declared fields, copied lists, the six known hooks. Functions are bound to the object they came from. Tool `parameters` stay shared.
- `pluginUnits` resolves each entry to its real path. A link counts as its target, also outside the directory. Two layouts are refused: an index that resolves outside its unit, and units that overlap. A dangling link is skipped unless its name is a module file name.

Real risks:
1. `parameters` can still be changed after validation.
2. The overlap check covers one call. The guarded set is process-wide.
3. A directory that used to load can now fail as a whole.
4. A host that changes its plugin object after creation is now ignored without a word.
5. A linked target becomes a guarded unit for the life of the process, whatever it holds.
6. The copy reads each field a second time after validation.
7. The symlink tests skip where links are refused.

### The plain chat

Claims checked: the frozen copy and its fields (true); the three binds (true); `parameters` shared (true); `realpath` per entry and `stat` on the target (true); the two refused layouts and the reason (true); the dangling rule (true); risk 1 (true: I traced `guard` and `denial`; a linked folder that holds aigent's `src` makes aigent's own files part of a guarded unit, and `denial` refuses any target in `src`); risk 2 (true); risk 5 (true).

False or misleading: none. Risk 1 needs an odd link to occur; the mechanism is right.

Missed: risk 3 and risk 7 from my list.

### ken

Claims checked: decisions 1 to 6 (true); risk 1 (true, `src/engine.ts` lines 279 and 458 render and validate with the shared object); risk 2 (true, the old line 172 skipped a linked directory); risk 3 (true); risk 4 (true as a conditional: `test/boundary.test.ts` line 119 maps roots that are now link targets; no linked fixture exists today); risk 5 (true, `src/eval/run.ts` line 223 loads several directories into one process); statement 2, five symlink tests (true).

False or misleading: none.

Missed: the link to a folder that holds aigent's own source; that `this` still points at a changeable object; dropped extra fields.

### Criterion A

- ken only: directories that used to load now fail (moderate); a host's later swap of a function is ignored (minor, the plain chat describes the same thing as the fix); the boundary test and a linked fixture (minor, hypothetical); the skipped tests (minor).
- plain only: the guarded-`src` hole (moderate, needs an odd link); `this` still changeable (minor); dropped fields (minor); the time gap (minor).
- Shared: `parameters`, and the overlap check per call.
- Result: tie.

### Criterion B

- plain: names commits and functions. No quoted line.
- ken, five elements: decision 3 (supports); risk 1 (supports); risk 2 (old line and new throw: supports); risk 5 (supports); arrow 11 (the engine reads the catalog's copy: supports).
- All six "recorded" labels rest on message lines that give the reason.
- "Used elsewhere" carries noise: `Gate (altered), 18 places` points into `.agents/skills/poteto-mode/scripts/orch/store.ts`, and `withFileTypes`, `dependsOn` and `onEnable (added)` are not names this change defines.
- Result: ken.

### Second pass, labels, diagram

- Second pass: added risk 5 and rewrote risk 3. Risk 5 is real and the plain chat had it, so without the pass ken would have been behind on this pull request. 82.2 s and 940k tokens in. Earned here.
- Labels: five of five "Checked in the code", and each quote shows code outside the change. The label on risk 4 is right as a fact, though the risk is hypothetical. The order is off: risk 4 (a test that would fail if someone added a linked fixture) sits above risk 5 (a real gap in the guard).
- Diagram: true to the code. It gives the pipeline in one line and marks where the freeze and the real-path step sit. It is the most useful of the three.

## Criterion C

- ken leaves a stored answer in a project record and a personal history, which reopens without a model. The files show what was stored (#105: 5 decisions, 2 notes, 2 topics; #95: 7 decisions; #94: 7 decisions).
- The plain chat leaves a chat transcript. Nothing lands in the repository. The owner must find the conversation again.
- ken on all three. This is a fact of structure, not of answer quality.

## Readability

- The plain answers are 36 to 40 lines. Each states the bug, then the fix, then the decisions, then the risks. A tired reader gets the point in a minute.
- ken's text is 230 to 290 lines. On the page the quotes fold, which helps. What remains is still longer: a two-sentence summary that does not explain the bug, then decisions as question, choice and reason. The same quote often appears under a decision and again under a risk.
- The plain chat wins on all three.

## Cost

| | #105 | #95 | #94 | Total |
|---|---|---|---|---|
| ken time | 256.8 s | 457.7 s | 412.6 s | 1127 s |
| ken tokens in | 1,150,932 | 1,305,381 | 1,752,275 | 4,208,588 |
| ken tokens out | 64,997 | 107,885 | 99,550 | 272,432 |
| of which second pass, time | 53.6 s | 108.5 s | 82.2 s | 244 s (22%) |
| of which second pass, tokens in | 528,940 | 588,001 | 939,836 | 2,056,777 (49%) |
| answers sent back by the checks | 1 | 1 | 3 | 5 |
| plain time | 1-3 min | 1-3 min | 1-3 min | 3-9 min |

The plain chat's token use is not stated, so money cannot be compared. glm-5.3 is much cheaper per token, but ken used 1.1 to 1.75 million input tokens per answer. On time the plain chat wins each one.

## Verdict against the plan's rule

**Yes.** ken wins B and C and loses none.

- B, the clearest win: of 15 elements I sampled, 12 have quotes that show what the sentence says. The plain chat quotes no line. Its answers were accurate here, but the owner cannot know that without opening the diff.
- C: structural, ken.
- A, the closest to a loss: plain on #105, ken narrowly on #95, tie on #94. Taken together neither side's finds clearly outweigh the other's. Each side has two or three moderate finds of its own and none that is serious. ken does not win A.

The "yes" rests on B and C alone. On what the owner learns (A), ken on this model did not beat a plain chat, and it took three to four times as long.

## The second pass over the three

- It added two risks, rewrote four, withdrew none.
- #94 risk 5 (overlap across directories) is real and kept ken level with the plain chat.
- #95 risk 4 (extra records before `3e93e00`) is true and of low weight.
- It did not catch the two problems a risk pass should catch: the unbounded reach of #95 risk 1, and the order of #94 risks 4 and 5. It placed its own added risk last on #94 although it is the heavier one.
- Cost: 244 s and 2.06 million input tokens, half of all input tokens.
- It earned its cost on #94, not on #105, barely on #95. Over the three: not clearly.

## Can the risk labels be trusted?

- 12 of 13 risks carry "Checked in the code". For 10 the quote shows code outside the change that the risk rests on.
- Two claim more than the quote shows: #105 risk 3 (a parser line that does not show the claim) and #95 risk 2 (a design-doc paragraph, not code).
- The one "Not checked outside the change" label (#95 risk 4) is honest.
- So the label can be trusted as a narrow fact: the model quoted an untouched line. It cannot be read as "this risk is confirmed", and it says nothing about how many users or runs the risk reaches. #95 risk 1 is "Checked in the code", ranked first, and applies to a window of 30 minutes.
- Order: the heaviest risk is first on #105. On #95 and #94 the order does not match real weight.

## ken's three most important weaknesses on this model

1. **It does not establish how far a risk reaches, so its order and its wording mislead.** #95 risk 1 says "A run recorded before this change can no longer be regraded", and the summary says "Watch regrades of pre-#95 runs". State effects were 30 minutes old when #95 merged, and the stored runs are `/1`. On #94 a hypothetical test failure (risk 4) ranks above a real guard gap (risk 5).
2. **It finds no more than the plain chat and reasons less about what the change means for the owner.** On #105 it has no find of its own. It missed that `turns` changed meaning, that a saved session with a short secret cannot be resumed, and the new public export. On #94 it missed the link to a folder that holds aigent's own source. Its summaries do not state the bug. The #105 diagram shows one of the two fixes.
3. **It is slow and heavy for what it returns.** 4.3 to 7.6 minutes and 1.1 to 1.75 million input tokens per answer. #94 had three answers sent back by the checks and took 412.6 s. Half the input tokens went to a second pass that added one risk that mattered.

A smaller fourth: the labels and lists look firmer than they are. "Recorded" on #95 decision 4 rests on a message line that gives the what, not the why. "Used elsewhere" on #94 lists `Gate` in an unrelated skill script.

## Three things the plain chat did better

1. **It explains the bug before the fix, briefly.** #94: "`parsePlugin` checked the host's plugin object and then handed that same object to the engine." #105 gives the example `core__en[REDACTED:X]ble_plugin`. ken's reader must piece the bug together from the "Why" lines.
2. **It thinks past the diff to what happens to the owner.** #105: "A resume fails too, so a saved session with a short secret can't be reopened", and "`turns` changed meaning". #94 risk 1: a link to a folder that holds aigent's source turns the guard on aigent itself.
3. **It follows the history forward and gives each risk its weight.** #95: it found `3e93e00`, said the check depends on how state records are written, and said that main already has the fix. It closes with scope: "Nothing in the agent runtime changed, so production behavior is not at risk." ken read the same commit and drew the weaker point from it.

It also did this in a third of the time.

## What I would change in ken first

Make each risk state its reach, and have ken order by it. For every risk the model must answer three things with a quote: who or what hits it, since when the condition has existed, and whether it still holds at the head of main. The second pass should spend its budget on that, not on rereading. This targets the weakness that did the most damage here: #95 risk 1 would have come back as "only `/2` runs from a 30-minute window", and the order on #94 would have been right. It also gives the "Checked in the code" label something worth trusting.

After that: have the summary state the bug in one sentence, and cut the second pass where it adds nothing (it rewrote three risks on #105 for 529k tokens).
